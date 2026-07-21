import { Hono } from "hono";
import { db } from "@wacits/db";
import { sql } from "drizzle-orm";

/**
 * PRD §16 Click tracking — public, unauthenticated, latency-sensitive, and
 * separately attackable (§4.1), so it is its own container.
 *
 * NOT YET IMPLEMENTED: resolving a token to a destination. §16/CP-8 specify
 * that the click token is generated at audience-snapshot time and written
 * into the recipient's resolved template parameter values (so it travels
 * inside the outbound URL button), but the data model in §21.5 only
 * records a token on `click_event` — i.e. once a click has already
 * happened. Serving a redirect requires an index from token → (click_link,
 * campaign_recipient) that exists BEFORE the click, which §21 does not
 * spell out as its own table. Resolve this explicitly (most likely: a
 * `click_token` row written alongside `campaign_recipient` at send time)
 * before building the real handler — flagged here rather than guessed at.
 */
const app = new Hono();

app.get("/health", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok", service: "click-redirect", db: "reachable" });
  } catch (err) {
    return c.json({ status: "error", service: "click-redirect", db: "unreachable", detail: String(err) }, 503);
  }
});

app.get("/c/:token", (c) => {
  // TODO (Phase 7, §16): look up the token, log a click_event row BEFORE
  // forwarding (302), append UTM parameters, and fall back to the
  // workspace's configured click_tracking_config.fallbackUrl when the
  // token is unknown or expired — never a broken page.
  return c.text(`Click tracking redirect not yet implemented for token: ${c.req.param("token")}`, 501);
});

const port = Number(process.env.CLICK_REDIRECT_PORT ?? 8789);
console.log(`Click redirect service listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
};
