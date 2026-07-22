import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { client, contact, db, withSystemAccess, withTenant } from "@wacits/db";
import { eq, sql } from "drizzle-orm";
import { tenantMiddleware } from "./middleware/tenant";

const app = new Hono();

app.use(logger());

// Split hosting: the web app (Hostinger) and this API (VPS, behind Caddy at
// api.wacits.cyberlative.com) are different origins now, so this is a real
// cross-origin request, not same-Docker-network traffic. CORS_ORIGIN must
// be set to the exact frontend origin — never "*" once real credentials or
// cookies are involved (Better Auth sessions will be, from Phase 1 on).
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin) {
  throw new Error("CORS_ORIGIN is not set. Refusing to start (see .env.example / TS-8).");
}
app.use(
  "*",
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);

// PRD §4.1 — AR-1: every process is a separately restartable container. This
// health check is what an external uptime monitor and Docker's own
// healthcheck directive both poll.
app.get("/health", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok", service: "api", db: "reachable" });
  } catch (err) {
    return c.json({ status: "error", service: "api", db: "unreachable", detail: String(err) }, 503);
  }
});

// Platform-level lookup (no tenant session exists yet) — the workspace
// switcher's first step: resolve a client slug to its id. Runs under
// wacits_platform since it is, by definition, before any tenant is chosen.
app.get("/clients/by-slug/:slug", async (c) => {
  const slug = c.req.param("slug");
  const rows = await withSystemAccess((tx) => tx.select().from(client).where(eq(client.slug, slug)).limit(1));
  const found = rows[0];
  if (!found) return c.json({ error: "not found" }, 404);
  return c.json({ id: found.id, name: found.name, slug: found.slug, status: found.status });
});

// Everything below /workspace requires a resolved tenant context and
// demonstrates the RLS-backed query path (see packages/db/src/tenant.ts).
const workspace = new Hono();
workspace.use(tenantMiddleware);

workspace.get("/contacts", async (c) => {
  const { clientId } = c.get("tenant");
  const rows = await withTenant(clientId, (tx) => tx.select().from(contact));
  return c.json({ clientId, count: rows.length, contacts: rows });
});

workspace.get("/whoami", (c) => c.json(c.get("tenant")));

app.route("/workspace", workspace);

app.get("/", (c) =>
  c.json({
    service: "CITS WhatsApp Communication Manager — API",
    note: "See docs/PRD.md. This is Phase 0/1 scaffolding, not the full product.",
  }),
);

const port = Number(process.env.API_PORT ?? 8787);
console.log(`API listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
};
