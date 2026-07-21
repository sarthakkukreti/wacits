import postgres from "postgres";

/**
 * DM-12 / DM-20 / §21.9 — database-level enforcement, run once after
 * migrations (idempotent; safe to re-run).
 *
 * 1. Creates two roles the application assumes via SET ROLE (see tenant.ts):
 *    - wacits_app       — ordinary workspace-scoped access, RLS enforced.
 *    - wacits_platform  — BYPASSRLS, used only for platform-wide aggregation
 *      via withPlatformAccess(), which always writes an audit_log row first.
 * 2. Enables and FORCES row-level security on every table that has a
 *    `client_id` column, derived by introspecting information_schema rather
 *    than a hand-maintained list — the exact kind of drift this project's
 *    own review process caught repeatedly is not something to reintroduce
 *    here. The `client` table is scoped on `id` instead, since it IS the
 *    tenant.
 * 3. Revokes UPDATE and DELETE from both roles on every append-only table
 *    (§21.9), so an application bug cannot mutate evidence tables even if a
 *    query tries to.
 *
 * Tables deliberately exempt from RLS (§21.7): suppression_entry,
 * business_portfolio, whatsapp_business_account, rate_card, rate_card_entry,
 * error_code_classification, platform_setting, access_token. These have no
 * client_id column, so the introspection loop below naturally skips them.
 */

const APPEND_ONLY_TABLES = [
  "consent_record",
  "message_status_event",
  "audit_log",
  "usage_record",
  "campaign_audience_snapshot",
  "frequency_ledger_entry",
  "import_created_contact",
  "import_error",
  "click_event",
];
// NOTE: §21.9 lists `webhook_event` as append-only, protecting the raw
// captured payload — but §21.5 also gives it mutable processing_state /
// processing_attempts / last_error / client_id (resolved once known)
// columns, which an append-only table cannot have updated in place. This
// scaffold resolves the tension in favour of the mutable processing
// columns (revoking UPDATE would break DM-9's own processing flow) and
// deliberately does NOT add webhook_event to the revoke list above. The
// raw_body/body_hash/received_at fields are simply never written to twice
// in practice; if stricter guarantees are wanted later, split the row into
// an immutable `webhook_event` and a separate mutable `webhook_event_processing`
// table. Flag this for an explicit product decision before go-live.

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  const sql = postgres(DATABASE_URL, { max: 1 });

  console.log("Creating application roles (if they do not already exist)...");
  // Ask Postgres who we actually connected as, rather than parsing the
  // connection string — a DATABASE_URL with no explicit username (as in
  // local dev, authenticating via the OS user) resolves to a role the URL
  // itself never names.
  const [{ current_user: appUser }] = await sql<{ current_user: string }[]>`SELECT current_user`;

  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wacits_app') THEN
        CREATE ROLE wacits_app NOLOGIN NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wacits_platform') THEN
        CREATE ROLE wacits_platform NOLOGIN BYPASSRLS;
      END IF;
    END
    $$;
  `);

  // WITH INHERIT FALSE is deliberate: simply holding membership in these
  // roles must not grant their privileges (or, for wacits_platform, its
  // BYPASSRLS attribute) ambiently. The connecting role must explicitly
  // SET ROLE — see withTenant()/withSystemAccess()/withPlatformAccess() in
  // tenant.ts — so that which access mode is in force is always a single,
  // greppable line in application code, never an inherited default.
  await sql.unsafe(`GRANT wacits_app TO "${appUser}" WITH INHERIT FALSE;`);
  await sql.unsafe(`GRANT wacits_platform TO "${appUser}" WITH INHERIT FALSE;`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO wacits_app, wacits_platform;`);
  await sql.unsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wacits_app, wacits_platform;`,
  );
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wacits_app, wacits_platform;`,
  );

  console.log("Revoking UPDATE/DELETE on append-only tables (§21.9)...");
  for (const table of APPEND_ONLY_TABLES) {
    await sql.unsafe(
      `REVOKE UPDATE, DELETE ON "${table}" FROM wacits_app, wacits_platform;`,
    );
  }

  console.log("Discovering tenant-scoped tables (any table with a client_id column)...");
  const tenantTables = await sql<{ table_name: string }[]>`
    SELECT DISTINCT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'client_id'
    ORDER BY table_name
  `;

  for (const { table_name } of tenantTables) {
    await sql.unsafe(`ALTER TABLE "${table_name}" ENABLE ROW LEVEL SECURITY;`);
    await sql.unsafe(`ALTER TABLE "${table_name}" FORCE ROW LEVEL SECURITY;`);
    await sql.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON "${table_name}";`);
    // Nullable client_id columns (audit_log, webhook_event, notification,
    // notification_recipient, margin_config) correctly hide platform-level
    // (NULL) rows from a workspace-scoped session — those are read only via
    // withPlatformAccess(), which assumes wacits_platform and bypasses RLS.
    await sql.unsafe(`
      CREATE POLICY tenant_isolation ON "${table_name}"
        TO wacits_app
        USING (client_id = current_setting('app.current_client_id', true)::uuid)
        WITH CHECK (client_id = current_setting('app.current_client_id', true)::uuid);
    `);
  }
  console.log(`RLS applied to ${tenantTables.length} tenant-scoped tables.`);

  console.log("Applying RLS to the client table itself (scoped on id)...");
  await sql.unsafe(`ALTER TABLE "client" ENABLE ROW LEVEL SECURITY;`);
  await sql.unsafe(`ALTER TABLE "client" FORCE ROW LEVEL SECURITY;`);
  await sql.unsafe(`DROP POLICY IF EXISTS tenant_isolation ON "client";`);
  await sql.unsafe(`
    CREATE POLICY tenant_isolation ON "client"
      TO wacits_app
      USING (id = current_setting('app.current_client_id', true)::uuid)
      WITH CHECK (id = current_setting('app.current_client_id', true)::uuid);
  `);

  console.log("Database security setup complete.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
