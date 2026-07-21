import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * AR-6: verify X-Hub-Signature-256 as an HMAC-SHA256 of the EXACT raw
 * request bytes, keyed with the Meta app secret, using a constant-time
 * comparison. Never re-serialise parsed JSON before hashing — key order and
 * whitespace differences will silently break verification, which is why
 * this function takes the raw body string, not a parsed object.
 */
export function verifySignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = header.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
