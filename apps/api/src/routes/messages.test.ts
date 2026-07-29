import { describe, expect, test } from "bun:test";
import { buildClassificationLookup, resendVerdict, selectResendableIds } from "./messages";

/**
 * These two functions encode PRD rules rather than mechanics, which is
 * exactly what silently regresses: a wrong verdict here either refuses a
 * legitimate retry or bills the client for a resend that cannot succeed.
 */

describe("resendVerdict — every completed status is resendable", () => {
  test("a failure of any error class can be resent", () => {
    for (const cls of ["CONDITIONAL", "OPERATIONAL_ALERT", "RETRY_BACKOFF", "TERMINAL", "PROBABLE_INVALID_CONTACT", null]) {
      expect(resendVerdict("failed", cls, false).mode).toBe("new_attempt");
    }
  });

  test("already-delivered outcomes can be resent, but warn that it sends and bills again", () => {
    for (const state of ["sent", "delivered", "read"]) {
      const v = resendVerdict(state, null, false);
      expect(v.mode).toBe("new_attempt");
      if (v.mode !== "blocked") expect(v.warning).toContain("second time");
    }
  });

  test("a skipped row can be resent, but warns that suppression is re-checked at send time", () => {
    const v = resendVerdict("skipped", null, false);
    expect(v.mode).toBe("new_attempt");
    if (v.mode !== "blocked") expect(v.warning).toContain("suppression");
  });

  test("risky classes still carry a warning even though they are allowed", () => {
    for (const cls of ["TERMINAL", "PROBABLE_INVALID_CONTACT", "CONDITIONAL", "OPERATIONAL_ALERT"]) {
      const v = resendVerdict("failed", cls, false);
      if (v.mode !== "blocked") expect(v.warning).toBeTruthy();
    }
  });

  test("a transient failure is the one case with no warning — it is the most likely to now succeed", () => {
    const v = resendVerdict("failed", "RETRY_BACKOFF", false);
    if (v.mode !== "blocked") expect(v.warning).toBeNull();
  });

  test("a send that has not gone out yet is re-queued, never duplicated", () => {
    for (const state of ["pending", "queued"]) {
      expect(resendVerdict(state, null, false).mode).toBe("requeue");
    }
  });

  test("a send awaiting its delivery receipt is refused — resending would duplicate it (AR-16)", () => {
    const v = resendVerdict("accepted", null, false);
    expect(v.mode).toBe("blocked");
  });

  test("an in-flight later attempt blocks every status — the one guard that always wins", () => {
    for (const state of ["failed", "delivered", "read", "skipped", "pending", "sent"]) {
      expect(resendVerdict(state, "RETRY_BACKOFF", true).mode).toBe("blocked");
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

  test("an unknown code is reported as terminal and carries a warning", () => {
    const classify = buildClassificationLookup(rows);
    const result = classify("/messages", "999999")!;
    expect(result.errorClass).toBe("TERMINAL");
    const v = resendVerdict("failed", result.errorClass, false);
    if (v.mode !== "blocked") expect(v.warning).toBeTruthy();
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

  test("includes every completed outcome, terminal failures and delivered alike", () => {
    const ids = selectResendableIds(
      [
        { ...base, id: "a", contactId: "c1", attemptKey: 1, state: "failed", errorCode: "131047" },
        { ...base, id: "b", contactId: "c2", attemptKey: 1, state: "failed", errorCode: "131050" },
        { ...base, id: "c", contactId: "c3", attemptKey: 1, state: "delivered", errorCode: null },
      ],
      classify,
    );
    expect(ids).toEqual(["a", "b", "c"]);
  });

  test("excludes a row awaiting its delivery receipt", () => {
    const ids = selectResendableIds(
      [{ ...base, id: "a", contactId: "c1", attemptKey: 1, state: "accepted", errorCode: null }],
      classify,
    );
    expect(ids).toEqual([]);
  });

  test("a failure shadowed by an in-flight retry is excluded, while the in-flight row itself can still be re-queued", () => {
    const ids = selectResendableIds(
      [
        { ...base, id: "a", attemptKey: 1, state: "failed", errorCode: "131047" },
        { ...base, id: "a2", attemptKey: 2, state: "pending", errorCode: null },
      ],
      classify,
    );
    // `a` must not mint a third attempt behind the live one; `a2` has not
    // gone out yet, so re-queueing it is safe and nudges a stuck send.
    expect(ids).toEqual(["a2"]);
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
