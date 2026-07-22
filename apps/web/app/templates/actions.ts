"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "../../lib/api";

/** Pulls the current template list and approval status from Meta (§11). */
export async function syncTemplatesAction() {
  try {
    const data = await api<{ created: number; updated: number; total: number }>("/workspace/templates/sync", {
      method: "POST",
    });
    revalidatePath("/templates");
    revalidatePath("/campaigns/new");
    return { ok: true as const, ...data };
  } catch (err) {
    return { ok: false as const, error: err instanceof ApiError ? err.message : String(err) };
  }
}
