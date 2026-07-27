import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { session, user, withSystemAccess } from "@wacits/db";

/**
 * A session token is a bearer secret for its lifetime, exactly like a
 * password — stored hashed, never in the clear, mirroring how nothing else
 * in this codebase persists a raw credential (see crypto.ts's envelope
 * encryption, maskToken). Callers hold the raw token (the cookie value);
 * only its SHA-256 ever touches the database.
 */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export type SessionUser = { id: string; email: string; name: string; superAdmin: boolean };

/**
 * Resolves a raw session token to its user, or null if missing/expired.
 * Not tenant-scoped — a user isn't one workspace — so this runs under
 * withSystemAccess like getOperatorUserId() and the /clients lookups do.
 */
export async function resolveSession(rawToken: string): Promise<SessionUser | null> {
  if (!rawToken) return null;

  return withSystemAccess(async (tx) => {
    const [row] = await tx
      .select({
        expiresAt: session.expiresAt,
        userId: user.id,
        email: user.email,
        name: user.name,
        superAdmin: user.superAdmin,
      })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(eq(session.token, hashToken(rawToken)))
      .limit(1);

    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    return { id: row.userId, email: row.email, name: row.name, superAdmin: row.superAdmin };
  });
}
