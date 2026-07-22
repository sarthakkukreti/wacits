import { eq } from "drizzle-orm";
import { user, withSystemAccess } from "@wacits/db";

/**
 * Many tables record *who* did something as a non-null FK to `user`
 * (contact_tag.applied_by, import_job.uploaded_by, consent_record.recorded_by
 * …). That is correct and should stay — an audit trail with a nullable
 * actor is not an audit trail.
 *
 * Real per-user auth (Better Auth) is Phase 1 and is not wired yet, so
 * until it is, every dashboard action is attributed to a single seeded
 * operator account. This is deliberately one row, clearly named, so that
 * when real sign-in arrives it is obvious which historical rows predate it
 * rather than being silently mixed in with genuine per-user attribution.
 */

const OPERATOR_EMAIL = "operator@cyberlative.local";

let cachedId: string | null = null;

export async function getOperatorUserId(): Promise<string> {
  if (cachedId) return cachedId;

  const id = await withSystemAccess(async (tx) => {
    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, OPERATOR_EMAIL)).limit(1);
    if (existing) return existing.id;

    const [created] = await tx
      .insert(user)
      .values({
        email: OPERATOR_EMAIL,
        name: "Dashboard Operator (pre-auth)",
        emailVerified: false,
        superAdmin: false,
      })
      .onConflictDoNothing({ target: user.email })
      .returning({ id: user.id });

    if (created) return created.id;

    const [raced] = await tx.select({ id: user.id }).from(user).where(eq(user.email, OPERATOR_EMAIL)).limit(1);
    return raced.id;
  });

  cachedId = id;
  return id;
}
