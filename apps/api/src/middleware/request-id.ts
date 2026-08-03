import type { MiddlewareHandler } from "hono";

/**
 * AU-2: a correlation identifier shared by every log line, queue job and
 * outbound API call tied to the same originating request. Trusts an
 * incoming x-request-id (Caddy or another upstream may already set one)
 * and otherwise mints a fresh one; always echoed back on the response so
 * a caller can quote it when reporting an issue.
 */
export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const id = incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
};

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}
