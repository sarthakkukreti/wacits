"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "../../lib/api";

export type ResendOutcome = {
  campaignRecipientId: string;
  queued: boolean;
  reason?: string;
  attemptKey?: number;
};

export type ResendResult =
  | { ok: true; queued: number; refused: number; outcomes: ResendOutcome[] }
  | { ok: false; error: string };

/**
 * Operator-initiated retry. Sends real, billable WhatsApp messages, so the
 * caller is expected to have confirmed the count first — see the dialog in
 * MessageLogTable.tsx.
 *
 * The API decides eligibility, not the UI: the button is hidden for rows
 * the log already marked ineligible, but the same rule is re-checked
 * server-side, so a stale page cannot resend something it should not.
 */
export async function resendMessagesAction(campaignRecipientIds: string[]): Promise<ResendResult> {
  if (!campaignRecipientIds.length) return { ok: false, error: "Select at least one failed message to resend." };

  try {
    const data = await api<{ queued: number; refused: number; outcomes: ResendOutcome[] }>(
      "/workspace/messages/resend",
      { method: "POST", body: { campaignRecipientIds } },
    );
    revalidatePath("/messages");
    return { ok: true, ...data };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message };
    return { ok: false, error: String(err) };
  }
}

/** "Resend every eligible failure in this campaign." Eligibility is
 *  resolved server-side against the same rule, so the count confirmed on
 *  screen is the count actually sent. */
export async function resendAllEligibleAction(campaignId: string): Promise<ResendResult> {
  try {
    const data = await api<{ queued: number; refused: number; outcomes: ResendOutcome[] }>(
      "/workspace/messages/resend",
      { method: "POST", body: { campaignId, allEligible: true } },
    );
    revalidatePath("/messages");
    return { ok: true, ...data };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message };
    return { ok: false, error: String(err) };
  }
}
