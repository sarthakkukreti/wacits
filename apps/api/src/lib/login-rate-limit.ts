import { createHash } from "node:crypto";
import IORedis from "ioredis";

/**
 * Brute-force throttle on POST /auth/login. Deliberately a SEPARATE ioredis
 * connection from @wacits/queue's createRedisConnection() (packages/queue/
 * src/connection.ts) rather than reusing it: that one sets
 * maxRetriesPerRequest: null specifically so BullMQ's blocking commands
 * never give up — exactly wrong here, where a down Redis must fail an
 * individual check FAST so a login request can fall through to "allowed"
 * rather than hang waiting on retries. This connection fails fast instead:
 * a short connect timeout, a small retry count, and no offline queueing.
 *
 * Fails OPEN on any Redis error: the two failure modes are (a) briefly
 * disabling rate limiting during a Redis blip, or (b) locking out the
 * workspace's only admin account with no other way in. Given the real
 * defense here is a long random password, not this counter, (a) is the
 * far smaller risk.
 */

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 10;

let client: IORedis | null = null;

function getClient(): IORedis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!client) {
    client = new IORedis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    client.on("error", () => {
      // Swallowed deliberately: every call site already wraps use of this
      // client in try/catch and fails open. An unhandled 'error' event on
      // an ioredis client otherwise crashes the process.
    });
  }
  return client;
}

function keyFor(kind: "email" | "ip", value: string): string {
  const hashed = createHash("sha256").update(value).digest("hex");
  return `login:attempts:${kind}:${hashed}`;
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Checks WITHOUT incrementing — call this before verifying the password,
 *  and recordLoginFailure() only if it actually fails. */
export async function checkLoginRateLimit(email: string, ipAddress: string | null): Promise<RateLimitResult> {
  const redis = getClient();
  if (!redis) return { allowed: true };

  try {
    const keys = [keyFor("email", email), ...(ipAddress ? [keyFor("ip", ipAddress)] : [])];
    const counts = await Promise.all(keys.map((k) => redis.get(k)));
    const tripped = counts.some((c) => c !== null && Number(c) >= MAX_ATTEMPTS);
    if (!tripped) return { allowed: true };

    const ttls = await Promise.all(keys.map((k) => redis.ttl(k)));
    const retryAfterSeconds = Math.max(1, ...ttls.filter((t) => t > 0));
    return { allowed: false, retryAfterSeconds };
  } catch {
    return { allowed: true };
  }
}

export async function recordLoginFailure(email: string, ipAddress: string | null): Promise<void> {
  const redis = getClient();
  if (!redis) return;

  try {
    const keys = [keyFor("email", email), ...(ipAddress ? [keyFor("ip", ipAddress)] : [])];
    await Promise.all(
      keys.map(async (k) => {
        const n = await redis.incr(k);
        if (n === 1) await redis.expire(k, WINDOW_SECONDS);
      }),
    );
  } catch {
    // Fail open — see module comment.
  }
}

export async function resetLoginRateLimit(email: string, ipAddress: string | null): Promise<void> {
  const redis = getClient();
  if (!redis) return;

  try {
    const keys = [keyFor("email", email), ...(ipAddress ? [keyFor("ip", ipAddress)] : [])];
    await redis.del(...keys);
  } catch {
    // Fail open — see module comment.
  }
}
