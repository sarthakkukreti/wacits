import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiSafe } from "./api";
import { SESSION_COOKIE } from "./session-cookie";

export type SessionUser = { id: string; email: string; name: string; superAdmin: boolean };
export type Session = { user: SessionUser };

/** Reads the cookie and asks the API whether it's still valid — this is
 *  the REAL check. middleware.ts only checks the cookie is present (cheap,
 *  no DB round trip); this closes the "cookie present but expired/revoked"
 *  gap that a purely-Edge check can't. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const result = await apiSafe<{ user: SessionUser }>("/auth/session", { tenant: false, sessionToken: token });
  return result.ok ? { user: result.data.user } : null;
}

/** Call this once per page render (the root layout) rather than at every
 *  page individually — see apps/web/app/layout.tsx. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
