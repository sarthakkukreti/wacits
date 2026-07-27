import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * PRD §19 / §21.2 — end-user login password hashing. Separate from
 * crypto.ts (which is envelope encryption for Meta access tokens, a
 * reversible operation) because this is one-way: nothing here ever
 * recovers a plaintext password, only checks whether a given one matches.
 *
 * scrypt (Node's built-in, no new dependency) at N=16384/r=8/p=1 — OWASP's
 * interactive-login tier. This guards a single low-QPS admin login, not a
 * high-throughput consumer auth system, so the real defenses are session
 * token entropy and the login rate limiter (see lib/login-rate-limit.ts),
 * not squeezing more cost into the KDF.
 *
 * BETTER_AUTH_SECRET (reserved in .env.example since before this feature,
 * for exactly this purpose) is mixed in as a pepper: a stored hash alone
 * (e.g. a DB dump) is insufficient to verify or brute-force a password
 * without also holding this env var. It is read LAZILY, inside these two
 * functions, never at module load — a missing/short value must only ever
 * fail an actual login/change-password request, never crash the server at
 * boot the way a missing API_SHARED_SECRET or TOKEN_ENCRYPTION_KEY does
 * (those are proven to already be set in production; this one, being new,
 * is not).
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_LENGTH = 64;
const MAX_MEM = 64 * 1024 * 1024; // 128*N*r bytes = 16MB, comfortably under this

function getPepper(): string {
  const pepper = process.env.BETTER_AUTH_SECRET;
  if (!pepper) throw new Error("BETTER_AUTH_SECRET is not set. Cannot hash or verify a password.");
  if (pepper.length < 32) throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.");
  return pepper;
}

function derive(password: string, salt: Buffer, keyLength: number, N: number, r: number, p: number): Buffer {
  return scryptSync(`${password}:${getPepper()}`, salt, keyLength, { N, r, p, maxmem: MAX_MEM });
}

/** Stored as `scrypt:<N>:<r>:<p>:<salt-hex>:<hash-hex>` — parameters travel
 *  with the hash (mirrors crypto.ts's `v<keyVersion>:` prefix) so the cost
 *  factor can be raised later without invalidating existing rows. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = derive(password, salt, KEY_LENGTH, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  try {
    const salt = Buffer.from(saltHex!, "hex");
    const expected = Buffer.from(hashHex!, "hex");
    if (salt.length === 0 || expected.length === 0) return false;
    const derived = derive(password, salt, expected.length, N, r, p);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    // Malformed input or absurd N/r/p must fail closed, never throw out of
    // a login request.
    return false;
  }
}
