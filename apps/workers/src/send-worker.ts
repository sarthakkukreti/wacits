import { Worker } from "bullmq";
import { createRedisConnection, type SendJobData } from "@wacits/queue";
import { eq } from "drizzle-orm";
import { campaignRecipient, withSystemAccess } from "@wacits/db";

/**
 * PRD §13 Sending engine — drains the send queue, applies throttles, calls
 * Meta, records the result. This scaffold wires the queue, the idempotency
 * guard (AR-13/AR-15/AR-16) and the state machine transitions correctly;
 * the actual Meta Cloud API call is a TODO because CITS has not completed
 * Meta onboarding yet (see docs/PRD.md Appendix B / §25 Phase 0) — there is
 * no WABA, no registered number and no access token to call with.
 *
 * What IS real here: a job is only ever allowed to move a recipient row
 * forward from `pending`/`queued`, never resend once it has left that
 * state (AR-13's uniqueness constraint on
 * (campaign_id, recipient_id, template_version_id, attempt_key) is the
 * actual backstop; this check is the first line of defence in front of it).
 */
const worker = new Worker<SendJobData>(
  "send",
  async (job) => {
    const { campaignRecipientId } = job.data;

    await withSystemAccess(async (tx) => {
      const [row] = await tx
        .select()
        .from(campaignRecipient)
        .where(eq(campaignRecipient.id, campaignRecipientId))
        .limit(1);

      if (!row) {
        console.warn(`[send-worker] campaign_recipient ${campaignRecipientId} not found — skipping.`);
        return;
      }

      if (row.state !== "pending" && row.state !== "queued") {
        // AR-16: never resend. This job is a duplicate delivery of a
        // BullMQ job (at-least-once), not a genuine retry request.
        console.log(`[send-worker] ${campaignRecipientId} already in state '${row.state}' — no-op.`);
        return;
      }

      // TODO (Phase 3, §13.2-§13.4): call POST /<PHONE_NUMBER_ID>/messages
      // with row.resolvedParameterValues against the template version,
      // passing row.sendId as biz_opaque_callback_data (AR-14). On success,
      // move to 'accepted' and record the returned wamid on `message`
      // (AR-15) — never move straight to 'sent'. On failure, look up
      // (api_surface, code) in error_code_classification (DM-27) and act
      // per its class, never a hardcoded switch (APP-2).
      console.log(
        `[send-worker] would send campaign_recipient ${campaignRecipientId} ` +
          `(attempt ${row.attemptKey}) — Meta call not yet implemented.`,
      );

      await tx.update(campaignRecipient).set({ state: "queued" }).where(eq(campaignRecipient.id, row.id));
    });
  },
  { connection: createRedisConnection(), prefix: process.env.QUEUE_PREFIX ?? "wacits" },
);

worker.on("failed", (job, err) => {
  console.error(`[send-worker] job ${job?.id} failed:`, err);
});

console.log("Send worker running.");
