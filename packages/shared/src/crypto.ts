import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * PRD §19 — envelope encryption for the `access_token` table. Meta access
 * tokens are the credential that can send messages as a client's brand; a
 * database dump must not hand them over in plaintext.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails loudly on
 * decrypt rather than silently yielding garbage. The stored format is
 *
 *     v<keyVersion>:<iv-base64>:<authTag-base64>:<ciphertext-base64>
 *
 * The version prefix is what makes key rotation possible later without
 * having to guess how an old row was encrypted.
 */

const KEY_ENV = "TOKEN_ENCRYPTION_KEY";
const CURRENT_KEY_VERSION = 1;

function loadKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(`${KEY_ENV} is not set. Refusing to handle tokens (see .env.example / TS-8).`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must decode to exactly 32 bytes for AES-256. Generate with: openssl rand -base64 32`);
  }
  return key;
}

export function encryptToken(plaintext: string): { value: string; keyVersion: number } {
  const key = loadKey();
  const iv = randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    value: `v${CURRENT_KEY_VERSION}:${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`,
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptToken(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) {
    throw new Error("Stored token is not in the expected envelope format.");
  }
  const [, ivB64, tagB64, dataB64] = parts;

  const key = loadKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** Never render a token in full — not in a UI, not in a log line. */
export function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
