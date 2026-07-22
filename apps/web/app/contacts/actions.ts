"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "../../lib/api";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function toResult(err: unknown): ActionResult {
  if (err instanceof ApiError) return { ok: false, error: err.message };
  return { ok: false, error: String(err) };
}

export async function createContactAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const phoneNumber = String(formData.get("phoneNumber") ?? "").trim();
  if (!phoneNumber) return { ok: false, error: "A phone number is required." };

  const body: Record<string, string | undefined> = { phoneNumber };
  for (const key of ["firstName", "lastName", "email", "organization", "designation", "memberId", "city", "state", "notes"]) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) body[key] = value;
  }

  try {
    await api("/workspace/contacts", { method: "POST", body });
    revalidatePath("/contacts");
    return { ok: true, message: "Contact saved." };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateContactAction(id: string, _prev: unknown, formData: FormData): Promise<ActionResult> {
  const body: Record<string, string> = {};
  for (const key of ["firstName", "lastName", "email", "organization", "designation", "memberId", "city", "state", "notes"]) {
    body[key] = String(formData.get(key) ?? "").trim();
  }

  try {
    await api(`/workspace/contacts/${id}`, { method: "PATCH", body });
    revalidatePath(`/contacts/${id}`);
    revalidatePath("/contacts");
    return { ok: true, message: "Saved." };
  } catch (err) {
    return toResult(err);
  }
}

/** §10 — recording an opt-out also writes to the GLOBAL suppression list,
 *  because the duty not to contact is owed to the person, not one client. */
export async function optOutAction(id: string): Promise<ActionResult> {
  try {
    await api(`/workspace/contacts/${id}/opt-out`, {
      method: "POST",
      body: { reason: "Recorded by operator in dashboard" },
    });
    revalidatePath(`/contacts/${id}`);
    revalidatePath("/contacts");
    return { ok: true, message: "Contact opted out and added to the suppression list." };
  } catch (err) {
    return toResult(err);
  }
}

export async function optInAction(id: string): Promise<ActionResult> {
  try {
    await api(`/workspace/contacts/${id}/opt-in`, { method: "POST", body: {} });
    revalidatePath(`/contacts/${id}`);
    revalidatePath("/contacts");
    return { ok: true, message: "Opt-in recorded." };
  } catch (err) {
    return toResult(err);
  }
}

export async function archiveContactAction(id: string): Promise<ActionResult> {
  try {
    await api(`/workspace/contacts/${id}`, { method: "DELETE" });
    revalidatePath("/contacts");
    return { ok: true, message: "Contact archived." };
  } catch (err) {
    return toResult(err);
  }
}

// --- CSV import -------------------------------------------------------------

export type PreviewResult =
  | {
      ok: true;
      headers: string[];
      mapping: Record<string, string | null>;
      totalRows: number;
      validCount: number;
      invalidCount: number;
      duplicateInFileCount: number;
      willCreateCount: number;
      willUpdateCount: number;
      suppressedCount: number;
      parseErrors: string[];
      invalidSamples: { rowNumber: number; value: string; message: string }[];
      sampleRows: Record<string, any>[];
      csv: string;
    }
  | { ok: false; error: string };

export async function previewImportAction(_prev: unknown, formData: FormData): Promise<PreviewResult> {
  const file = formData.get("file") as File | null;
  const pastedCsv = String(formData.get("csv") ?? "");

  let csv = pastedCsv;
  if (file && file.size > 0) csv = await file.text();
  if (!csv.trim()) return { ok: false, error: "Choose a CSV file, or paste its contents." };

  // A mapping may be supplied when the operator corrects the guess and
  // re-previews.
  const mappingJson = String(formData.get("mapping") ?? "");
  const mapping = mappingJson ? JSON.parse(mappingJson) : undefined;

  try {
    const data = await api<Omit<Extract<PreviewResult, { ok: true }>, "ok" | "csv">>("/workspace/imports/preview", {
      method: "POST",
      body: { csv, mapping },
    });
    return { ok: true, ...data, csv };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message };
    return { ok: false, error: String(err) };
  }
}

export type CommitResult =
  | { ok: true; created: number; updated: number; errored: number; importJobId: string }
  | { ok: false; error: string };

export async function commitImportAction(_prev: unknown, formData: FormData): Promise<CommitResult> {
  const csv = String(formData.get("csv") ?? "");
  const mapping = JSON.parse(String(formData.get("mapping") ?? "{}"));
  const groupName = String(formData.get("groupName") ?? "").trim() || undefined;
  const fileName = String(formData.get("fileName") ?? "upload.csv");

  if (!csv.trim()) return { ok: false, error: "Nothing to import — the file content was lost. Please re-upload." };

  try {
    const data = await api<{ created: number; updated: number; errored: number; importJobId: string }>(
      "/workspace/imports/commit",
      { method: "POST", body: { csv, mapping, groupName, fileName } },
    );
    revalidatePath("/contacts");
    return { ok: true, ...data };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message };
    return { ok: false, error: String(err) };
  }
}
