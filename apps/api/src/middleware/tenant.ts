import type { MiddlewareHandler } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { userClientRole, withSystemAccess } from "@wacits/db";
import type { WorkspaceRole } from "@wacits/shared";
import { resolveSession } from "../lib/session";
import { writeAuditLog } from "../lib/audit";

/**
 * Resolves the active workspace for a request AND verifies the signed-in
 * user actually belongs to it. `x-client-id` names the target workspace
 * (set by apps/web/lib/api.ts's resolveClientId()); `x-session-token`
 * identifies the caller (auto-attached from the session cookie — see
 * apps/web/lib/api.ts). Every route under /workspace goes through this
 * before touching withTenant()/RLS, so `role` here is what
 * requirePermission() (middleware/permission.ts) checks against — never a
 * client-supplied value.
 */
export type TenantContext = {
  clientId: string;
  userId: string;
  role: WorkspaceRole | "super_admin";
};

export const tenantMiddleware: MiddlewareHandler = async (c, next) => {
  const clientId = c.req.header("x-client-id");
  if (!clientId) {
    return c.json({ error: "Missing x-client-id header." }, 400);
  }

  const sessionToken = c.req.header("x-session-token");
  const sessionUser = sessionToken ? await resolveSession(sessionToken) : null;
  if (!sessionUser) {
    return c.json({ error: "Missing or invalid session." }, 401);
  }

  if (sessionUser.superAdmin) {
    c.set("tenant", { clientId, userId: sessionUser.id, role: "super_admin" } satisfies TenantContext);
    await next();
    return;
  }

  const [membership] = await withSystemAccess((tx) =>
    tx
      .select({ role: userClientRole.role })
      .from(userClientRole)
      .where(
        and(
          eq(userClientRole.userId, sessionUser.id),
          eq(userClientRole.clientId, clientId),
          isNull(userClientRole.revokedAt),
        ),
      )
      .limit(1),
  );

  if (!membership) {
    // A non-member trying a workspace is itself worth recording — it's
    // either a stale client link or a real access-boundary probe.
    await withSystemAccess((tx) =>
      writeAuditLog(tx, {
        clientId,
        actorUserId: sessionUser.id,
        action: "access_denied_not_member",
        entityType: "client",
        entityId: clientId,
      }),
    );
    return c.json({ error: "You are not a member of this workspace." }, 403);
  }

  c.set("tenant", {
    clientId,
    userId: sessionUser.id,
    role: membership.role as WorkspaceRole,
  } satisfies TenantContext);
  await next();
};

declare module "hono" {
  interface ContextVariableMap {
    tenant: TenantContext;
  }
}
