import { Queue } from "bullmq";
import { createRedisConnection } from "./connection";

// PRD §4.1 — the three named worker processes and their queues. The tenant
// or environment namespace is expressed with BullMQ's own `prefix` option,
// never an ioredis keyPrefix (see connection.ts).
const PREFIX = process.env.QUEUE_PREFIX ?? "wacits";

export const sendQueue = new Queue("send", { connection: createRedisConnection(), prefix: PREFIX });

// `send` and `webhook` set attempts/backoff per-job at their .add()/.addBulk()
// call sites (campaigns.ts, apps/webhook/src/index.ts) because those jobs
// carry send-specific idempotency requirements. `import` and `scheduler` had
// no retry config at all — riding BullMQ's default of zero retries — so a
// transient DB hiccup mid-import or mid-sweep failed permanently on the
// first try. These defaults apply to every job unless overridden per-call.
const RELIABLE_JOB_DEFAULTS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnFail: 5000,
};

export const importQueue = new Queue("import", {
  connection: createRedisConnection(),
  prefix: PREFIX,
  defaultJobOptions: RELIABLE_JOB_DEFAULTS,
});
export const schedulerQueue = new Queue("scheduler", {
  connection: createRedisConnection(),
  prefix: PREFIX,
  defaultJobOptions: RELIABLE_JOB_DEFAULTS,
});

// AR-4/AR-9: the webhook receiver's only job is verify → persist → ack.
// Interpretation happens here, off the request path, where being slow is
// harmless and a retry is free.
export const webhookQueue = new Queue("webhook", { connection: createRedisConnection(), prefix: PREFIX });

// AU-2: carried through so a worker's log lines can be joined back to the
// HTTP request that enqueued the job — see apps/api/src/middleware/
// request-id.ts. Optional: system-originated jobs (a scheduler tick) have
// no originating request.
type WithCorrelation = { correlationId?: string };

export type SendJobData = {
  campaignRecipientId: string;
  campaignId: string;
  attemptKey: number;
} & WithCorrelation;

export type ImportJobData = {
  importJobId: string;
} & WithCorrelation;

export type SchedulerJobData = {
  task: "token_health_check" | "unresolved_send_sweep" | "campaign_launch_check";
} & WithCorrelation;

export type WebhookJobData = {
  /** The webhook_event row to interpret. The raw bytes stay the source of
   *  truth, so reprocessing after a bug fix is always possible. */
  webhookEventId: string;
} & WithCorrelation;
