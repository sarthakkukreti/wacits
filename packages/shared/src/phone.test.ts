import { describe, expect, test } from "bun:test";
import { normalisePhone } from "./phone";

/**
 * CT-8: an Indian landline must be rejected, not silently accepted, because
 * it cannot receive WhatsApp messages. The default libphonenumber-js build
 * ships "min" metadata, which returns `undefined` from `getType()` for every
 * Indian number — this suite is what would have caught that regression.
 */
describe("normalisePhone", () => {
  test("accepts Indian mobile numbers across the valid prefix ranges", () => {
    for (const raw of ["+919876543210", "09876543210", "919876543210", "+91 98765 43210"]) {
      const r = normalisePhone(raw);
      expect(r.ok).toBe(true);
    }
  });

  test("rejects Indian landlines instead of silently accepting them", () => {
    const landlines = [
      "+911123456789", // Delhi
      "+912228202020", // Mumbai
      "+914422345678", // Chennai
      "+911204567890", // Noida (STD)
    ];
    for (const raw of landlines) {
      const r = normalisePhone(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("landline");
    }
  });

  test("rejects Indian toll-free numbers as not mobile-capable", () => {
    const r = normalisePhone("+911800123456");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("landline");
  });

  test("does not apply the mobile-only rule outside India", () => {
    const r = normalisePhone("+14155552671");
    expect(r.ok).toBe(true);
  });

  test("accepts an Indian landline when the caller opts out via requireMobile: false", () => {
    // routes/settings.ts registering the WABA's own sender number, verified
    // by voice call rather than SMS — not a contact, so CT-8 does not apply.
    const r = normalisePhone("+911123456789", "IN", false);
    expect(r.ok).toBe(true);
  });

  test("still rejects syntactically invalid and empty input", () => {
    expect(normalisePhone("").ok).toBe(false);
    expect(normalisePhone("abc").ok).toBe(false);
    expect(normalisePhone("12").ok).toBe(false);
  });
});
