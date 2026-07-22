"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "../../lib/api";

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
