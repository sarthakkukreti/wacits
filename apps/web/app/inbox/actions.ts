"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "../../lib/api";

/**
 * Server actions for the inbox. These run on the Next.js server, so the API
 * shared secret stays server-side (see lib/api.ts) and the browser only ever
 * talks to this app's own origin.
 *
 * Every action returns a plain result object rather than throwing, because
 * the interesting failures here are ones the agent must SEE and act on: a
 * closed 24-hour window, a suppressed number, a Meta rejection. A thrown
 * error would just render an error page and lose that detail.
 */

export type SendResult = { ok: true } | { ok: false; error: string; reason?: string };

export async function sendMessageAction(
  conversationId: string,
  formData: FormData,
): Promise<SendResult> {
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return { ok: false, error: "Type a message first." };

  try {
    await api(`/workspace/inbox/conversations/${conversationId}/messages`, {
      method: "POST",
      body: { text },
    });
    revalidatePath(`/inbox/${conversationId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, error: err.message, reason: err.payload?.reason };
    }
    return { ok: false, error: String(err) };
  }
}

export async function sendTemplateAction(
  conversationId: string,
  templateName: string,
  languageCode: string,
): Promise<SendResult> {
  try {
    await api(`/workspace/inbox/conversations/${conversationId}/messages`, {
      method: "POST",
      body: { template: { name: templateName, languageCode } },
    });
    revalidatePath(`/inbox/${conversationId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message, reason: err.payload?.reason };
    return { ok: false, error: String(err) };
  }
}

export async function setConversationStateAction(conversationId: string, state: "open" | "closed") {
  try {
    await api(`/workspace/inbox/conversations/${conversationId}/state`, { method: "POST", body: { state } });
    revalidatePath("/inbox");
    revalidatePath(`/inbox/${conversationId}`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof ApiError ? err.message : String(err) };
  }
}

export async function addNoteAction(conversationId: string, formData: FormData) {
  const body = String(formData.get("note") ?? "").trim();
  if (!body) return { ok: false as const, error: "Note cannot be empty." };

  try {
    await api(`/workspace/inbox/conversations/${conversationId}/notes`, { method: "POST", body: { body } });
    revalidatePath(`/inbox/${conversationId}`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof ApiError ? err.message : String(err) };
  }
}

/**
 * Starts a chat from a raw phone number. On success it redirects into the
 * thread, which is what an agent expects after pressing "Start chat".
 */
export async function startChatAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ ok: false; error: string; reason?: string } | undefined> {
  const phoneNumber = String(formData.get("phoneNumber") ?? "").trim();
  const firstName = String(formData.get("firstName") ?? "").trim() || undefined;
  const lastName = String(formData.get("lastName") ?? "").trim() || undefined;
  const text = String(formData.get("text") ?? "").trim() || undefined;
  const templateName = String(formData.get("templateName") ?? "").trim();
  const templateLanguage = String(formData.get("templateLanguage") ?? "").trim();

  if (!phoneNumber) return { ok: false, error: "Enter a phone number with country code." };

  let conversationId: string;
  try {
    const result = await api<{ conversationId: string }>("/workspace/inbox/start", {
      method: "POST",
      body: {
        phoneNumber,
        firstName,
        lastName,
        text: templateName ? undefined : text,
        template: templateName ? { name: templateName, languageCode: templateLanguage || "en" } : undefined,
      },
    });
    conversationId = result.conversationId;
  } catch (err) {
    if (err instanceof ApiError) {
      // A blocked send still opens the conversation, so send the agent
      // there with the reason rather than stranding them on the form.
      if (err.payload?.conversationId) {
        redirect(`/inbox/${err.payload.conversationId}?blocked=${encodeURIComponent(err.message)}`);
      }
      return { ok: false, error: err.message, reason: err.payload?.reason };
    }
    return { ok: false, error: String(err) };
  }

  revalidatePath("/inbox");
  redirect(`/inbox/${conversationId}`);
}
