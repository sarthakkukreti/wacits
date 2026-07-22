import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { client, db, withSystemAccess } from "@wacits/db";
import { eq, sql } from "drizzle-orm";
import { tenantMiddleware } from "./middleware/tenant";
import { requireApiCredential } from "./middleware/auth";
import contacts from "./routes/contacts";
import imports from "./routes/imports";
import inbox from "./routes/inbox";
import campaigns from "./routes/campaigns";
import templates from "./routes/templates";
import settings from "./routes/settings";
import dashboard from "./routes/dashboard";

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
// healthcheck directive both poll. Deliberately the ONLY unauthenticated
// route: it reveals nothing beyond liveness.
app.get("/health", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok", service: "api", db: "reachable" });
  } catch (err) {
    return c.json({ status: "error", service: "api", db: "unreachable", detail: String(err) }, 503);
  }
});

// Everything below this line requires the service credential (§19). The
// browser never holds it — the Next.js server does (see apps/web/lib/api.ts).
app.use("*", requireApiCredential);

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

app.get("/clients", async (c) => {
  const rows = await withSystemAccess((tx) =>
    tx.select({ id: client.id, name: client.name, slug: client.slug, status: client.status }).from(client),
  );
  return c.json({ clients: rows });
});

// Everything below /workspace requires a resolved tenant context and runs
// through the RLS-backed query path (see packages/db/src/tenant.ts).
const workspace = new Hono();
workspace.use(tenantMiddleware);

workspace.get("/whoami", (c) => c.json(c.get("tenant")));

workspace.route("/contacts", contacts);
workspace.route("/imports", imports);
workspace.route("/inbox", inbox);
workspace.route("/campaigns", campaigns);
workspace.route("/templates", templates);
workspace.route("/settings", settings);
workspace.route("/dashboard", dashboard);

app.route("/workspace", workspace);

app.get("/", (c) =>
  c.json({
    service: "CITS WhatsApp Communication Manager — API",
    note: "See docs/PRD.md.",
  }),
);

// One place where an unhandled error becomes a response, so a stack trace
// never leaks to a caller but is always logged server-side.
app.onError((err, c) => {
  console.error("[api] unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

const port = Number(process.env.API_PORT ?? 8787);
console.log(`API listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
};
