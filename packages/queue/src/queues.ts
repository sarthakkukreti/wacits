import { Queue } from "bullmq";
import { createRedisConnection } from "./connection";

// PRD §4.1 — the three named worker processes and their queues. The tenant
// or environment namespace is expressed with BullMQ's own `prefix` option,
// never an ioredis keyPrefix (see connection.ts).
const PREFIX = process.env.QUEUE_PREFIX ?? "wacits";

export const sendQueue = new Queue("send", { connection: createRedisConnection(), prefix: PREFIX });
export const importQueue = new Queue("import", { connection: createRedisConnection(), prefix: PREFIX });
export const schedulerQueue = new Queue("scheduler", { connection: createRedisConnection(), prefix: PREFIX });

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
