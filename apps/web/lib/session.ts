import "server-only";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiSafe } from "./api";
import { SESSION_COOKIE } from "./session-cookie";

export type SessionUser = { id: string; email: string; name: string; superAdmin: boolean };
export type Session = { user: SessionUser };

/**
 * getSession() runs on every page render (the root layout) and on every
 * poll of the same-origin conversations proxy — each call is otherwise a
 * fresh cross-host HTTP round trip from this Node process to the API. This
 * module-level cache, keyed by a hash of the token, cuts that down to
 * roughly one real check per token per CACHE_TTL_MS: the web app is a
 * single long-lived Node/Passenger process (not per-request serverless
 * cold starts), so a plain in-memory Map persists naturally across
 * requests for the process's lifetime.
 *
 * Caching a NEGATIVE result (session invalid/expired) is safe here too —
 * a given token's validity is monotonic (a session only ever goes from
 * valid to invalid via logout or expiry, never the reverse), and a fresh
 * login always mints a brand new token, so there is no path where a stale
 * cached "invalid" for one token wrongly shadows a later-valid one.
 *
 * The tradeoff this accepts: a session revoked (logout, password change)
 * elsewhere can still be honoured here for up to CACHE_TTL_MS. Kept short
 * enough that this is a non-issue in practice for a low-traffic internal
 * admin tool, long enough to eliminate the vast majority of repeat calls
 * during a single browsing session.
 */
const CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 500;

const cache = new Map<string, { session: Session | null; expiresAt: number }>();

function cacheKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  // Defensive bound, not expected to matter at this app's scale: evict the
  // oldest entries (Map iterates in insertion order) if it still overflows.
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

/** Reads the cookie and asks the API whether it's still valid — this is
 *  the REAL check. middleware.ts only checks the cookie is present (cheap,
 *  no DB round trip); this closes the "cookie present but expired/revoked"
 *  gap that a purely-Edge check can't. Result is cached briefly — see the
 *  module comment above. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const key = cacheKey(token);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.session;

  const result = await apiSafe<{ user: SessionUser }>("/auth/session", { tenant: false, sessionToken: token });
  const session = result.ok ? { user: result.data.user } : null;

  pruneExpired();
  cache.set(key, { session, expiresAt: Date.now() + CACHE_TTL_MS });

  return session;
}

/** Called by logoutAction() so a signed-out session can never be served
 *  from cache for the remainder of its TTL. */
export function invalidateSessionCache(token: string): void {
  cache.delete(cacheKey(token));
}

/** Call this once per page render (the root layout) rather than at every
 *  page individually — see apps/web/app/layout.tsx. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
