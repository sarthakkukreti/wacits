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

// --- Labels: groups and tags ------------------------------------------------

/** Mirrors the API's ContactFilter. A bulk action carries either the ticked
 *  IDs or the filter the operator was looking at — never both — so "select
 *  all 4,312 matching" does not have to round-trip 4,312 ids. */
export type ContactFilter = {
  q?: string;
  deliverability?: string;
  tagId?: string;
  groupId?: string;
};

export type BulkTarget = { contactIds: string[] } | { filter: ContactFilter };

function revalidateContacts() {
  revalidatePath("/contacts");
  revalidatePath("/contacts/labels");
}

/** Adds a selection to an existing group. Idempotent — re-adding someone who
 *  is already a member is a no-op, not an error. */
export async function addToGroupAction(groupId: string, target: BulkTarget): Promise<ActionResult> {
  try {
    const data = await api<{ added: number; memberCount: number }>(
      `/workspace/contacts/meta/groups/${groupId}/members`,
      { method: "POST", body: target },
    );
    revalidateContacts();
    return { ok: true, message: `${data.added.toLocaleString()} contact(s) added — the group now has ${data.memberCount.toLocaleString()}.` };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeFromGroupAction(groupId: string, target: BulkTarget): Promise<ActionResult> {
  try {
    const data = await api<{ removed: number; memberCount: number }>(
      `/workspace/contacts/meta/groups/${groupId}/members/remove`,
      { method: "POST", body: target },
    );
    revalidateContacts();
    return { ok: true, message: `${data.removed.toLocaleString()} contact(s) removed from the group.` };
  } catch (err) {
    return toResult(err);
  }
}

/** Creates a group and optionally seeds it with the current selection. */
export async function createGroupAction(
  name: string,
  target?: BulkTarget,
  description?: string,
): Promise<ActionResult> {
  if (!name.trim()) return { ok: false, error: "Give the group a name." };
  try {
    const data = await api<{ group: { id: string; name: string }; added: number }>("/workspace/contacts/meta/groups", {
      method: "POST",
      body: { name: name.trim(), description, ...(target ?? {}) },
    });
    revalidateContacts();
    return {
      ok: true,
      message: target
        ? `Group “${data.group.name}” created with ${data.added.toLocaleString()} contact(s).`
        : `Group “${data.group.name}” created.`,
    };
  } catch (err) {
    return toResult(err);
  }
}

export async function applyTagAction(tagId: string, target: BulkTarget): Promise<ActionResult> {
  try {
    const data = await api<{ tagged: number }>(`/workspace/contacts/meta/tags/${tagId}/contacts`, {
      method: "POST",
      body: target,
    });
    revalidateContacts();
    return { ok: true, message: `Label applied to ${data.tagged.toLocaleString()} contact(s).` };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeTagAction(tagId: string, target: BulkTarget): Promise<ActionResult> {
  try {
    const data = await api<{ removed: number }>(`/workspace/contacts/meta/tags/${tagId}/contacts/remove`, {
      method: "POST",
      body: target,
    });
    revalidateContacts();
    return { ok: true, message: `Label removed from ${data.removed.toLocaleString()} contact(s).` };
  } catch (err) {
    return toResult(err);
  }
}

/** Creates a label, or re-uses one of the same name, and applies it. */
export async function createTagAction(name: string, target?: BulkTarget, color?: string): Promise<ActionResult> {
  if (!name.trim()) return { ok: false, error: "Give the label a name." };
  try {
    const data = await api<{ tag: { id: string; name: string }; tagged: number }>("/workspace/contacts/meta/tags", {
      method: "POST",
      body: { name: name.trim(), color, ...(target ?? {}) },
    });
    revalidateContacts();
    return {
      ok: true,
      message: target
        ? `Label “${data.tag.name}” applied to ${data.tagged.toLocaleString()} contact(s).`
        : `Label “${data.tag.name}” created.`,
    };
  } catch (err) {
    return toResult(err);
  }
}

export async function renameGroupAction(groupId: string, _prev: unknown, formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) return { ok: false, error: "Give the group a name." };
  try {
    await api(`/workspace/contacts/meta/groups/${groupId}`, { method: "PATCH", body: { name, description } });
    revalidateContacts();
    return { ok: true, message: "Group updated." };
  } catch (err) {
    return toResult(err);
  }
}

export async function renameTagAction(tagId: string, _prev: unknown, formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();
  if (!name) return { ok: false, error: "Give the label a name." };
  try {
    await api(`/workspace/contacts/meta/tags/${tagId}`, { method: "PATCH", body: { name, color } });
    revalidateContacts();
    return { ok: true, message: "Label updated." };
  } catch (err) {
    return toResult(err);
  }
}

/** Deleting a group or a label removes the labelling, never the contacts. */
export async function deleteGroupAction(groupId: string): Promise<ActionResult> {
  try {
    await api(`/workspace/contacts/meta/groups/${groupId}`, { method: "DELETE" });
    revalidateContacts();
    return { ok: true, message: "Group deleted. The contacts themselves are untouched." };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteTagAction(tagId: string): Promise<ActionResult> {
  try {
    await api(`/workspace/contacts/meta/tags/${tagId}`, { method: "DELETE" });
    revalidateContacts();
    return { ok: true, message: "Label deleted. The contacts themselves are untouched." };
  } catch (err) {
    return toResult(err);
  }
}

// --- Single-contact label edits ---------------------------------------------

export async function tagContactAction(contactId: string, tagId: string): Promise<ActionResult> {
  try {
    await api(`/workspace/contacts/${contactId}/tags`, { method: "POST", body: { tagId } });
    revalidatePath(`/contacts/${contactId}`);
    revalidateContacts();
    return { ok: true, message: "Label applied." };
  } catch (err) {
    return toResult(err);
  }
}

export async function untagContactAction(contactId: string, tagId: string): Promise<ActionResult> {
  try {
    await api(`/workspace/contacts/${contactId}/tags/${tagId}`, { method: "DELETE" });
    revalidatePath(`/contacts/${contactId}`);
    revalidateContacts();
    return { ok: true, message: "Label removed." };
  } catch (err) {
    return toResult(err);
  }
}

export async function addContactToGroupAction(contactId: string, groupId: string): Promise<ActionResult> {
  try {
    await api(`/workspace/contacts/${contactId}/groups`, { method: "POST", body: { groupId } });
    revalidatePath(`/contacts/${contactId}`);
    revalidateContacts();
    return { ok: true, message: "Added to group." };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeContactFromGroupAction(contactId: string, groupId: string): Promise<ActionResult> {
  try {
    await api(`/workspace/contacts/${contactId}/groups/${groupId}`, { method: "DELETE" });
    revalidatePath(`/contacts/${contactId}`);
    revalidateContacts();
    return { ok: true, message: "Removed from group." };
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
      labelPreview: { name: string; contactCount: number; isNew: boolean; tooLong: boolean }[];
      labelDistinctCount: number;
      labelNewCount: number;
      labelOverLimit: boolean;
      labelTooLongCount: number;
      labelMaxDistinct: number;
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
  | {
      ok: true;
      created: number;
      updated: number;
      errored: number;
      importJobId: string;
      labelsCreated: number;
      labelsApplied: number;
    }
  | { ok: false; error: string };

export async function commitImportAction(_prev: unknown, formData: FormData): Promise<CommitResult> {
  const csv = String(formData.get("csv") ?? "");
  const mapping = JSON.parse(String(formData.get("mapping") ?? "{}"));
  const groupName = String(formData.get("groupName") ?? "").trim() || undefined;
  const fileName = String(formData.get("fileName") ?? "upload.csv");

  // Labels typed on the import screen apply to every row, on top of whatever
  // a mapped label column produces per row.
  const labelNames = String(formData.get("labelNames") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!csv.trim()) return { ok: false, error: "Nothing to import — the file content was lost. Please re-upload." };

  try {
    const data = await api<{
      created: number;
      updated: number;
      errored: number;
      importJobId: string;
      labelsCreated: number;
      labelsApplied: number;
    }>("/workspace/imports/commit", {
      method: "POST",
      body: { csv, mapping, groupName, fileName, labelNames },
    });
    revalidateContacts();
    return { ok: true, ...data };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message };
    return { ok: false, error: String(err) };
  }
}
