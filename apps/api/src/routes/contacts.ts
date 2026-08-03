import { Hono } from "hono";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  consentRecord,
  contact,
  contactGroup,
  contactGroupMember,
  contactTag,
  contactType,
  message,
  suppressionEntry,
  tag,
  withTenant,
} from "@wacits/db";
import { normalisePhone } from "@wacits/shared";
import { getOperatorUserId } from "../lib/operator";

/**
 * PRD §8 Contacts. Phone numbers are normalised to E.164 on the way in
 * (DM-5) and the raw operator input is preserved alongside, so a bad import
 * can always be explained back to whoever uploaded it.
 */
const contacts = new Hono();

const PAGE_SIZE_MAX = 200;

/** Ceiling on one bulk labelling call. Not a policy limit — a guard so a
 *  mis-typed filter cannot turn into an unbounded write in one request. */
const BULK_MAX = 25_000;

type ContactFilter = {
  q?: string;
  deliverability?: string;
  tagId?: string;
  groupId?: string;
  /** Matches contacts with at least one message that failed with this exact
   *  Meta error code (message.failed_error_code) — e.g. cleaning up 131026
   *  ("probable invalid contact") hits after a campaign, scoped to a group. */
  errorCode?: string;
};

/**
 * The one place the contact list's WHERE clause is built. The bulk labelling
 * endpoints resolve "everything matching what I am looking at" through this
 * same function, so what an operator sees on screen and what a bulk action
 * touches can never drift apart.
 */
function contactWhere(tx: any, f: ContactFilter) {
  const filters = [eq(contact.archived, "false")];

  if (f.q?.trim()) {
    // Search across the fields an operator actually types: name, phone,
    // organization, member id, email.
    const like = `%${f.q.trim()}%`;
    filters.push(
      or(
        ilike(contact.firstName, like),
        ilike(contact.lastName, like),
        ilike(contact.phoneNumber, like),
        ilike(contact.organization, like),
        ilike(contact.memberId, like),
        ilike(contact.email, like),
      )!,
    );
  }
  if (f.deliverability) filters.push(eq(contact.deliverabilityState, f.deliverability as any));

  if (f.tagId) {
    const tagged = tx.select({ id: contactTag.contactId }).from(contactTag).where(eq(contactTag.tagId, f.tagId));
    filters.push(inArray(contact.id, tagged));
  }
  if (f.groupId) {
    const grouped = tx
      .select({ id: contactGroupMember.contactId })
      .from(contactGroupMember)
      .where(eq(contactGroupMember.groupId, f.groupId));
    filters.push(inArray(contact.id, grouped));
  }
  if (f.errorCode) {
    const failed = tx
      .select({ id: message.contactId })
      .from(message)
      .where(eq(message.failedErrorCode, f.errorCode));
    filters.push(inArray(contact.id, failed));
  }

  return and(...filters);
}

function filterFromQuery(c: any): ContactFilter {
  return {
    q: c.req.query("q"),
    deliverability: c.req.query("deliverability"),
    tagId: c.req.query("tagId"),
    groupId: c.req.query("groupId"),
    errorCode: c.req.query("errorCode"),
  };
}

/** The labels attached to a page of contacts, in two batched queries rather
 *  than two per row. */
async function labelsFor(tx: any, contactIds: string[]) {
  if (contactIds.length === 0) return { tagsByContact: {}, groupsByContact: {} };

  const tagRows = await tx
    .select({ contactId: contactTag.contactId, id: tag.id, name: tag.name, color: tag.color })
    .from(contactTag)
    .innerJoin(tag, eq(tag.id, contactTag.tagId))
    .where(inArray(contactTag.contactId, contactIds));

  const groupRows = await tx
    .select({ contactId: contactGroupMember.contactId, id: contactGroup.id, name: contactGroup.name })
    .from(contactGroupMember)
    .innerJoin(contactGroup, eq(contactGroup.id, contactGroupMember.groupId))
    .where(inArray(contactGroupMember.contactId, contactIds));

  const tagsByContact: Record<string, { id: string; name: string; color: string | null }[]> = {};
  for (const r of tagRows) (tagsByContact[r.contactId] ??= []).push({ id: r.id, name: r.name, color: r.color });

  const groupsByContact: Record<string, { id: string; name: string }[]> = {};
  for (const r of groupRows) (groupsByContact[r.contactId] ??= []).push({ id: r.id, name: r.name });

  return { tagsByContact, groupsByContact };
}

contacts.get("/", async (c) => {
  const { clientId } = c.get("tenant");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(c.req.query("pageSize") ?? 50)));

  return c.json(
    await withTenant(clientId, async (tx) => {
      const where = contactWhere(tx, filterFromQuery(c));

      const [{ total }] = await tx.select({ total: count() }).from(contact).where(where);
      const rows = await tx
        .select()
        .from(contact)
        .where(where)
        .orderBy(desc(contact.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const { tagsByContact, groupsByContact } = await labelsFor(
        tx,
        rows.map((r: any) => r.id),
      );

      return {
        contacts: rows.map((r: any) => ({
          ...r,
          tags: tagsByContact[r.id] ?? [],
          groups: groupsByContact[r.id] ?? [],
        })),
        total: Number(total),
        page,
        pageSize,
      };
    }),
  );
});

contacts.get("/stats", async (c) => {
  const { clientId } = c.get("tenant");
  return c.json(
    await withTenant(clientId, async (tx) => {
      const [row] = await tx
        .select({
          total: count(),
          deliverable: sql<number>`count(*) filter (where ${contact.deliverabilityState} = 'deliverable')`,
          suspect: sql<number>`count(*) filter (where ${contact.deliverabilityState} = 'suspect')`,
          invalid: sql<number>`count(*) filter (where ${contact.deliverabilityState} = 'invalid')`,
          unknown: sql<number>`count(*) filter (where ${contact.deliverabilityState} = 'unknown')`,
        })
        .from(contact)
        .where(eq(contact.archived, "false"));
      return {
        total: Number(row.total),
        deliverable: Number(row.deliverable),
        suspect: Number(row.suspect),
        invalid: Number(row.invalid),
        unknown: Number(row.unknown),
      };
    }),
  );
});

contacts.get("/:id", async (c) => {
  const { clientId } = c.get("tenant");
  const id = c.req.param("id");

  const result = await withTenant(clientId, async (tx) => {
    const [row] = await tx.select().from(contact).where(eq(contact.id, id)).limit(1);
    if (!row) return null;

    const tags = await tx
      .select({ id: tag.id, name: tag.name, color: tag.color })
      .from(contactTag)
      .innerJoin(tag, eq(tag.id, contactTag.tagId))
      .where(eq(contactTag.contactId, id))
      .orderBy(asc(tag.name));

    const groups = await tx
      .select({ id: contactGroup.id, name: contactGroup.name })
      .from(contactGroupMember)
      .innerJoin(contactGroup, eq(contactGroup.id, contactGroupMember.groupId))
      .where(eq(contactGroupMember.contactId, id))
      .orderBy(asc(contactGroup.name));

    const consent = await tx
      .select()
      .from(consentRecord)
      .where(eq(consentRecord.contactId, id))
      .orderBy(desc(consentRecord.occurredAt))
      .limit(20);

    const [suppressed] = await tx
      .select({ id: suppressionEntry.id, reason: suppressionEntry.reason })
      .from(suppressionEntry)
      .where(eq(suppressionEntry.phoneNumber, row.phoneNumber))
      .limit(1);

    return { contact: row, tags, groups, consent, suppressed: suppressed ?? null };
  });

  if (!result) return c.json({ error: "Contact not found" }, 404);
  return c.json(result);
});

type ContactInput = {
  phoneNumber?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  organization?: string;
  designation?: string;
  memberId?: string;
  city?: string;
  state?: string;
  language?: string;
  notes?: string;
  contactTypeId?: string;
  source?: string;
};

contacts.post("/", async (c) => {
  const { clientId } = c.get("tenant");
  const body = await c.req.json<ContactInput>();

  if (!body.phoneNumber) return c.json({ error: "phoneNumber is required" }, 400);

  const normalised = normalisePhone(body.phoneNumber);
  if (!normalised.ok) {
    return c.json({ error: `Invalid phone number: ${normalised.message}`, reason: normalised.reason }, 400);
  }

  try {
    const row = await withTenant(clientId, async (tx) => {
      const [created] = await tx
        .insert(contact)
        .values({
          clientId,
          phoneNumber: normalised.e164,
          rawPhoneInput: normalised.raw,
          countryCode: normalised.countryCode ?? null,
          firstName: body.firstName ?? null,
          lastName: body.lastName ?? null,
          email: body.email ?? null,
          organization: body.organization ?? null,
          designation: body.designation ?? null,
          memberId: body.memberId ?? null,
          city: body.city ?? null,
          state: body.state ?? null,
          language: body.language ?? "en",
          notes: body.notes ?? null,
          contactTypeId: body.contactTypeId ?? null,
          source: body.source ?? "manual",
        })
        .returning();
      return created;
    });
    return c.json({ contact: row }, 201);
  } catch (err: any) {
    // Drizzle wraps the driver error (`Failed query: insert into ...` as
    // .message) with the real PostgresError on .cause — matching on the
    // wrapper's message here would never see the constraint name.
    const cause = err?.cause ?? err;
    if (cause?.code === "23505" && cause?.constraint_name === "contact_client_phone_unique") {
      return c.json({ error: "A contact with this phone number already exists in this workspace." }, 409);
    }
    throw err;
  }
});

contacts.patch("/:id", async (c) => {
  const { clientId } = c.get("tenant");
  const id = c.req.param("id");
  const body = await c.req.json<ContactInput>();

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of [
    "firstName",
    "lastName",
    "email",
    "organization",
    "designation",
    "memberId",
    "city",
    "state",
    "language",
    "notes",
    "contactTypeId",
  ] as const) {
    if (key in body) patch[key] = (body as any)[key] ?? null;
  }

  // Changing the phone number re-normalises and re-checks uniqueness — it
  // is effectively a different person, so it is allowed but never silent.
  if (body.phoneNumber) {
    const normalised = normalisePhone(body.phoneNumber);
    if (!normalised.ok) return c.json({ error: `Invalid phone number: ${normalised.message}` }, 400);
    patch.phoneNumber = normalised.e164;
    patch.rawPhoneInput = normalised.raw;
    patch.countryCode = normalised.countryCode ?? null;
  }

  const row = await withTenant(clientId, async (tx) => {
    const [updated] = await tx.update(contact).set(patch).where(eq(contact.id, id)).returning();
    return updated;
  });

  if (!row) return c.json({ error: "Contact not found" }, 404);
  return c.json({ contact: row });
});

/** Archive rather than delete: message history references the contact, and
 *  §20 requires the record to remain explainable. */
contacts.delete("/:id", async (c) => {
  const { clientId } = c.get("tenant");
  const id = c.req.param("id");

  const row = await withTenant(clientId, async (tx) => {
    const [updated] = await tx
      .update(contact)
      .set({ archived: "true", archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(contact.id, id))
      .returning({ id: contact.id });
    return updated;
  });

  if (!row) return c.json({ error: "Contact not found" }, 404);
  return c.json({ archived: true });
});

// ---------------------------------------------------------------------------
// Consent / opt-out (PRD §10)
// ---------------------------------------------------------------------------

/**
 * Records an opt-out and adds the number to the GLOBAL suppression list.
 * §21.7: suppression is not client-scoped — the duty not to contact is owed
 * to the person, not to one workspace.
 */
contacts.post("/:id/opt-out", async (c) => {
  const { clientId } = c.get("tenant");
  const id = c.req.param("id");
  const body = await c.req.json<{ reason?: string; sourceType?: string }>().catch(() => ({}) as any);
  const operatorUserId = await getOperatorUserId();

  const result = await withTenant(clientId, async (tx) => {
    const [row] = await tx.select().from(contact).where(eq(contact.id, id)).limit(1);
    if (!row) return null;

    await tx.insert(consentRecord).values({
      clientId,
      contactId: id,
      phoneNumberAsRecorded: row.phoneNumber,
      direction: "opt_out",
      category: "all",
      sourceType: (body?.sourceType as any) ?? "off_platform_request",
      sourceReference: body?.reason ?? "Recorded by operator in dashboard",
      recordedBy: operatorUserId,
    });

    await tx.update(contact).set({ marketingConsentState: "opted_out", updatedAt: new Date() }).where(eq(contact.id, id));
    return row;
  });

  if (!result) return c.json({ error: "Contact not found" }, 404);

  // Suppression is global, so it is written outside the tenant transaction.
  const { withSystemAccess } = await import("@wacits/db");
  await withSystemAccess(async (tx) => {
    await tx
      .insert(suppressionEntry)
      .values({
        phoneNumber: result.phoneNumber,
        reason: body?.reason ?? "Operator-recorded opt-out",
        source: "dashboard",
        originatingClientId: clientId,
      })
      .onConflictDoUpdate({
        target: suppressionEntry.phoneNumber,
        set: { lastReconfirmedAt: new Date() },
      });
  });

  return c.json({ optedOut: true });
});

/** Opt-in removes the suppression entry and records the evidence (§10). */
contacts.post("/:id/opt-in", async (c) => {
  const { clientId } = c.get("tenant");
  const id = c.req.param("id");
  const body = await c.req.json<{ wording?: string; sourceType?: string }>().catch(() => ({}) as any);
  const operatorUserId = await getOperatorUserId();

  const result = await withTenant(clientId, async (tx) => {
    const [row] = await tx.select().from(contact).where(eq(contact.id, id)).limit(1);
    if (!row) return null;

    await tx.insert(consentRecord).values({
      clientId,
      contactId: id,
      phoneNumberAsRecorded: row.phoneNumber,
      direction: "opt_in",
      category: "marketing",
      verbatimConsentWording: body?.wording ?? null,
      sourceType: (body?.sourceType as any) ?? "off_platform_request",
      recordedBy: operatorUserId,
    });
    await tx.update(contact).set({ marketingConsentState: "opted_in", updatedAt: new Date() }).where(eq(contact.id, id));
    return row;
  });

  if (!result) return c.json({ error: "Contact not found" }, 404);

  const { withSystemAccess } = await import("@wacits/db");
  await withSystemAccess(async (tx) => {
    await tx.delete(suppressionEntry).where(eq(suppressionEntry.phoneNumber, result.phoneNumber));
  });

  return c.json({ optedIn: true });
});

// ---------------------------------------------------------------------------
// Labels: groups, tags, and bulk assignment (PRD §21.3)
//
// Two deliberately different things share this section. A `contact_group` is
// a named STATIC list — membership is a stored row, which is what you want
// for "these people belong to client X". A `tag` is a free-floating label a
// contact may carry many of. Campaign audiences union both.
//
// ROUTE ORDER MATTERS: every `/meta/...` route must be registered before the
// `/:id/...` routes below it, or Hono will match `/meta/tags/<id>` against
// `/:id/tags/:tagId` with id="meta".
// ---------------------------------------------------------------------------

type BulkBody = {
  /** Explicit selection — what the operator ticked on screen. */
  contactIds?: string[];
  /** Or "everything matching what I am looking at", resolved server-side so
   *  the action is not capped by the page size. */
  filter?: ContactFilter;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Turns a bulk request into a list of contact IDs that genuinely exist, are
 * not archived, and belong to this workspace — resolved by a SELECT inside
 * the tenant transaction, so RLS does the filtering rather than trust in the
 * request body.
 */
async function resolveTargets(
  tx: any,
  body: BulkBody,
): Promise<{ ok: true; ids: string[] } | { ok: false; status: 400 | 413; error: string }> {
  const tooMany = {
    ok: false as const,
    status: 413 as const,
    error: `That selection is larger than ${BULK_MAX.toLocaleString()} contacts. Narrow the filter and apply the label in more than one pass.`,
  };

  if (body.contactIds?.length) {
    if (body.contactIds.length > BULK_MAX) return tooMany;
    const rows = await tx
      .select({ id: contact.id })
      .from(contact)
      .where(and(inArray(contact.id, body.contactIds), eq(contact.archived, "false")));
    return { ok: true, ids: rows.map((r: any) => r.id) };
  }

  if (body.filter) {
    const rows = await tx
      .select({ id: contact.id })
      .from(contact)
      .where(contactWhere(tx, body.filter))
      .limit(BULK_MAX + 1);
    if (rows.length > BULK_MAX) return tooMany;
    return { ok: true, ids: rows.map((r: any) => r.id) };
  }

  return { ok: false, status: 400, error: "Select at least one contact, or supply a filter." };
}

/** `cached_member_count` is advisory, so it is recomputed from the member
 *  rows rather than incremented — an idempotent add must not double-count. */
async function recountGroup(tx: any, groupId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(contactGroupMember)
    .where(eq(contactGroupMember.groupId, groupId));
  const n = Number(row.n);
  await tx
    .update(contactGroup)
    .set({ cachedMemberCount: n, lastRecountAt: new Date(), updatedAt: new Date() })
    .where(eq(contactGroup.id, groupId));
  return n;
}

// --- Groups ----------------------------------------------------------------

contacts.get("/meta/groups", async (c) => {
  const { clientId } = c.get("tenant");
  return c.json(
    await withTenant(clientId, async (tx) => {
      // Counted with a join rather than a correlated subquery: embedding a
      // column reference inside sql`` does not bind reliably here, and this
      // is both clearer and index-friendly.
      const rows = await tx
        .select({
          id: contactGroup.id,
          name: contactGroup.name,
          description: contactGroup.description,
          memberCount: count(contactGroupMember.id),
          createdAt: contactGroup.createdAt,
        })
        .from(contactGroup)
        .leftJoin(contactGroupMember, eq(contactGroupMember.groupId, contactGroup.id))
        .groupBy(contactGroup.id, contactGroup.name, contactGroup.description, contactGroup.createdAt)
        .orderBy(asc(contactGroup.name));
      return { groups: rows.map((r: any) => ({ ...r, memberCount: Number(r.memberCount) })) };
    }),
  );
});

contacts.post("/meta/groups", async (c) => {
  const { clientId } = c.get("tenant");
  const body = await c.req.json<{ name: string; description?: string } & BulkBody>();
  if (!body.name?.trim()) return c.json({ error: "A group name is required." }, 400);
  const operatorUserId = await getOperatorUserId();

  const result = await withTenant(clientId, async (tx) => {
    // Members are resolved before the group is inserted, so a selection that
    // is refused never leaves an empty group behind for the operator to trip
    // over on the retry.
    const seedRequested = Boolean(body.contactIds?.length || body.filter);
    const targets = seedRequested ? await resolveTargets(tx, body) : { ok: true as const, ids: [] as string[] };
    if (!targets.ok) return targets;

    const [group] = await tx
      .insert(contactGroup)
      .values({ clientId, name: body.name.trim(), description: body.description?.trim() || null })
      .onConflictDoNothing({ target: [contactGroup.clientId, contactGroup.name] })
      .returning();
    if (!group) return { ok: false as const, status: 409 as const, error: "A group with that name already exists." };

    if (targets.ids.length) {
      for (const batch of chunk(targets.ids, 5_000)) {
        await tx
          .insert(contactGroupMember)
          .values(batch.map((contactId) => ({ clientId, groupId: group.id, contactId, addedBy: operatorUserId })))
          .onConflictDoNothing({ target: [contactGroupMember.groupId, contactGroupMember.contactId] });
      }
      await recountGroup(tx, group.id);
    }
    return { ok: true as const, group, added: targets.ids.length };
  });

  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ group: result.group, added: result.added }, 201);
});

contacts.patch("/meta/groups/:groupId", async (c) => {
  const { clientId } = c.get("tenant");
  const groupId = c.req.param("groupId");
  const body = await c.req.json<{ name?: string; description?: string }>();

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) {
    if (!body.name.trim()) return c.json({ error: "A group name is required." }, 400);
    patch.name = body.name.trim();
  }
  if (body.description !== undefined) patch.description = body.description.trim() || null;

  try {
    const row = await withTenant(clientId, async (tx) => {
      const [updated] = await tx.update(contactGroup).set(patch).where(eq(contactGroup.id, groupId)).returning();
      return updated;
    });
    if (!row) return c.json({ error: "Group not found" }, 404);
    return c.json({ group: row });
  } catch (err: any) {
    const cause = err?.cause ?? err;
    if (cause?.code === "23505" && cause?.constraint_name === "contact_group_client_name_unique") {
      return c.json({ error: "A group with that name already exists." }, 409);
    }
    throw err;
  }
});

/** Deletes the group and its membership rows (ON DELETE CASCADE). The
 *  contacts themselves are untouched — a group is a label, not a container. */
contacts.delete("/meta/groups/:groupId", async (c) => {
  const { clientId } = c.get("tenant");
  const row = await withTenant(clientId, async (tx) => {
    const [deleted] = await tx
      .delete(contactGroup)
      .where(eq(contactGroup.id, c.req.param("groupId")))
      .returning({ id: contactGroup.id });
    return deleted;
  });
  if (!row) return c.json({ error: "Group not found" }, 404);
  return c.json({ deleted: true });
});

contacts.post("/meta/groups/:groupId/members", async (c) => {
  const { clientId } = c.get("tenant");
  const groupId = c.req.param("groupId");
  const body = await c.req.json<BulkBody>();
  const operatorUserId = await getOperatorUserId();

  const result = await withTenant(clientId, async (tx) => {
    const [group] = await tx
      .select({ id: contactGroup.id })
      .from(contactGroup)
      .where(eq(contactGroup.id, groupId))
      .limit(1);
    if (!group) return { ok: false as const, status: 404 as const, error: "Group not found" };

    const targets = await resolveTargets(tx, body);
    if (!targets.ok) return targets;

    for (const batch of chunk(targets.ids, 5_000)) {
      await tx
        .insert(contactGroupMember)
        .values(batch.map((contactId) => ({ clientId, groupId, contactId, addedBy: operatorUserId })))
        .onConflictDoNothing({ target: [contactGroupMember.groupId, contactGroupMember.contactId] });
    }
    const memberCount = await recountGroup(tx, groupId);
    return { ok: true as const, added: targets.ids.length, memberCount };
  });

  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ added: result.added, memberCount: result.memberCount });
});

contacts.post("/meta/groups/:groupId/members/remove", async (c) => {
  const { clientId } = c.get("tenant");
  const groupId = c.req.param("groupId");
  const body = await c.req.json<BulkBody>();

  const result = await withTenant(clientId, async (tx) => {
    const targets = await resolveTargets(tx, body);
    if (!targets.ok) return targets;

    let removed = 0;
    for (const batch of chunk(targets.ids, 10_000)) {
      const rows = await tx
        .delete(contactGroupMember)
        .where(and(eq(contactGroupMember.groupId, groupId), inArray(contactGroupMember.contactId, batch)))
        .returning({ id: contactGroupMember.id });
      removed += rows.length;
    }
    const memberCount = await recountGroup(tx, groupId);
    return { ok: true as const, removed, memberCount };
  });

  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ removed: result.removed, memberCount: result.memberCount });
});

// --- Tags ------------------------------------------------------------------

contacts.get("/meta/tags", async (c) => {
  const { clientId } = c.get("tenant");
  return c.json(
    await withTenant(clientId, async (tx) => {
      // Join rather than a correlated subquery — see the note on meta/groups.
      const rows = await tx
        .select({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          contactCount: count(contactTag.id),
        })
        .from(tag)
        .leftJoin(contactTag, eq(contactTag.tagId, tag.id))
        .groupBy(tag.id, tag.name, tag.color)
        .orderBy(asc(tag.name));
      return { tags: rows.map((r: any) => ({ ...r, contactCount: Number(r.contactCount) })) };
    }),
  );
});

contacts.post("/meta/tags", async (c) => {
  const { clientId } = c.get("tenant");
  const body = await c.req.json<{ name: string; color?: string } & BulkBody>();
  if (!body.name?.trim()) return c.json({ error: "A label name is required." }, 400);
  const operatorUserId = await getOperatorUserId();

  const name = body.name.trim();

  const result = await withTenant(clientId, async (tx) => {
    const seedRequested = Boolean(body.contactIds?.length || body.filter);
    const targets = seedRequested ? await resolveTargets(tx, body) : { ok: true as const, ids: [] as string[] };
    if (!targets.ok) return targets;

    // Unlike a group, re-using an existing label by name is the expected
    // thing rather than a conflict, so this upserts onto the existing row.
    let [row] = await tx
      .insert(tag)
      .values({ clientId, name, color: body.color ?? null })
      .onConflictDoNothing({ target: [tag.clientId, tag.name] })
      .returning();

    if (!row) {
      [row] = await tx.select().from(tag).where(eq(tag.name, name)).limit(1);
    }
    if (!row) return { ok: false as const, status: 409 as const, error: "That label could not be created." };
    const tagId = row.id;

    for (const batch of chunk(targets.ids, 5_000)) {
      await tx
        .insert(contactTag)
        .values(batch.map((contactId) => ({ clientId, tagId, contactId, appliedBy: operatorUserId })))
        .onConflictDoNothing({ target: [contactTag.tagId, contactTag.contactId] });
    }
    return { ok: true as const, tag: row, tagged: targets.ids.length };
  });

  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ tag: result.tag, tagged: result.tagged }, 201);
});

contacts.patch("/meta/tags/:tagId", async (c) => {
  const { clientId } = c.get("tenant");
  const body = await c.req.json<{ name?: string; color?: string }>();

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (!body.name.trim()) return c.json({ error: "A label name is required." }, 400);
    patch.name = body.name.trim();
  }
  if (body.color !== undefined) patch.color = body.color || null;
  if (Object.keys(patch).length === 0) return c.json({ error: "Nothing to change." }, 400);

  try {
    const row = await withTenant(clientId, async (tx) => {
      const [updated] = await tx.update(tag).set(patch).where(eq(tag.id, c.req.param("tagId"))).returning();
      return updated;
    });
    if (!row) return c.json({ error: "Label not found" }, 404);
    return c.json({ tag: row });
  } catch (err: any) {
    const cause = err?.cause ?? err;
    if (cause?.code === "23505" && cause?.constraint_name === "tag_client_name_unique") {
      return c.json({ error: "A label with that name already exists." }, 409);
    }
    throw err;
  }
});

contacts.delete("/meta/tags/:tagId", async (c) => {
  const { clientId } = c.get("tenant");
  const row = await withTenant(clientId, async (tx) => {
    const [deleted] = await tx
      .delete(tag)
      .where(eq(tag.id, c.req.param("tagId")))
      .returning({ id: tag.id });
    return deleted;
  });
  if (!row) return c.json({ error: "Label not found" }, 404);
  return c.json({ deleted: true });
});

contacts.post("/meta/tags/:tagId/contacts", async (c) => {
  const { clientId } = c.get("tenant");
  const tagId = c.req.param("tagId");
  const body = await c.req.json<BulkBody>();
  const operatorUserId = await getOperatorUserId();

  const result = await withTenant(clientId, async (tx) => {
    const [row] = await tx.select({ id: tag.id }).from(tag).where(eq(tag.id, tagId)).limit(1);
    if (!row) return { ok: false as const, status: 404 as const, error: "Label not found" };

    const targets = await resolveTargets(tx, body);
    if (!targets.ok) return targets;

    for (const batch of chunk(targets.ids, 5_000)) {
      await tx
        .insert(contactTag)
        .values(batch.map((contactId) => ({ clientId, tagId, contactId, appliedBy: operatorUserId })))
        .onConflictDoNothing({ target: [contactTag.tagId, contactTag.contactId] });
    }
    return { ok: true as const, tagged: targets.ids.length };
  });

  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ tagged: result.tagged });
});

contacts.post("/meta/tags/:tagId/contacts/remove", async (c) => {
  const { clientId } = c.get("tenant");
  const tagId = c.req.param("tagId");
  const body = await c.req.json<BulkBody>();

  const result = await withTenant(clientId, async (tx) => {
    const targets = await resolveTargets(tx, body);
    if (!targets.ok) return targets;

    let removed = 0;
    for (const batch of chunk(targets.ids, 10_000)) {
      const rows = await tx
        .delete(contactTag)
        .where(and(eq(contactTag.tagId, tagId), inArray(contactTag.contactId, batch)))
        .returning({ id: contactTag.id });
      removed += rows.length;
    }
    return { ok: true as const, removed };
  });

  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ removed: result.removed });
});

contacts.get("/meta/types", async (c) => {
  const { clientId } = c.get("tenant");
  return c.json(
    await withTenant(clientId, async (tx) => {
      const rows = await tx
        .select()
        .from(contactType)
        .where(eq(contactType.active, true))
        .orderBy(asc(contactType.sortOrder));
      return { contactTypes: rows };
    }),
  );
});

// --- Single-contact label edits (registered after every /meta route) --------

contacts.post("/:id/tags", async (c) => {
  const { clientId } = c.get("tenant");
  const id = c.req.param("id");
  const body = await c.req.json<{ tagId: string }>();
  const operatorUserId = await getOperatorUserId();

  await withTenant(clientId, async (tx) => {
    await tx
      .insert(contactTag)
      .values({ clientId, contactId: id, tagId: body.tagId, appliedBy: operatorUserId })
      .onConflictDoNothing({ target: [contactTag.tagId, contactTag.contactId] });
  });
  return c.json({ tagged: true });
});

contacts.delete("/:id/tags/:tagId", async (c) => {
  const { clientId } = c.get("tenant");
  await withTenant(clientId, async (tx) => {
    await tx
      .delete(contactTag)
      .where(and(eq(contactTag.contactId, c.req.param("id")), eq(contactTag.tagId, c.req.param("tagId"))));
  });
  return c.json({ untagged: true });
});

contacts.post("/:id/groups", async (c) => {
  const { clientId } = c.get("tenant");
  const id = c.req.param("id");
  const body = await c.req.json<{ groupId: string }>();
  const operatorUserId = await getOperatorUserId();

  const ok = await withTenant(clientId, async (tx) => {
    const [group] = await tx
      .select({ id: contactGroup.id })
      .from(contactGroup)
      .where(eq(contactGroup.id, body.groupId))
      .limit(1);
    if (!group) return false;

    await tx
      .insert(contactGroupMember)
      .values({ clientId, groupId: body.groupId, contactId: id, addedBy: operatorUserId })
      .onConflictDoNothing({ target: [contactGroupMember.groupId, contactGroupMember.contactId] });
    await recountGroup(tx, body.groupId);
    return true;
  });

  if (!ok) return c.json({ error: "Group not found" }, 404);
  return c.json({ added: true });
});

contacts.delete("/:id/groups/:groupId", async (c) => {
  const { clientId } = c.get("tenant");
  const groupId = c.req.param("groupId");
  await withTenant(clientId, async (tx) => {
    await tx
      .delete(contactGroupMember)
      .where(and(eq(contactGroupMember.contactId, c.req.param("id")), eq(contactGroupMember.groupId, groupId)));
    await recountGroup(tx, groupId);
  });
  return c.json({ removed: true });
});

export default contacts;
