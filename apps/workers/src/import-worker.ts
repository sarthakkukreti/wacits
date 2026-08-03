import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createRedisConnection, type ImportJobData } from "@wacits/queue";
import { importJob, withSystemAccess } from "@wacits/db";
import { createLogger } from "@wacits/shared";
import { startWorkerHealthServer } from "./lib/health";

const log = createLogger("import-worker");

/**
 * PRD §9 Contact import — parses uploaded spreadsheets/CSVs in a queued
 * background worker, never inline in a web request (IM: "must run in a
 * queued background worker"). The parse pipeline itself (exceljs/papaparse,
 * column mapping, phone normalisation, duplicate detection, consent
 * handling) is real business logic for Phase 2 (§25) — there is no upload
 * endpoint yet for it to consume. This scaffold wires the queue and the
 * job-state transitions so that piece can be dropped in without touching
 * anything else.
 */
const worker = new Worker<ImportJobData>(
  "import",
  async (job) => {
    const { importJobId } = job.data;

    // Nothing enqueues to `importQueue` today — the real parse pipeline
    // (apps/api/src/routes/imports.ts) runs synchronously inline in the
    // /commit HTTP handler instead, which is the PRD's own architecture
    // violation to fix (import must run queued, not inline), not a case of
    // this worker being unfinished. This path is therefore currently dead,
    // but a stub that silently marked the job "completed" without doing
    // anything was a landmine for whoever wires the queue up later and
    // misses this comment — so it fails loudly instead.
    await withSystemAccess(async (tx) => {
      await tx.update(importJob).set({ state: "running", startedAt: new Date() }).where(eq(importJob.id, importJobId));
      await tx.update(importJob).set({ state: "failed", finishedAt: new Date() }).where(eq(importJob.id, importJobId));
    });

    throw new Error(
      `import-worker has no parser implementation — see apps/api/src/routes/imports.ts for the real (synchronous) import logic. Job ${job.id} intentionally failed rather than reporting a false success.`,
    );
  },
  { connection: createRedisConnection(), prefix: process.env.QUEUE_PREFIX ?? "wacits" },
);

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, correlationId: job?.data?.correlationId, err: err.message }, "job failed");
});

startWorkerHealthServer(Number(process.env.IMPORT_WORKER_PORT ?? 8791), worker);
log.info("import worker running");
