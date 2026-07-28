import { describe, expect, test } from "bun:test";
import { mapRows, splitPhoneNumbers } from "./imports";

describe("splitPhoneNumbers", () => {
  test("splits on comma and colon, trimming each piece", () => {
    expect(splitPhoneNumbers("+91 98765 43210, +91 87654 32109")).toEqual(["+91 98765 43210", "+91 87654 32109"]);
    expect(splitPhoneNumbers("+91 98765 43210:+91 87654 32109")).toEqual(["+91 98765 43210", "+91 87654 32109"]);
  });

  test("does not split a single formatted number on its internal spaces", () => {
    expect(splitPhoneNumbers("+91 98765 43210")).toEqual(["+91 98765 43210"]);
  });

  test("drops empty pieces from a trailing separator", () => {
    expect(splitPhoneNumbers("+919876543210,")).toEqual(["+919876543210"]);
    expect(splitPhoneNumbers("")).toEqual([]);
  });

  test("handles three or more numbers in one cell", () => {
    expect(splitPhoneNumbers("+919876543210, +918765432109:+917654321098")).toEqual([
      "+919876543210",
      "+918765432109",
      "+917654321098",
    ]);
  });
});

describe("mapRows — multi-number cells", () => {
  const mapping = { phoneNumber: "Mobile", fullName: "Name" };

  test("a row with two numbers produces two entries sharing the same name", () => {
    const rows = [{ Name: "Priya Sharma", Mobile: "+91 90000 11111, +91 90000 22222" }];
    const entries = mapRows(rows, mapping);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.phone.ok && entries[0]!.phone.e164).toBe("+919000011111");
    expect(entries[1]!.phone.ok && entries[1]!.phone.e164).toBe("+919000022222");
    expect(entries[0]!.values.firstName).toBe("Priya");
    expect(entries[1]!.values.firstName).toBe("Priya");
    expect(entries[0]!.rowNumber).toBe(entries[1]!.rowNumber);
    expect(entries[0]!.phoneCount).toBe(2);
    expect(entries[0]!.phoneIndex).toBe(1);
    expect(entries[1]!.phoneIndex).toBe(2);
  });

  test("an ordinary single-number row is unaffected", () => {
    const rows = [{ Name: "Rahul Verma", Mobile: "+91 99887 76655" }];
    const entries = mapRows(rows, mapping);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.phoneCount).toBe(1);
    expect(entries[0]!.phoneIndex).toBe(1);
  });

  test("one bad number among several in a cell fails only that entry", () => {
    const rows = [{ Name: "Bad Mix", Mobile: "+91 90000 33333, +91 11 2345 6789" }]; // second is a Delhi landline
    const entries = mapRows(rows, mapping);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.phone.ok).toBe(true);
    expect(entries[1]!.phone.ok).toBe(false);
  });

  test("multiple rows each with multiple numbers all flatten correctly", () => {
    const rows = [
      { Name: "A", Mobile: "+91 90000 11111, +91 90000 22222" },
      { Name: "B", Mobile: "+91 90000 33333" },
      { Name: "C", Mobile: "+91 90000 44444:+91 90000 55555" },
    ];
    const entries = mapRows(rows, mapping);
    expect(entries).toHaveLength(5);
    expect(entries.map((e) => e.values.firstName)).toEqual(["A", "A", "B", "C", "C"]);
  });
});
