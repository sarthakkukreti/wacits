import { describe, expect, test } from "bun:test";
import { buildClassificationLookup, isResendEligible, selectResendableIds } from "./messages";

/**
 * These two functions encode PRD rules rather than mechanics, which is
 * exactly what silently regresses: a wrong verdict here either refuses a
 * legitimate retry or bills the client for a resend that cannot succeed.
 */

describe("isResendEligible — §13 error-class catalogue", () => {
  test("CONDITIONAL is retryable once the operator clears the condition", () => {
    expect(isResendEligible("failed", "CONDITIONAL").eligible).toBe(true);
  });

  test("OPERATIONAL_ALERT is retryable once the underlying cause is cleared", () => {
    expect(isResendEligible("failed", "OPERATIONAL_ALERT").eligible).toBe(true);
  });

  test("RETRY_BACKOFF is retryable — it only reaches failed once automatic retries are exhausted", () => {
    expect(isResendEligible("failed", "RETRY_BACKOFF").eligible).toBe(true);
  });

  test("TERMINAL is never retryable — it would fail identically", () => {
    const verdict = isResendEligible("failed", "TERMINAL");
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBeTruthy();
  });

  test("PROBABLE_INVALID_CONTACT is not offered while a strike is open (DM-22)", () => {
    const verdict = isResendEligible("failed", "PROBABLE_INVALID_CONTACT");
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toContain("strike");
  });

  test("an unclassified code is treated as terminal rather than retryable", () => {
    expect(isResendEligible("failed", null).eligible).toBe(false);
    expect(isResendEligible("failed", "SOMETHING_NEW").eligible).toBe(false);
  });

  test("a skipped recipient is never retryable — suppression is a duty", () => {
    const verdict = isResendEligible("skipped", "CONDITIONAL");
    expect(verdict.eligible).toBe(false);
  });

  test("only a failed row can be resent, never one already on its way", () => {
    for (const state of ["pending", "queued", "accepted", "sent", "delivered", "read"]) {
      expect(isResendEligible(state, "CONDITIONAL").eligible).toBe(false);
    }
  });
});

describe("buildClassificationLookup — DM-27 (api_surface, code) precedence", () => {
  const rows = [
    { apiSurface: "/messages", code: "131047", errorClass: "CONDITIONAL", title: "Window expired", userFacingExplanation: "Wait." },
    { apiSurface: "/block_users", code: "131047", errorClass: "TERMINAL", title: "Cannot block", userFacingExplanation: null },
    { apiSurface: "*", code: "190", errorClass: "OPERATIONAL_ALERT", title: "Token expired", userFacingExplanation: "Re-auth." },
  ];

  test("the same code resolves differently per surface — the whole point of DM-27", () => {
    const classify = buildClassificationLookup(rows);
    expect(classify("/messages", "131047")!.errorClass).toBe("CONDITIONAL");
    expect(classify("/block_users", "131047")!.errorClass).toBe("TERMINAL");
  });

  test("an exact surface match beats the wildcard row", () => {
    const classify = buildClassificationLookup([
      ...rows,
      { apiSurface: "*", code: "131047", errorClass: "RETRY_BACKOFF", title: "Generic", userFacingExplanation: null },
    ]);
    expect(classify("/messages", "131047")!.errorClass).toBe("CONDITIONAL");
  });

  test("falls back to the wildcard when no exact surface row exists", () => {
    const classify = buildClassificationLookup(rows);
    expect(classify("/messages", "190")!.errorClass).toBe("OPERATIONAL_ALERT");
  });

  test("an unknown code is reported as terminal, never as retryable", () => {
    const classify = buildClassificationLookup(rows);
    const result = classify("/messages", "999999")!;
    expect(result.errorClass).toBe("TERMINAL");
    expect(isResendEligible("failed", result.errorClass).eligible).toBe(false);
  });

  test("no code means no failure to explain", () => {
    expect(buildClassificationLookup(rows)("/messages", null)).toBeNull();
  });
});

describe("selectResendableIds — what a bulk resend would actually send", () => {
  const classify = buildClassificationLookup([
    { apiSurface: "/messages", code: "131047", errorClass: "CONDITIONAL", title: "Window expired", userFacingExplanation: null },
    { apiSurface: "/messages", code: "131050", errorClass: "TERMINAL", title: "Opted out", userFacingExplanation: null },
  ]);

  const base = { contactId: "c1", templateVersionId: "t1" };

  test("picks eligible failures and skips terminal ones", () => {
    const ids = selectResendableIds(
      [
        { ...base, id: "a", contactId: "c1", attemptKey: 1, state: "failed", errorCode: "131047" },
        { ...base, id: "b", contactId: "c2", attemptKey: 1, state: "failed", errorCode: "131050" },
      ],
      classify,
    );
    expect(ids).toEqual(["a"]);
  });

  test("excludes a failure whose retry is already in flight — the count must not promise a send that will be refused", () => {
    const ids = selectResendableIds(
      [
        { ...base, id: "a", attemptKey: 1, state: "failed", errorCode: "131047" },
        { ...base, id: "a2", attemptKey: 2, state: "pending", errorCode: null },
      ],
      classify,
    );
    expect(ids).toEqual([]);
  });

  test("a failed retry is itself resendable again once it has also failed", () => {
    const ids = selectResendableIds(
      [
        { ...base, id: "a", attemptKey: 1, state: "failed", errorCode: "131047" },
        { ...base, id: "a2", attemptKey: 2, state: "failed", errorCode: "131047" },
      ],
      classify,
    );
    // Attempt 1 is shadowed by the later attempt only while that attempt is
    // live; both having failed, the newest is the one to retry.
    expect(ids).toContain("a2");
  });

  test("an in-flight attempt for a different contact does not shadow this one", () => {
    const ids = selectResendableIds(
      [
        { ...base, id: "a", contactId: "c1", attemptKey: 1, state: "failed", errorCode: "131047" },
        { ...base, id: "b2", contactId: "c2", attemptKey: 2, state: "pending", errorCode: null },
      ],
      classify,
    );
    expect(ids).toContain("a");
  });
});
