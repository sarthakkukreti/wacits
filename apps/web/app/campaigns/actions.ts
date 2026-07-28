"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "../../lib/api";

export type AudienceSpec = {
  allContacts?: boolean;
  groupIds?: string[];
  tagIds?: string[];
  excludeUndeliverable?: boolean;
  onlyUncontacted?: boolean;
};

export type PreviewResult =
  | { ok: true; resolvedCount: number; suppressedCount: number; sendableCount: number }
  | { ok: false; error: string };

export async function previewAudienceAction(spec: AudienceSpec): Promise<PreviewResult> {
  try {
    const data = await api<{ resolvedCount: number; suppressedCount: number; sendableCount: number }>(
      "/workspace/campaigns/audience/preview",
      { method: "POST", body: spec },
    );
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : String(err) };
  }
}

/**
 * Creates the campaign in `draft` and expands its outbox. Nothing is sent
 * until launch — the two are deliberately separate steps (§12).
 */
export async function createCampaignAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ ok: false; error: string } | undefined> {
  const name = String(formData.get("name") ?? "").trim();
  const templateVersionId = String(formData.get("templateVersionId") ?? "");
  const audienceMode = String(formData.get("audienceMode") ?? "all");
  const groupIds = formData.getAll("groupIds").map(String).filter(Boolean);
  const excludeUndeliverable = formData.get("excludeUndeliverable") === "on";

  if (!name) return { ok: false, error: "Give the campaign a name." };
  if (!templateVersionId) return { ok: false, error: "Choose an approved template." };

  const audience: AudienceSpec =
    audienceMode === "groups"
      ? { groupIds, excludeUndeliverable }
      : audienceMode === "uncontacted"
        ? { allContacts: true, onlyUncontacted: true, excludeUndeliverable }
        : { allContacts: true, excludeUndeliverable };

  if (audienceMode === "groups" && groupIds.length === 0) {
    return { ok: false, error: "Select at least one group, or choose “everyone”." };
  }

  // Template variables: {{1}} -> a contact field or literal.
  const parameterMapping: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("param_") && String(value).trim()) {
      parameterMapping[key.replace("param_", "")] = String(value).trim();
    }
  }

  let campaignId: string;
  try {
    const result = await api<{ campaign: { id: string } }>("/workspace/campaigns", {
      method: "POST",
      body: {
        name,
        templateVersionId,
        audience,
        parameterMapping: Object.keys(parameterMapping).length ? parameterMapping : undefined,
      },
    });
    campaignId = result.campaign.id;
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : String(err) };
  }

  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaignId}`);
}

export async function launchCampaignAction(id: string) {
  try {
    const data = await api<{ queued: number }>(`/workspace/campaigns/${id}/launch`, { method: "POST" });
    revalidatePath(`/campaigns/${id}`);
    revalidatePath("/campaigns");
    return { ok: true as const, queued: data.queued };
  } catch (err) {
    return { ok: false as const, error: err instanceof ApiError ? err.message : String(err) };
  }
}

export async function pauseCampaignAction(id: string) {
  try {
    await api(`/workspace/campaigns/${id}/pause`, { method: "POST", body: { reason: "Paused by operator" } });
    revalidatePath(`/campaigns/${id}`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof ApiError ? err.message : String(err) };
  }
}

export async function cancelCampaignAction(id: string) {
  try {
    await api(`/workspace/campaigns/${id}/cancel`, { method: "POST" });
    revalidatePath(`/campaigns/${id}`);
    revalidatePath("/campaigns");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof ApiError ? err.message : String(err) };
  }
}
