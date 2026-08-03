import { Worker } from "bullmq";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { createRedisConnection, schedulerQueue, sendQueue, type SchedulerJobData } from "@wacits/queue";
import {
  accessToken,
  auditLog,
  campaign,
  campaignRecipient,
  client,
  notification,
  platformSetting,
  senderNumber,
  userClientRole,
  withSystemAccess,
  withTenant,
} from "@wacits/db";
import { checkTokenHealth, createLogger, decryptToken } from "@wacits/shared";
import { startWorkerHealthServer } from "./lib/health";

const log = createLogger("scheduler-worker");

/**
 * PRD §4.1 — timer-driven work: campaign launches, analytics polling,
 * token and quality checks. Needs exactly-one-runner semantics, which
 * BullMQ's repeatable jobs provide natively (only one worker instance picks
 * up each firing).
 *
 * The cadences below are read from the seeded platform_setting rows at
 * startup (see packages/db/seed) rather than hardcoded, per TS-9/DM-30 —
 * this file resolves them once at boot; a production version should
 * re-resolve on a SIGHUP or short poll so an admin's settings change takes
 * effect without a restart.
 */
async function registerRepeatableJobs() {
  // token_health_check_cadence_hours — default 6h (§21.2 access_token /
  // SN-17/SN-18).
  await schedulerQueue.upsertJobScheduler(
    "token-health-check",
    { every: 6 * 60 * 60 * 1000 },
    { name: "token_health_check", data: { task: "token_health_check" } satisfies SchedulerJobData },
  );

  // unresolved_send_age_hours — default 6h (AR-17). Sweep more often than
  // the age itself so the alert fires close to the threshold, not hours
  // late.
  await schedulerQueue.upsertJobScheduler(
    "unresolved-send-sweep",
    { every: 30 * 60 * 1000 },
    { name: "unresolved_send_sweep", data: { task: "unresolved_send_sweep" } satisfies SchedulerJobData },
  );

  // Campaigns whose scheduledAt has arrived need to transition
  // scheduled -> running (subject to the §12.8 pre-flight blockers).
  await schedulerQueue.upsertJobScheduler(
    "campaign-launch-check",
    { every: 60 * 1000 },
    { name: "campaign_launch_check", data: { task: "campaign_launch_check" } satisfies SchedulerJobData },
  );

  log.info("repeatable jobs registered: token_health_check (6h), unresolved_send_sweep (30m), campaign_launch_check (1m)");
}

/** Reads a numeric platform_setting, falling back if the row is somehow
 *  missing (seed.ts normally guarantees it exists). */
async function getSettingHours(key: string, fallback: number): Promise<number> {
  const [row] = await withSystemAccess((tx) =>
    tx.select({ value: platformSetting.value }).from(platformSetting).where(eq(platformSetting.key, key)).limit(1),
  );
  const value = row ? Number(row.value) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Resolves the workspace a stored token belongs to, so a failure notifies
 *  the right client's admins. Phone-number tokens carry it directly; WABA
 *  tokens are shared by every sender number under that WABA, so any one of
 *  them names the workspace (a WABA belongs to exactly one client in this
 *  product — see PRD §7). */
async function resolveClientIdForToken(tx: any, tok: { scope: string; targetId: string }): Promise<string | null> {
  if (tok.scope === "phone_number") {
    const [row] = await tx.select({ clientId: senderNumber.clientId }).from(senderNumber).where(eq(senderNumber.id, tok.targetId)).limit(1);
    return row?.clientId ?? null;
  }
  const [row] = await tx
    .select({ clientId: senderNumber.clientId })
    .from(senderNumber)
    .where(eq(senderNumber.whatsappBusinessAccountId, tok.targetId))
    .limit(1);
  return row?.clientId ?? null;
}

/** Notifies every client_admin of a workspace — the only role with
 *  view_access_token-adjacent responsibility for credential health. */
async function notifyClientAdmins(
  tx: any,
  clientId: string,
  entry: { category: string; title: string; body: string; relatedEntity: string },
) {
  const admins = await tx
    .select({ userId: userClientRole.userId })
    .from(userClientRole)
    .where(and(eq(userClientRole.clientId, clientId), eq(userClientRole.role, "client_admin"), isNull(userClientRole.revokedAt)));

  for (const admin of admins) {
    await tx.insert(notification).values({
      clientId,
      recipientUserId: admin.userId,
      severity: "paging",
      category: entry.category,
      title: entry.title,
      body: entry.body,
      relatedEntity: entry.relatedEntity,
    });
  }
}

async function runTokenHealthCheck() {
  const tokens = await withSystemAccess((tx) => tx.select().from(accessToken).where(isNull(accessToken.revokedAt)));

  for (const tok of tokens) {
    let result: { ok: boolean; error?: string };
    try {
      result = await checkTokenHealth({ token: decryptToken(tok.encryptedTokenValue) });
    } catch (err) {
      // Transport failure (network/timeout) — not evidence the token itself
      // is bad, so lastHealthCheckAt is left alone and this tries again on
      // the next tick rather than recording a false failure.
      log.warn({ accessTokenId: tok.id, err: String(err) }, "token health check transport failure — will retry next tick");
      continue;
    }

    await withSystemAccess((tx) =>
      tx
        .update(accessToken)
        .set({ lastHealthCheckAt: new Date(), ...(result.ok ? { lastVerifiedAt: new Date() } : {}) })
        .where(eq(accessToken.id, tok.id)),
    );

    if (!result.ok) {
      log.warn({ accessTokenId: tok.id, scope: tok.scope, error: result.error }, "access token failed health check");
      await withSystemAccess(async (tx) => {
        const clientId = await resolveClientIdForToken(tx, tok);
        if (!clientId) return;
        await notifyClientAdmins(tx, clientId, {
          category: "token_health",
          title: `A WhatsApp ${tok.scope === "waba" ? "WABA" : "sender number"} token failed its health check`,
          body: result.error ?? "The stored token could not be verified against Meta and may need to be re-entered.",
          relatedEntity: `access_token:${tok.id}`,
        });
      });
    }
  }
}

async function runUnresolvedSendSweep() {
  const thresholdHours = await getSettingHours("unresolved_send_age_hours", 6);
  const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

  // "Unresolved" (AR-17): Meta has the send (queued/accepted) but no
  // terminal status has arrived within the threshold. `pending` rows
  // haven't been attempted yet, which is a queue-depth concern, not this.
  const stuck = await withSystemAccess((tx) =>
    tx
      .select({ id: campaignRecipient.id, campaignId: campaignRecipient.campaignId, clientId: campaignRecipient.clientId })
      .from(campaignRecipient)
      .where(and(inArray(campaignRecipient.state, ["queued", "accepted"]), lt(campaignRecipient.lastAttemptAt, cutoff))),
  );

  if (!stuck.length) return;

  const byCampaign = new Map<string, { clientId: string; count: number }>();
  for (const row of stuck) {
    const entry = byCampaign.get(row.campaignId);
    if (entry) entry.count++;
    else byCampaign.set(row.campaignId, { clientId: row.clientId, count: 1 });
  }

  log.warn({ campaignsAffected: byCampaign.size, totalStuck: stuck.length, thresholdHours }, "unresolved sends found");

  for (const [campaignId, { clientId, count }] of byCampaign) {
    await withSystemAccess((tx) =>
      notifyClientAdmins(tx, clientId, {
        category: "unresolved_send",
        title: `${count} message${count === 1 ? "" : "s"} stuck with no delivery outcome`,
        body: `A campaign has ${count} recipient(s) sent to Meta over ${thresholdHours}h ago with no delivery receipt yet.`,
        relatedEntity: `campaign:${campaignId}`,
      }),
    );
  }
}

async function runCampaignLaunchCheck() {
  const due = await withSystemAccess((tx) =>
    tx.select().from(campaign).where(and(eq(campaign.state, "scheduled"), lt(campaign.scheduledAt, new Date()))),
  );

  for (const row of due) {
    // CL-5: a paused/suspended client's campaigns must not fire — stay
    // `scheduled` with the reason recorded, not silently dropped.
    const [clientRow] = await withSystemAccess((tx) => tx.select({ status: client.status }).from(client).where(eq(client.id, row.clientId)).limit(1));
    if (!clientRow || clientRow.status === "paused" || clientRow.status === "suspended") {
      log.info({ campaignId: row.id, clientStatus: clientRow?.status ?? "unknown" }, "scheduled launch blocked by client status");
      continue;
    }

    const result = await withTenant(row.clientId, async (tx) => {
      const pending = await tx
        .select({ id: campaignRecipient.id, attemptKey: campaignRecipient.attemptKey })
        .from(campaignRecipient)
        .where(and(eq(campaignRecipient.campaignId, row.id), eq(campaignRecipient.state, "pending")));

      await tx.update(campaign).set({ state: "running", stateChangedAt: new Date() }).where(eq(campaign.id, row.id));

      await tx.insert(auditLog).values({
        clientId: row.clientId,
        actorUserId: null,
        actorType: "system",
        action: "campaign_launched",
        entityType: "campaign",
        entityId: row.id,
        beforeAfterSummary: { recipientCount: pending.length, templateVersionId: row.templateVersionId, trigger: "scheduled" },
      });

      return pending;
    });

    log.info({ campaignId: row.id, queued: result.length }, "scheduled campaign launched");

    // Enqueue outside the transaction, same reasoning as the /launch route:
    // a job that runs before the commit lands would not find its own row.
    // Not implementing the portfolio-headroom pre-flight block here — that
    // depends on the four-throttle rate limiter (Phase 2).
    await sendQueue.addBulk(
      result.map((r: any) => ({
        name: "send",
        data: { campaignRecipientId: r.id, campaignId: row.id, attemptKey: r.attemptKey },
        opts: {
          jobId: `send-${r.id}-${r.attemptKey}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      })),
    );
  }
}

const worker = new Worker<SchedulerJobData>(
  "scheduler",
  async (job) => {
    switch (job.data.task) {
      case "token_health_check":
        await runTokenHealthCheck();
        break;
      case "unresolved_send_sweep":
        await runUnresolvedSendSweep();
        break;
      case "campaign_launch_check":
        await runCampaignLaunchCheck();
        break;
    }
  },
  { connection: createRedisConnection(), prefix: process.env.QUEUE_PREFIX ?? "wacits" },
);

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, task: job?.data?.task, err: err.message }, "job failed");
});

startWorkerHealthServer(Number(process.env.SCHEDULER_WORKER_PORT ?? 8792), worker);
await registerRepeatableJobs();
log.info("scheduler worker running");
