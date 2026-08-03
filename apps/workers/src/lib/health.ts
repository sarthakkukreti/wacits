import type { Worker } from "bullmq";

/**
 * A minimal HTTP surface so Docker/Coolify can detect a HUNG worker, not
 * just a crashed one. `restart: unless-stopped` (docker-compose.yml)
 * already catches a crashed process; before this, a wedged one — stuck on
 * a DB transaction, a poisoned job looping forever — was invisible, since
 * these four containers had no health check at all, unlike api/webhook/
 * click-redirect which all already expose one. Mirrors that same pattern.
 */
export function startWorkerHealthServer(port: number, worker: Worker<any>) {
  Bun.serve({
    port,
    fetch(req) {
      if (new URL(req.url).pathname !== "/health") return new Response("Not found", { status: 404 });
      const ok = worker.isRunning();
      return Response.json({ status: ok ? "ok" : "error", service: "worker" }, { status: ok ? 200 : 503 });
    },
  });
}
