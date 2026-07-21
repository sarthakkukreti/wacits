import type { MiddlewareHandler } from "hono";

/**
 * Resolves the active workspace for a request. Real auth (Better Auth
 * sessions, §6 role checks) is Phase 1 work — see PRD §25. For this
 * scaffold, the workspace and actor are taken from headers so the wiring
 * between web → API → withTenant()/RLS can be exercised end to end without
 * a full login flow. Every real route handler must resolve `clientId`
 * through this context, never by trusting a client-supplied value that
 * bypasses the session.
 */
export type TenantContext = {
  clientId: string;
  userId: string | null;
};

export const tenantMiddleware: MiddlewareHandler = async (c, next) => {
  const clientId = c.req.header("x-client-id");
  const userId = c.req.header("x-user-id") ?? null;

  if (!clientId) {
    return c.json(
      { error: "Missing x-client-id header. (Placeholder for a real session — see PRD §6/§25.)" },
      400,
    );
  }

  c.set("tenant", { clientId, userId } satisfies TenantContext);
  await next();
};

declare module "hono" {
  interface ContextVariableMap {
    tenant: TenantContext;
  }
}
