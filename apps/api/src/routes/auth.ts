import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { account, session, user, withSystemAccess } from "@wacits/db";
import { hashPassword, verifyPassword } from "@wacits/shared";
import { hashToken, resolveSession } from "../lib/session";
import { checkLoginRateLimit, recordLoginFailure, resetLoginRateLimit } from "../lib/login-rate-limit";
import { writeAuditLog } from "../lib/audit";

/**
 * End-user login/session. Platform-level (a user isn't scoped to one
 * workspace), mounted alongside /clients in index.ts — AFTER
 * requireApiCredential, same as every other route in this file's
 * neighbors. Only the Next.js server calls these (see apps/web/lib/
 * session.ts); the browser still never talks to this API directly. The
 * session identifier travels in a separate x-session-token header since
 * Authorization is already the service-to-service credential.
 */
const auth = new Hono();

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, fixed — see rollout notes

// Computed once at module load from a throwaway random string, so a login
// attempt against an email that doesn't exist costs the same scrypt
// computation (same wall-clock time) as one against a real email with the
// wrong password — otherwise the response time itself would tell an
// attacker which emails have accounts.
const DUMMY_HASH = hashPassword(randomBytes(32).toString("hex"));

auth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  // This call is server-to-server (Next.js → API), so the real client IP is
  // whatever the web app forwards from its own request, not this
  // connection's peer — trusted the same way every field already is inside
  // the API_SHARED_SECRET boundary.
  const ipAddress = typeof body?.ipAddress === "string" ? body.ipAddress.slice(0, 255) : null;
  const userAgent = typeof body?.userAgent === "string" ? body.userAgent.slice(0, 512) : null;

  if (!email || !password) return c.json({ error: "Email and password are required." }, 400);

  const rl = await checkLoginRateLimit(email, ipAddress);
  if (!rl.allowed) {
    c.header("Retry-After", String(rl.retryAfterSeconds));
    return c.json({ error: "Too many attempts. Try again later." }, 429);
  }

  const [row] = await withSystemAccess((tx) =>
    tx
      .select({ userId: user.id, superAdmin: user.superAdmin, name: user.name, passwordHash: account.passwordHash })
      .from(user)
      .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "credential")))
      .where(eq(user.email, email))
      .limit(1),
  );

  const ok = !!row && verifyPassword(password, row.passwordHash ?? DUMMY_HASH);
  if (!ok) {
    // Always run a scrypt computation, even when `row` is missing, via
    // DUMMY_HASH above — see the module comment.
    if (!row) verifyPassword(password, DUMMY_HASH);
    await recordLoginFailure(email, ipAddress);
    await withSystemAccess((tx) =>
      writeAuditLog(tx, {
        clientId: null,
        actorUserId: row?.userId ?? null,
        action: "login_failure",
        entityType: "user",
        entityId: row?.userId ?? null,
        beforeAfterSummary: { email },
        ipAddress,
        userAgent,
      }),
    );
    // Deliberately identical message/status whether the email doesn't
    // exist or the password is wrong — same terse philosophy as
    // requireApiCredential (middleware/auth.ts).
    return c.json({ error: "Invalid email or password." }, 401);
  }
  await resetLoginRateLimit(email, ipAddress);

  const rawToken = randomBytes(32).toString("hex"); // 256-bit
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await withSystemAccess(async (tx) => {
    await tx.insert(session).values({ userId: row!.userId, token: hashToken(rawToken), expiresAt, ipAddress, userAgent });
    await tx.update(user).set({ lastSignInAt: new Date() }).where(eq(user.id, row!.userId));
    await writeAuditLog(tx, {
      clientId: null,
      actorUserId: row!.userId,
      action: "login_success",
      entityType: "user",
      entityId: row!.userId,
      ipAddress,
      userAgent,
    });
  });

  return c.json({
    sessionToken: rawToken,
    expiresAt: expiresAt.toISOString(),
    user: { id: row!.userId, email, name: row!.name, superAdmin: row!.superAdmin },
  });
});

auth.get("/session", async (c) => {
  const resolved = await resolveSession(c.req.header("x-session-token") ?? "");
  if (!resolved) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ user: resolved });
});

/** Idempotent — 204 whether or not the token was still valid. */
auth.post("/logout", async (c) => {
  const token = c.req.header("x-session-token") ?? "";
  if (token) {
    // Resolved before deleting so the audit entry can name a real actor —
    // an already-expired/invalid token still deletes cleanly but leaves
    // nothing meaningful to log.
    const resolved = await resolveSession(token);
    await withSystemAccess(async (tx) => {
      await tx.delete(session).where(eq(session.token, hashToken(token)));
      if (resolved) {
        await writeAuditLog(tx, {
          clientId: null,
          actorUserId: resolved.id,
          action: "logout",
          entityType: "user",
          entityId: resolved.id,
        });
      }
    });
  }
  return c.body(null, 204);
});

auth.post("/change-password", async (c) => {
  const resolved = await resolveSession(c.req.header("x-session-token") ?? "");
  if (!resolved) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < 12) return c.json({ error: "New password must be at least 12 characters." }, 400);

  const [row] = await withSystemAccess((tx) =>
    tx
      .select({ passwordHash: account.passwordHash })
      .from(account)
      .where(and(eq(account.userId, resolved.id), eq(account.providerId, "credential")))
      .limit(1),
  );

  if (!row || !verifyPassword(currentPassword, row.passwordHash ?? "")) {
    // Fine to be specific here — the caller is already authenticated.
    return c.json({ error: "Current password is incorrect." }, 401);
  }

  await withSystemAccess((tx) =>
    tx
      .update(account)
      .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
      .where(and(eq(account.userId, resolved.id), eq(account.providerId, "credential"))),
  );

  return c.json({ ok: true });
});

export default auth;
