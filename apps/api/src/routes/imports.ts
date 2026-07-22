import { Hono } from "hono";
import Papa from "papaparse";
import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  contact,
  contactGroup,
  contactGroupMember,
  importCreatedContact,
  importError,
  importJob,
  suppressionEntry,
  withSystemAccess,
  withTenant,
} from "@wacits/db";
import { normalisePhone } from "@wacits/shared";
import { getOperatorUserId } from "../lib/operator";

/**
 * PRD §9 Contact import. Three steps, deliberately separate:
 *
 *   1. POST /preview  — parse the file, guess the column mapping, show the
 *      operator what will happen, WITHOUT writing anything.
 *   2. POST /commit   — apply it, recording per-row errors rather than
 *      aborting the whole file on the first bad row.
 *   3. POST /:id/undo — DM-28's 24-hour undo, which removes only contacts
 *      this import CREATED, never ones it updated.
 *
 * A partial import that tells you exactly which 12 of 4,000 rows failed is
 * far more useful than an all-or-nothing failure, which is why row errors
 * are data (`import_error`) rather than an exception.
 */
const imports = new Hono();

const MAX_ROWS = 50_000;

/**
 * The header names an operator's spreadsheet realistically uses. Matched
 * case-insensitively with punctuation stripped.
 *
 * `exact` wins outright. `contains` is the fallback for the endless
 * real-world variations nobody can enumerate — "Contact No", "Delegate
 * Name", "Mobile Number (WhatsApp)" — and is why matching is two-pass
 * rather than a flat lookup.
 */
const HEADER_ALIASES: Record<string, { exact: string[]; contains: string[] }> = {
  phoneNumber: {
    exact: ["phone", "phonenumber", "mobile", "mobileno", "mobilenumber", "contact", "contactno", "contactnumber", "whatsapp", "whatsappnumber", "whatsappno", "number", "cell", "cellphone", "msisdn", "mob"],
    contains: ["phone", "mobile", "whatsapp", "msisdn", "contactno", "contactnumber", "cell"],
  },
  firstName: { exact: ["firstname", "fname", "givenname", "first"], contains: ["firstname", "givenname"] },
  lastName: { exact: ["lastname", "lname", "surname", "familyname", "last"], contains: ["lastname", "surname", "familyname"] },
  fullName: { exact: ["name", "fullname", "contactname", "customername", "delegatename", "membername", "studentname"], contains: ["name"] },
  email: { exact: ["email", "emailaddress", "mail", "emailid"], contains: ["email", "mail"] },
  organization: {
    exact: ["organization", "organisation", "company", "institution", "college", "university", "firm", "employer"],
    contains: ["organi", "company", "institut", "college", "univers", "employer"],
  },
  designation: { exact: ["designation", "title", "jobtitle", "role", "position"], contains: ["designation", "jobtitle", "position"] },
  memberId: {
    exact: ["memberid", "membershipid", "id", "employeeid", "rollno", "registrationno", "regno", "refno"],
    contains: ["memberid", "membershipid", "employeeid", "rollno", "registrationno", "regno"],
  },
  city: { exact: ["city", "town", "district", "location"], contains: ["city", "town", "district"] },
  state: { exact: ["state", "province", "region"], contains: ["province"] },
  language: { exact: ["language", "lang", "locale"], contains: ["language", "locale"] },
  notes: { exact: ["notes", "note", "remarks", "comment", "comments"], contains: ["remark", "comment"] },
};

function canonicalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Best-effort automatic mapping. The operator always sees and can correct
 * this before committing — it is a convenience, never an assumption, which
 * is why an ambiguous guess is preferable to no guess at all.
 *
 * Two passes so a header that exactly names one field is never stolen by a
 * looser `contains` match for another: "Name" and "Company Name" must map
 * to fullName and organization respectively, not both fight over "name".
 */
export function guessMapping(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const used = new Set<string>();
  const fields = Object.keys(HEADER_ALIASES);

  for (const field of fields) mapping[field] = null;

  // Pass 1 — exact canonical matches.
  for (const field of fields) {
    const match = headers.find((h) => !used.has(h) && HEADER_ALIASES[field]!.exact.includes(canonicalise(h)));
    if (match) {
      mapping[field] = match;
      used.add(match);
    }
  }

  // Pass 2 — substring matches for anything still unmapped. Phone first:
  // it is the only required field, so it gets first claim on an ambiguous
  // header like "Contact".
  for (const field of ["phoneNumber", ...fields.filter((f) => f !== "phoneNumber")]) {
    if (mapping[field]) continue;
    const needles = HEADER_ALIASES[field]!.contains;
    const match = headers.find((h) => {
      if (used.has(h)) return false;
      const c = canonicalise(h);
      return needles.some((n) => c.includes(n));
    });
    if (match) {
      mapping[field] = match;
      used.add(match);
    }
  }

  return mapping;
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[]; parseErrors: string[] } {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const parseErrors = (result.errors ?? []).slice(0, 20).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`);
  return {
    headers: (result.meta?.fields ?? []).filter(Boolean),
    rows: (result.data ?? []) as Record<string, string>[],
    parseErrors,
  };
}

/** Splits "Priya Sharma" when the file has one name column instead of two. */
function splitFullName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

type MappedRow = {
  rowNumber: number;
  raw: Record<string, string>;
  phone: ReturnType<typeof normalisePhone>;
  values: Record<string, string | null>;
};

function mapRows(rows: Record<string, string>[], mapping: Record<string, string | null>): MappedRow[] {
  return rows.map((raw, i) => {
    const pick = (field: string): string | null => {
      const col = mapping[field];
      if (!col) return null;
      const v = raw[col];
      return v && String(v).trim() ? String(v).trim() : null;
    };

    let firstName = pick("firstName");
    let lastName = pick("lastName");
    const fullName = pick("fullName");
    if (!firstName && fullName) {
      const split = splitFullName(fullName);
      firstName = split.firstName;
      lastName = lastName ?? split.lastName;
    }

    const rawPhone = pick("phoneNumber") ?? "";

    return {
      rowNumber: i + 2, // +2: 1-indexed, plus the header row
      raw,
      phone: normalisePhone(rawPhone),
      values: {
        firstName,
        lastName,
        email: pick("email"),
        organization: pick("organization"),
        designation: pick("designation"),
        memberId: pick("memberId"),
        city: pick("city"),
        state: pick("state"),
        language: pick("language"),
        notes: pick("notes"),
      },
    };
  });
}

/**
 * Step 1 — parse and report, write nothing. Also reports how many rows are
 * already suppressed, because an operator importing 5,000 numbers deserves
 * to know 40 of them have opted out before they build a campaign on it.
 */
imports.post("/preview", async (c) => {
  const { clientId } = c.get("tenant");
  const body = await c.req.json<{ csv: string; mapping?: Record<string, string | null> }>();

  if (!body.csv?.trim()) return c.json({ error: "csv content is required" }, 400);

  const { headers, rows, parseErrors } = parseCsv(body.csv);
  if (!headers.length) return c.json({ error: "Could not read any column headers from this file." }, 400);
  if (rows.length > MAX_ROWS) {
    return c.json({ error: `File has ${rows.length} rows; the limit is ${MAX_ROWS}. Split it and import in parts.` }, 400);
  }

  const mapping = body.mapping ?? guessMapping(headers);
  if (!mapping.phoneNumber) {
    return c.json(
      {
        error: "No phone number column could be identified. Choose which column holds the phone number.",
        headers,
        mapping,
      },
      400,
    );
  }

  const mapped = mapRows(rows, mapping);
  const valid = mapped.filter((r) => r.phone.ok);
  const invalid = mapped.filter((r) => !r.phone.ok);

  // Duplicates *within the file itself* — common when a list is assembled
  // from several sources.
  const seen = new Set<string>();
  const duplicatesInFile: string[] = [];
  for (const r of valid) {
    const e164 = (r.phone as any).e164;
    if (seen.has(e164)) duplicatesInFile.push(e164);
    else seen.add(e164);
  }

  const uniquePhones = [...seen];
  const { existing, suppressed } = await withTenant(clientId, async (tx) => {
    if (!uniquePhones.length) return { existing: [] as string[], suppressed: [] as string[] };
    const existingRows = await tx
      .select({ phoneNumber: contact.phoneNumber })
      .from(contact)
      .where(inArray(contact.phoneNumber, uniquePhones));
    return { existing: existingRows.map((r: any) => r.phoneNumber), suppressed: [] as string[] };
  });

  const suppressedRows = await withSystemAccess(async (tx) =>
    uniquePhones.length
      ? await tx
          .select({ phoneNumber: suppressionEntry.phoneNumber })
          .from(suppressionEntry)
          .where(inArray(suppressionEntry.phoneNumber, uniquePhones))
      : [],
  );

  return c.json({
    headers,
    mapping,
    totalRows: rows.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    duplicateInFileCount: duplicatesInFile.length,
    willCreateCount: uniquePhones.filter((p) => !existing.includes(p)).length,
    willUpdateCount: uniquePhones.filter((p) => existing.includes(p)).length,
    suppressedCount: suppressedRows.length,
    parseErrors,
    invalidSamples: invalid.slice(0, 25).map((r) => ({
      rowNumber: r.rowNumber,
      value: (r.phone as any).raw,
      message: (r.phone as any).message,
    })),
    sampleRows: valid.slice(0, 10).map((r) => ({
      rowNumber: r.rowNumber,
      phoneNumber: (r.phone as any).e164,
      ...r.values,
    })),
  });
});

/** Step 2 — apply. Upserts on (client, phone); records every rejected row. */
imports.post("/commit", async (c) => {
  const { clientId } = c.get("tenant");
  const body = await c.req.json<{
    csv: string;
    mapping: Record<string, string | null>;
    fileName?: string;
    /** Optional: also add every imported contact to this group, so the
     *  import can be targeted as a campaign audience immediately. */
    groupName?: string;
  }>();

  if (!body.csv?.trim()) return c.json({ error: "csv content is required" }, 400);
  if (!body.mapping?.phoneNumber) return c.json({ error: "mapping.phoneNumber is required" }, 400);

  const operatorUserId = await getOperatorUserId();
  const { rows } = parseCsv(body.csv);
  if (rows.length > MAX_ROWS) return c.json({ error: `Too many rows (limit ${MAX_ROWS}).` }, 400);

  const mapped = mapRows(rows, body.mapping);

  const result = await withTenant(clientId, async (tx) => {
    const [job] = await tx
      .insert(importJob)
      .values({
        clientId,
        uploadedBy: operatorUserId,
        fileName: body.fileName ?? "upload.csv",
        fileSize: body.csv.length,
        rowCount: rows.length,
        state: "running",
        mappingDefinition: body.mapping,
        startedAt: new Date(),
      })
      .returning();

    let groupId: string | null = null;
    if (body.groupName?.trim()) {
      const [group] = await tx
        .insert(contactGroup)
        .values({ clientId, name: body.groupName.trim(), description: `Created by import ${job.id}` })
        .onConflictDoNothing({ target: [contactGroup.clientId, contactGroup.name] })
        .returning({ id: contactGroup.id });
      if (group) {
        groupId = group.id;
      } else {
        const [found] = await tx
          .select({ id: contactGroup.id })
          .from(contactGroup)
          .where(eq(contactGroup.name, body.groupName.trim()))
          .limit(1);
        groupId = found?.id ?? null;
      }
    }

    let created = 0;
    let updated = 0;
    let errored = 0;
    const seenInThisFile = new Set<string>();

    for (const row of mapped) {
      if (!row.phone.ok) {
        errored++;
        await tx.insert(importError).values({
          clientId,
          importJobId: job.id,
          rowNumber: row.rowNumber,
          rawRow: row.raw,
          errorType: (row.phone as any).reason,
          errorMessage: (row.phone as any).message,
        });
        continue;
      }

      const e164 = (row.phone as any).e164;
      // A number repeated inside one file is not an error worth reporting,
      // but it must not be counted twice either.
      if (seenInThisFile.has(e164)) continue;
      seenInThisFile.add(e164);

      const [existing] = await tx
        .select({ id: contact.id })
        .from(contact)
        .where(eq(contact.phoneNumber, e164))
        .limit(1);

      if (existing) {
        // Only fill in blanks — an import must never wipe a field an
        // operator curated by hand with an empty CSV cell.
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        for (const [k, v] of Object.entries(row.values)) {
          if (v !== null && v !== undefined && v !== "") patch[k] = v;
        }
        await tx.update(contact).set(patch).where(eq(contact.id, existing.id));
        updated++;
        if (groupId) {
          await tx
            .insert(contactGroupMember)
            .values({ clientId, groupId, contactId: existing.id, addedBy: operatorUserId })
            .onConflictDoNothing({ target: [contactGroupMember.groupId, contactGroupMember.contactId] });
        }
      } else {
        const [newContact] = await tx
          .insert(contact)
          .values({
            clientId,
            phoneNumber: e164,
            rawPhoneInput: (row.phone as any).raw,
            countryCode: (row.phone as any).countryCode ?? null,
            firstName: row.values.firstName,
            lastName: row.values.lastName,
            email: row.values.email,
            organization: row.values.organization,
            designation: row.values.designation,
            memberId: row.values.memberId,
            city: row.values.city,
            state: row.values.state,
            language: row.values.language ?? "en",
            notes: row.values.notes,
            source: `import:${job.id}`,
          })
          .returning({ id: contact.id });

        created++;
        // DM-28: only creations are recorded, so undo can never delete a
        // contact that existed before this import ran.
        await tx.insert(importCreatedContact).values({ clientId, importJobId: job.id, contactId: newContact.id });
        if (groupId) {
          await tx
            .insert(contactGroupMember)
            .values({ clientId, groupId, contactId: newContact.id, addedBy: operatorUserId })
            .onConflictDoNothing({ target: [contactGroupMember.groupId, contactGroupMember.contactId] });
        }
      }
    }

    const finishedAt = new Date();
    await tx
      .update(importJob)
      .set({
        state: "completed",
        createdCount: created,
        updatedCount: updated,
        erroredCount: errored,
        skippedCount: rows.length - created - updated - errored,
        finishedAt,
        undoAvailableUntil: new Date(finishedAt.getTime() + 24 * 60 * 60 * 1000),
      })
      .where(eq(importJob.id, job.id));

    if (groupId) {
      await tx
        .update(contactGroup)
        .set({
          cachedMemberCount: sql`(select count(*) from contact_group_member m where m.group_id = ${groupId})`,
          lastRecountAt: new Date(),
        })
        .where(eq(contactGroup.id, groupId));
    }

    return { importJobId: job.id, created, updated, errored, groupId };
  });

  return c.json(result, 201);
});

imports.get("/", async (c) => {
  const { clientId } = c.get("tenant");
  return c.json(
    await withTenant(clientId, async (tx) => {
      const rows = await tx.select().from(importJob).orderBy(desc(importJob.createdAt)).limit(50);
      return { imports: rows };
    }),
  );
});

imports.get("/:id/errors", async (c) => {
  const { clientId } = c.get("tenant");
  return c.json(
    await withTenant(clientId, async (tx) => {
      const rows = await tx
        .select()
        .from(importError)
        .where(eq(importError.importJobId, c.req.param("id")))
        .limit(500);
      return { errors: rows };
    }),
  );
});

/** DM-28 — the only rollback that exists in the product, and only within
 *  24 hours, and only for contacts this import created. */
imports.post("/:id/undo", async (c) => {
  const { clientId } = c.get("tenant");
  const id = c.req.param("id");
  const operatorUserId = await getOperatorUserId();

  const outcome = await withTenant(clientId, async (tx) => {
    const [job] = await tx.select().from(importJob).where(eq(importJob.id, id)).limit(1);
    if (!job) return { error: "Import not found" as const };
    if (job.undoneAt) return { error: "This import has already been undone." as const };
    if (!job.undoAvailableUntil || job.undoAvailableUntil.getTime() < Date.now()) {
      return { error: "The 24-hour undo window for this import has expired." as const };
    }

    const createdRows = await tx
      .select({ contactId: importCreatedContact.contactId })
      .from(importCreatedContact)
      .where(eq(importCreatedContact.importJobId, id));

    let removed = 0;
    for (const row of createdRows) {
      await tx.delete(contact).where(eq(contact.id, row.contactId));
      removed++;
    }

    await tx.update(importJob).set({ undoneAt: new Date(), undoneBy: operatorUserId }).where(eq(importJob.id, id));
    return { removed };
  });

  if ("error" in outcome) return c.json({ error: outcome.error }, 400);
  return c.json(outcome);
});

export default imports;
