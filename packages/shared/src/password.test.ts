import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  test("a hashed password verifies against the same plaintext", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  test("a wrong password does not verify", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong password", hash)).toBe(false);
  });

  test("two hashes of the same password differ (random salt)", () => {
    const a = hashPassword("same password");
    const b = hashPassword("same password");
    expect(a).not.toBe(b);
    expect(verifyPassword("same password", a)).toBe(true);
    expect(verifyPassword("same password", b)).toBe(true);
  });

  test("malformed stored hashes fail closed instead of throwing", () => {
    expect(verifyPassword("anything", "not-a-real-hash")).toBe(false);
    expect(verifyPassword("anything", "scrypt:bad:bad:bad:zz:zz")).toBe(false);
    expect(verifyPassword("anything", "")).toBe(false);
  });

  test("the stored format carries scrypt parameters", () => {
    const hash = hashPassword("x");
    expect(hash.startsWith("scrypt:16384:8:1:")).toBe(true);
    expect(hash.split(":")).toHaveLength(6);
  });
});
