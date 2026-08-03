import pino from "pino";

/**
 * One structured (JSON) logger per process, tagged with which service
 * emitted the line — replaces the ad hoc console.log/error calls that
 * previously gave no way to filter or correlate log lines across the API,
 * webhook receiver, click-redirect, and the four workers. `correlationId`
 * (see AU-2) is passed per-call-site, not baked in here, since it varies
 * per request/job rather than per process.
 */
export function createLogger(service: string) {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? "info",
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
