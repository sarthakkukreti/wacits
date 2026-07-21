import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * DM-12: tenant isolation is enforced IN THE DATABASE via PostgreSQL row-level
 * security keyed on a session-scoped client identifier — never by
 * application-code-only scoping (a hard fail at review).
 *
 * Every table carrying a `client_id` column has an RLS policy (see
 * db-security-setup.ts) that only lets the `wacits_app` role see rows where
 * `client_id = current_setting('app.current_client_id')`. This helper is the
 * ONLY sanctioned way application code should touch the database for a
 * request scoped to one workspace: it assumes the restricted role and sets
 * the session variable inside a transaction, so nothing after this point can
 * accidentally see another client's rows, no matter what the query looks
 * like.
 */
export async function withTenant<T>(
  clientId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE wacits_app`);
    await tx.execute(sql`SELECT set_config('app.current_client_id', ${clientId}::text, true)`);
    return fn(tx);
  });
}

/**
 * For background/system processes that are not tenant-scoped by nature —
 * the webhook receiver persisting a raw event before any client is known
 * (DM-9), workers processing that event, seeding platform-level tables.
 * Assumes `wacits_platform` (BYPASSRLS) like withPlatformAccess(), but
 * without writing an audit_log row unconditionally: these are not a human
 * crossing a workspace boundary (DM-34's concern), they are the system
 * doing routine work the tenant model was never meant to gate. Business
 * actions worth auditing still call auditLog inserts explicitly.
 */
export async function withSystemAccess<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE wacits_platform`);
    return fn(tx);
  });
}

/**
 * DM-34: Super Admin access that spans workspaces (the CITS master
 * dashboard, cross-client reporting) must set the session identifier
 * explicitly and must never silently bypass row-level security. This helper
 * assumes the `wacits_platform` role (granted BYPASSRLS) and writes the
 * audit_log entry itself, so cross-workspace access can never happen without
 * a corresponding record naming who did it.
 */
export async function withPlatformAccess<T>(
  actorUserId: string,
  reason: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE wacits_platform`);
    await tx.execute(sql`
      INSERT INTO audit_log (actor_user_id, actor_type, action, entity_type, before_after_summary)
      VALUES (${actorUserId}, 'user', 'platform_access', 'platform', ${JSON.stringify({ reason })})
    `);
    return fn(tx);
  });
}
