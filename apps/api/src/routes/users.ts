import { Hono } from "hono";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { user, userClientRole, withSystemAccess, withTenant } from "@wacits/db";
import { WORKSPACE_ROLES } from "@wacits/shared";
import { requirePermission } from "../middleware/permission";
import { writeAuditLog } from "../lib/audit";

/**
 * Minimal workspace user/role management. This exists so RBAC (middleware/
 * permission.ts) has a real, permissioned way to onboard a second user
 * instead of a hand-written SQL insert — it is deliberately NOT the PRD's
 * full RP-8 invite flow: no email is sent, no invitation token, and no
 * password is set here, so a user granted a role here still cannot sign in
 * until a real invite/first-login flow (Phase 2/3) sets one. Team-management
 * UI is likewise Phase 2/3 — this is API-only for now, same operational
 * posture as before (an admin action) but permissioned and audited instead
 * of raw SQL.
 */
const users = new Hono();

users.get("/", requirePermission("manage_users"), async (c) => {
  const { clientId } = c.get("tenant");

  const roles = await withTenant(clientId, (tx) =>
    tx
      .select({ userId: userClientRole.userId, role: userClientRole.role, grantedAt: userClientRole.grantedAt })
      .from(userClientRole)
      .where(and(eq(userClientRole.clientId, clientId), isNull(userClientRole.revokedAt))),
  );

  const userIds = roles.map((r: any) => r.userId);
  const people = userIds.length
    ? await withSystemAccess((tx) =>
        tx.select({ id: user.id, email: user.email, name: user.name }).from(user).where(inArray(user.id, userIds)),
      )
    : [];
  const byId = new Map(people.map((p: any) => [p.id, p]));

  return c.json({
    users: roles.map((r: any) => ({ ...r, ...(byId.get(r.userId) ?? {}) })),
  });
});

users.post("/", requirePermission("manage_users"), async (c) => {
  const { clientId, userId: actorId } = c.get("tenant");
  const body = await c.req.json<{ email?: string; name?: string; role?: string }>();

  const email = body.email?.trim().toLowerCase();
  if (!email) return c.json({ error: "email is required" }, 400);
  if (!body.role || !(WORKSPACE_ROLES as readonly string[]).includes(body.role)) {
    return c.json({ error: `role must be one of: ${WORKSPACE_ROLES.join(", ")}` }, 400);
  }

  // `user` is a platform-level table (not scoped to one client), same
  // check-then-insert pattern as bootstrap-admin.ts / lib/operator.ts.
  const targetUserId: string = await withSystemAccess(async (tx) => {
    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    if (existing) return existing.id;

    const [created] = await tx
      .insert(user)
      .values({ email, name: body.name?.trim() || email, emailVerified: false, superAdmin: false })
      .onConflictDoNothing({ target: user.email })
      .returning({ id: user.id });
    if (created) return created.id;

    const [raced] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    return raced!.id;
  });

  const result = await withTenant(clientId, async (tx) => {
    const [existingRole] = await tx
      .select({ id: userClientRole.id })
      .from(userClientRole)
      .where(
        and(
          eq(userClientRole.userId, targetUserId),
          eq(userClientRole.clientId, clientId),
          isNull(userClientRole.revokedAt),
        ),
      )
      .limit(1);
    if (existingRole) return { error: "This user already has a role in this workspace." as const };

    const [grant] = await tx
      .insert(userClientRole)
      .values({ userId: targetUserId, clientId, role: body.role as any, grantedBy: actorId })
      .returning();

    await writeAuditLog(tx, {
      clientId,
      actorUserId: actorId,
      action: "role_granted",
      entityType: "user_client_role",
      entityId: grant!.id,
      beforeAfterSummary: { userId: targetUserId, email, role: body.role },
    });

    return { grant };
  });

  if ("error" in result) return c.json({ error: result.error }, 409);
  return c.json({ userId: targetUserId, email, role: body.role }, 201);
});

export default users;
