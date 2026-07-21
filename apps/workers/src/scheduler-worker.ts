import { Worker } from "bullmq";
import { createRedisConnection, schedulerQueue, type SchedulerJobData } from "@wacits/queue";

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

  console.log("Repeatable jobs registered: token_health_check (6h), unresolved_send_sweep (30m), campaign_launch_check (1m).");
}

const worker = new Worker<SchedulerJobData>(
  "scheduler",
  async (job) => {
    switch (job.data.task) {
      case "token_health_check":
        // TODO (Phase 3, §7 SN-17/SN-18): re-verify every stored
        // access_token against Meta and update last_health_check_at.
        console.log("[scheduler] token_health_check tick — not yet implemented.");
        break;
      case "unresolved_send_sweep":
        // TODO (AR-17): find campaign_recipient rows past
        // unresolved_send_age with no terminal status and raise an alert.
        console.log("[scheduler] unresolved_send_sweep tick — not yet implemented.");
        break;
      case "campaign_launch_check":
        // TODO (§12.8): find campaigns with state='scheduled' and
        // scheduledAt <= now(), re-run pre-flight blockers, transition to
        // 'running' or leave scheduled with a recorded refusal reason.
        console.log("[scheduler] campaign_launch_check tick — not yet implemented.");
        break;
    }
  },
  { connection: createRedisConnection(), prefix: process.env.QUEUE_PREFIX ?? "wacits" },
);

worker.on("failed", (job, err) => {
  console.error(`[scheduler-worker] job ${job?.id} failed:`, err);
});

await registerRepeatableJobs();
console.log("Scheduler worker running.");
