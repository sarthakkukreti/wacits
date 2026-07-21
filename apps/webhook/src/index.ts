import { Hono } from "hono";
import { createHash } from "node:crypto";
import { db, webhookEvent, withSystemAccess } from "@wacits/db";
import { sql } from "drizzle-orm";
import { verifySignature } from "./verify-signature";

/**
 * PRD §4.1 — the webhook receiver is its own container so a slow or
 * crashing frontend deploy can never delay acknowledging Meta. Its ONLY job
 * (AR-4/AR-5): verify the signature, persist the raw payload durably, ack
 * with 200. All interpretation happens later, in a worker, where slowness
 * is harmless (see apps/workers).
 */
const app = new Hono();

const META_APP_SECRET = process.env.META_APP_SECRET;
const META_WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;

app.get("/health", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok", service: "webhook", db: "reachable" });
  } catch (err) {
    return c.json({ status: "error", service: "webhook", db: "unreachable", detail: String(err) }, 503);
  }
});

// AR-12: the verification handshake. Validate the token, echo the
// challenge verbatim.
app.get("/", (c) => {
  const mode = c.req.query("hub.mode");
  const challenge = c.req.query("hub.challenge");
  const token = c.req.query("hub.verify_token");

  if (mode === "subscribe" && token && META_WEBHOOK_VERIFY_TOKEN && token === META_WEBHOOK_VERIFY_TOKEN) {
    return c.text(challenge ?? "");
  }
  return c.text("Forbidden", 403);
});

app.post("/", async (c) => {
  // AR-6: verify over the EXACT raw bytes — never re-serialise parsed JSON.
  const rawBody = await c.req.text();
  const signatureHeader = c.req.header("x-hub-signature-256");

  if (!META_APP_SECRET) {
    console.error("META_APP_SECRET is not set; refusing to process webhook (see .env.example / TS-8).");
    return c.text("Server misconfigured", 500);
  }

  const verified = verifySignature(rawBody, signatureHeader, META_APP_SECRET);
  if (!verified) {
    // AR-7: reject without processing, count as a security metric.
    console.warn("Webhook signature verification failed — rejecting without processing.");
    return c.text("Invalid signature", 403);
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    // Persist anyway (AR-8) — an unparseable body is still evidence.
  }

  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const entry = parsed?.entry?.[0];
  const change = entry?.changes?.[0];

  // AR-8/DM-9: persist raw bytes durably BEFORE returning 200. This table
  // write happens under wacits_platform (see withSystemAccess) because the
  // owning client is not yet known — resolution happens in a worker.
  await withSystemAccess(async (tx) => {
    await tx.insert(webhookEvent).values({
      signatureVerified: "true",
      objectType: parsed?.object ?? null,
      wabaId: entry?.id ?? null,
      field: change?.field ?? null,
      rawBody,
      bodyHash,
      processingState: "pending",
    });
  });

  // TODO (Phase 1, §13/§14): enqueue for asynchronous processing instead of
  // handling inline. See apps/workers for the send/import/scheduler
  // workers this project already scaffolds; inbound-webhook processing
  // (§4.2 walkthroughs (b) and (c)) needs its own queue consumer alongside
  // them, matching AR-9/AR-10/AR-11 (idempotent, timestamp-ordered,
  // deduped on (wamid, status)).

  // AR-4: acknowledge fast. Everything above this line is signature
  // verification and durable persistence only — no interpretation.
  return c.text("EVENT_RECEIVED", 200);
});

const port = Number(process.env.WEBHOOK_PORT ?? 8788);
console.log(`Webhook receiver listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
};
