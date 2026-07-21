import IORedis from "ioredis";

/**
 * PRD §3.1/§3.2 — the two BullMQ configuration rules that are not optional:
 *
 *  1. Worker connections MUST set maxRetriesPerRequest: null, or BullMQ's
 *     blocking commands break.
 *  2. NEVER set an ioredis keyPrefix on a BullMQ connection — it collides
 *     with BullMQ's own key prefixing and corrupts queue state. Use
 *     BullMQ's own `prefix` queue option instead (see queues.ts).
 *
 * §3.3 spike S1 asks whether BullMQ runs reliably on Bun via the Bun-native
 * Redis client (createBunRedisClient). That spike has not been run yet, so
 * this scaffold deliberately uses the well-proven ioredis path — the
 * documented fallback if S1 fails — rather than gambling on the unverified
 * native adapter. Re-evaluate once S1 has a recorded result.
 *
 * Valkey is wire-compatible with this client; REDIS_URL may point at either
 * for local development (see docker-compose.yml for the pinned Valkey image
 * used in a real deployment).
 */
export function createRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set. Refusing to start (see .env.example / TS-8).");
  }
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    // Deliberately no `keyPrefix` here — see rule 2 above.
  });
}
