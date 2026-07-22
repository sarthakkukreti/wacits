import { Queue } from "bullmq";
import { createRedisConnection } from "./connection";

// PRD §4.1 — the three named worker processes and their queues. The tenant
// or environment namespace is expressed with BullMQ's own `prefix` option,
// never an ioredis keyPrefix (see connection.ts).
const PREFIX = process.env.QUEUE_PREFIX ?? "wacits";

export const sendQueue = new Queue("send", { connection: createRedisConnection(), prefix: PREFIX });
export const importQueue = new Queue("import", { connection: createRedisConnection(), prefix: PREFIX });
export const schedulerQueue = new Queue("scheduler", { connection: createRedisConnection(), prefix: PREFIX });

// AR-4/AR-9: the webhook receiver's only job is verify → persist → ack.
// Interpretation happens here, off the request path, where being slow is
// harmless and a retry is free.
export const webhookQueue = new Queue("webhook", { connection: createRedisConnection(), prefix: PREFIX });

export type SendJobData = {
  campaignRecipientId: string;
  campaignId: string;
  attemptKey: number;
};

export type ImportJobData = {
  importJobId: string;
};

export type SchedulerJobData = {
  task: "token_health_check" | "unresolved_send_sweep" | "campaign_launch_check";
};

export type WebhookJobData = {
  /** The webhook_event row to interpret. The raw bytes stay the source of
   *  truth, so reprocessing after a bug fix is always possible. */
  webhookEventId: string;
};
