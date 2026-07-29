"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { api, ApiError } from "../../lib/api";
import { SESSION_COOKIE } from "../../lib/session-cookie";

/**
 * Records a WhatsApp sender number against this workspace. The ids come out
 * of Meta's own dashboard — this does not create anything at Meta, it
 * records what already exists there (§7 / Appendix B).
 */
export async function addSenderNumberAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const body = {
    metaPhoneNumberId: String(formData.get("metaPhoneNumberId") ?? "").trim(),
    displayPhoneNumber: String(formData.get("displayPhoneNumber") ?? "").trim(),
    displayName: String(formData.get("displayName") ?? "").trim(),
    metaWabaId: String(formData.get("metaWabaId") ?? "").trim(),
    token: String(formData.get("token") ?? "").trim() || undefined,
  };

  for (const [key, label] of [
    ["metaPhoneNumberId", "Phone number ID"],
    ["displayPhoneNumber", "Display phone number"],
    ["displayName", "Display name"],
    ["metaWabaId", "WhatsApp Business Account ID"],
  ] as const) {
    if (!body[key]) return { ok: false, error: `${label} is required.` };
  }

  try {
    await api("/workspace/settings/sender-numbers", { method: "POST", body });
    revalidatePath("/settings");
    revalidatePath("/");
    return { ok: true, message: "Sender number connected. You can now sync templates and send messages." };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : String(err) };
  }
}

/** Necessary because a super-admin's first password is a generated one
 *  handed over out-of-band — it needs to be rotatable without anyone
 *  touching the database again. */
export async function changePasswordAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword) return { ok: false, error: "Both the current and new password are required." };
  if (newPassword.length < 12) return { ok: false, error: "The new password must be at least 12 characters." };
  if (newPassword !== confirmPassword) return { ok: false, error: "The new password and confirmation don't match." };

  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionToken) return { ok: false, error: "Your session has expired. Sign in again." };

  try {
    await api("/auth/change-password", {
      method: "POST",
      tenant: false,
      sessionToken,
      body: { currentPassword, newPassword },
    });
    return { ok: true, message: "Password changed." };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : String(err) };
  }
}
