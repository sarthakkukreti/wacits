import { auditLog } from "@wacits/db";

/**
 * PRD §18 audit trail. Call this inside the SAME transaction as the
 * business write it records, so the two are atomic — an audited action
 * that fails to log, or a log entry for an action that got rolled back,
 * are both worse than not having a log at all.
 *
 * This covers the highest-value event subset for Phase 1 (login/logout,
 * membership-denied, role grants, contact delete/opt-out/opt-in, campaign
 * launch, token reveal) — not the PRD's full §18 event table. Template
 * lifecycle, merge/erasure, and full AU-8–17 notification routing are not
 * covered yet; that is a known, documented gap, not a silent omission.
 */
export async function writeAuditLog(
  tx: any,
  entry: {
    clientId: string | null;
    actorUserId: string | null;
    actorType?: "user" | "system" | "webhook";
    action: string;
    entityType: string;
    entityId?: string | null;
    beforeAfterSummary?: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
    correlationId?: string | null;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    clientId: entry.clientId,
    actorUserId: entry.actorUserId,
    actorType: entry.actorType ?? "user",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    beforeAfterSummary: entry.beforeAfterSummary ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    correlationId: entry.correlationId ?? null,
  });
}
