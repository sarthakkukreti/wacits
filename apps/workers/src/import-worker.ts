import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createRedisConnection, type ImportJobData } from "@wacits/queue";
import { importJob, withSystemAccess } from "@wacits/db";

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

    await withSystemAccess(async (tx) => {
      await tx.update(importJob).set({ state: "running", startedAt: new Date() }).where(eq(importJob.id, importJobId));

      // TODO (Phase 2, §9): stream the file through exceljs/papaparse,
      // validate + normalise phone numbers with libphonenumber-js (TS-4/
      // TS-5), detect duplicates, write import_error rows for rejects,
      // write import_created_contact rows for new contacts (DM-28 depends
      // on this), and require an explicit consent-source declaration
      // before any row can be marked opted-in.
      console.log(`[import-worker] would parse import job ${importJobId} — parser not yet implemented.`);

      await tx.update(importJob).set({ state: "completed", finishedAt: new Date() }).where(eq(importJob.id, importJobId));
    });
  },
  { connection: createRedisConnection(), prefix: process.env.QUEUE_PREFIX ?? "wacits" },
);

worker.on("failed", (job, err) => {
  console.error(`[import-worker] job ${job?.id} failed:`, err);
});

console.log("Import worker running.");
