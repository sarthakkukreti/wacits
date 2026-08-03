import { Hono } from "hono";
import { createHash } from "node:crypto";
import { db, webhookEvent, withSystemAccess } from "@wacits/db";
import { webhookQueue } from "@wacits/queue";
import { createLogger } from "@wacits/shared";
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
const log = createLogger("webhook");

const META_APP_SECRET = process.env.META_APP_SECRET;
const META_WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;

// AU-2: same request-id convention as the API (apps/api/src/middleware/
// request-id.ts) — kept inline here rather than shared, since it's a
// three-line concern and each of these small services already stands alone.
app.use(async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const id = incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
});

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

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
  const requestId = c.get("requestId");
  // AR-6: verify over the EXACT raw bytes — never re-serialise parsed JSON.
  const rawBody = await c.req.text();
  const signatureHeader = c.req.header("x-hub-signature-256");

  if (!META_APP_SECRET) {
    log.error({ requestId }, "META_APP_SECRET is not set; refusing to process webhook (see .env.example / TS-8)");
    return c.text("Server misconfigured", 500);
  }

  const verified = verifySignature(rawBody, signatureHeader, META_APP_SECRET);
  if (!verified) {
    // AR-7: reject without processing, count as a security metric.
    log.warn({ requestId }, "webhook signature verification failed — rejecting without processing");
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
  const [stored] = await withSystemAccess(async (tx) =>
    tx
      .insert(webhookEvent)
      .values({
        signatureVerified: "true",
        objectType: parsed?.object ?? null,
        wabaId: entry?.id ?? null,
        field: change?.field ?? null,
        rawBody,
        bodyHash,
        processingState: "pending",
      })
      .returning({ id: webhookEvent.id }),
  );

  // §4.2 (b)/(c) — hand interpretation to the webhook worker. Enqueue
  // failures must never turn into a non-200: the raw event is already
  // durable, so a lost job is recoverable by re-enqueuing, whereas a failed
  // ack makes Meta retry and eventually disable the subscription.
  try {
    await webhookQueue.add(
      "webhook",
      { webhookEventId: stored.id, correlationId: requestId },
      {
        // BullMQ rejects a custom job id containing ':' unless it has
        // exactly three colon-separated parts, so use the bare event UUID —
        // it is already unique and makes the enqueue idempotent.
        jobId: stored.id,
        attempts: 5,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  } catch (err) {
    log.error({ requestId, err, webhookEventId: stored.id }, "failed to enqueue for processing (event is stored and replayable)");
  }

  // AR-4: acknowledge fast. Everything above this line is signature
  // verification and durable persistence only — no interpretation.
  return c.text("EVENT_RECEIVED", 200);
});

app.onError((err, c) => {
  log.error({ requestId: c.get("requestId"), err }, "unhandled error");
  return c.text("Internal server error", 500);
});

const port = Number(process.env.WEBHOOK_PORT ?? 8788);
log.info({ port }, "webhook receiver listening");

export default {
  port,
  fetch: app.fetch,
};
