import { and, eq } from "drizzle-orm";
import { account, user, withSystemAccess } from "@wacits/db";

/**
 * Idempotently seeds the one super-admin account this dashboard needs,
 * mirroring getOperatorUserId()'s check-then-insert pattern (lib/operator.ts)
 * so this is safe to run on every server boot, not just the first one.
 *
 * There is no way to run a one-off script against the production database
 * from outside it (no VPS/Coolify shell access, and neither `bun run
 * db:migrate` nor `db:seed` runs automatically on deploy — confirmed by
 * reading docker-compose.yml's `api` service, which has no command
 * override). The only code path guaranteed to run in production without a
 * manual step is whatever executes at normal API startup, which the
 * already-confirmed auto-deploy-on-push triggers on its own. Hence this
 * lives here rather than in packages/db/seed/seed.ts.
 *
 * Deliberately does NOT call hashPassword() at runtime: the hash below is
 * precomputed once, offline, against a randomly generated password shown
 * to the operator exactly once outside this repo. Computing it here would
 * make server boot depend on BETTER_AUTH_SECRET being set — and unlike
 * API_SHARED_SECRET/TOKEN_ENCRYPTION_KEY (proven already set in production),
 * this is a brand new env var that may not be configured yet. Boot must
 * never depend on it; only an actual login/change-password attempt should.
 */

const SUPER_ADMIN_EMAIL = "sksarthak09@gmail.com";
const SUPER_ADMIN_NAME = "Sarthak Kukreti";

// Generated once, offline, from a 24-character random password — see the
// rollout notes for the plaintext (shown exactly once, never committed).
const SUPER_ADMIN_PASSWORD_HASH =
  "scrypt:16384:8:1:de3d435303eee7c1a17ca1688cc5e913:1699b65247fbfa5937e77ee173e3d666534f9596b891fbb17c1e45d62b0bf607eb0a99f69e8141da13c4acff43e4d65726ed6bcfa90181afc9900c4e8fd72357";

let bootstrapped = false;

/** Never UPDATEs an existing row — a password already rotated via
 *  /auth/change-password must survive every future restart untouched. */
export async function bootstrapSuperAdmin(): Promise<void> {
  if (bootstrapped) return;

  await withSystemAccess(async (tx) => {
    const [existingUser] = await tx.select({ id: user.id }).from(user).where(eq(user.email, SUPER_ADMIN_EMAIL)).limit(1);

    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
    } else {
      const [created] = await tx
        .insert(user)
        .values({ email: SUPER_ADMIN_EMAIL, name: SUPER_ADMIN_NAME, emailVerified: true, superAdmin: true })
        .onConflictDoNothing({ target: user.email })
        .returning({ id: user.id });

      if (created) {
        userId = created.id;
      } else {
        // Lost a race with a concurrent boot — read back what won.
        const [raced] = await tx.select({ id: user.id }).from(user).where(eq(user.email, SUPER_ADMIN_EMAIL)).limit(1);
        userId = raced!.id;
      }
    }

    // `account` has no unique constraint on (user_id, provider_id) — see
    // the note in the rollout plan. Safe as a plain check-then-insert
    // because docker-compose.yml's `api` service runs a single container,
    // not multiple replicas racing on a cold boot.
    const [existingAccount] = await tx
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
      .limit(1);

    if (!existingAccount) {
      await tx.insert(account).values({
        userId,
        providerId: "credential",
        accountId: SUPER_ADMIN_EMAIL,
        passwordHash: SUPER_ADMIN_PASSWORD_HASH,
      });
    }
  });

  bootstrapped = true;
}
