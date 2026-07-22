import type { MiddlewareHandler } from "hono";
import { timingSafeEqual } from "node:crypto";

/**
 * PRD §19 Security — the API is reachable on the public internet
 * (api.wacits.cyberlative.com), so every route other than /health must
 * present a credential.
 *
 * This is a service-to-service shared secret, NOT end-user authentication.
 * The browser never sees it: the Next.js app holds it server-side and calls
 * this API from its own server process (see apps/web/lib/api.ts), so the
 * secret stays on the server and a stolen browser session cannot replay it
 * directly against this API.
 *
 * Full per-user auth (Better Auth sessions + the §6 role matrix) is still
 * the Phase 1 target and is what the `user`/`user_client_role` tables
 * exist for. This closes the "anyone who finds the URL can read every
 * contact" hole in the meantime; it is deliberately not sold as more than
 * that.
 */

const API_SHARED_SECRET = process.env.API_SHARED_SECRET;

if (!API_SHARED_SECRET) {
  throw new Error("API_SHARED_SECRET is not set. Refusing to start (see .env.example / TS-8).");
}
if (API_SHARED_SECRET.length < 32) {
  throw new Error("API_SHARED_SECRET must be at least 32 characters. Generate with: openssl rand -hex 32");
}

/** Constant-time compare so the secret cannot be recovered by timing the
 *  response. Length is compared first because timingSafeEqual throws on a
 *  length mismatch. */
function secretMatches(presented: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(API_SHARED_SECRET!);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const requireApiCredential: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!presented || !secretMatches(presented)) {
    // Deliberately terse: never hint at whether the header was missing,
    // malformed or simply wrong.
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};
