import { eq } from "drizzle-orm";
import { user, withSystemAccess } from "@wacits/db";

/**
 * Many tables record *who* did something as a non-null FK to `user`
 * (contact_tag.applied_by, import_job.uploaded_by, consent_record.recorded_by
 * …). That is correct and should stay — an audit trail with a nullable
 * actor is not an audit trail.
 *
 * Every dashboard route now attributes writes to the real signed-in user via
 * `c.get("tenant").userId` (see middleware/tenant.ts) — no route calls
 * getOperatorUserId() any more. This account is reserved for genuinely
 * unattended, system-initiated writes with no human actor (none exist yet);
 * kept as one row, clearly named, so any historical row still attributed to
 * it is obviously pre-dating real per-user attribution rather than being
 * silently mixed in with it.
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
