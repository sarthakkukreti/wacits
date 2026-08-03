import type { MiddlewareHandler } from "hono";
import { PERMISSION_MATRIX } from "@wacits/shared";

/**
 * PRD §6.2 RBAC enforcement. `tenant.role` is verified membership (see
 * middleware/tenant.ts), never a client-supplied value, so this is the real
 * authorization boundary — not a UI affordance. Super Admin always passes.
 *
 * A `true`/`false` grant in PERMISSION_MATRIX is decided entirely here. A
 * string grant (e.g. "own import, within 24h", "opt-out only, not
 * re-opt-in") means the role has SOME access to this action but with a
 * qualifier this middleware cannot evaluate on its own (it doesn't know the
 * request body or the target row's owner) — those routes pass here and
 * enforce the qualifier themselves inline; see the call sites.
 */
export function requirePermission(action: keyof typeof PERMISSION_MATRIX): MiddlewareHandler {
  return async (c, next) => {
    const tenant = c.get("tenant");
    if (tenant.role === "super_admin") {
      await next();
      return;
    }

    const grant = PERMISSION_MATRIX[action][tenant.role];
    if (grant === false) {
      return c.json({ error: `Not permitted: ${action}` }, 403);
    }

    await next();
  };
}
