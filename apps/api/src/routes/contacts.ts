import { Hono } from "hono";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  consentRecord,
  contact,
  contactTag,
  contactType,
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

contacts.get("/", async (c) => {
  const { clientId } = c.get("tenant");
  const q = c.req.query("q")?.trim();
  const state = c.req.query("deliverability");
  const tagId = c.req.query("tagId");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(c.req.query("pageSize") ?? 50)));

  return c.json(
    await withTenant(clientId, async (tx) => {
      const filters = [eq(contact.archived, "false")];

      if (q) {
        // Search across the fields an operator actually types: name, phone,
        // organization, member id, email.
        const like = `%${q}%`;
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
      if (state) filters.push(eq(contact.deliverabilityState, state as any));

      if (tagId) {
        const tagged = tx.select({ id: contactTag.contactId }).from(contactTag).where(eq(contactTag.tagId, tagId));
        filters.push(inArray(contact.id, tagged));
      }

      const where = and(...filters);

      const [{ total }] = await tx.select({ total: count() }).from(contact).where(where);
      const rows = await tx
        .select()
        .from(contact)
        .where(where)
        .orderBy(desc(contact.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return { contacts: rows, total: Number(total), page, pageSize };
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
      .where(eq(contactTag.contactId, id));

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

    return { contact: row, tags, consent, suppressed: suppressed ?? null };
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
    if (String(err?.message ?? err).includes("contact_client_phone_unique")) {
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
// Tags and contact types
// ---------------------------------------------------------------------------

contacts.get("/meta/tags", async (c) => {
  const { clientId } = c.get("tenant");
  return c.json(
    await withTenant(clientId, async (tx) => {
      // Join rather than a correlated subquery — see the equivalent note in
      // routes/campaigns.ts (meta/groups).
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
  const body = await c.req.json<{ name: string; color?: string }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);

  const row = await withTenant(clientId, async (tx) => {
    const [created] = await tx
      .insert(tag)
      .values({ clientId, name: body.name.trim(), color: body.color ?? null })
      .onConflictDoNothing({ target: [tag.clientId, tag.name] })
      .returning();
    return created;
  });
  return c.json({ tag: row ?? null }, row ? 201 : 200);
});

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

export default contacts;
