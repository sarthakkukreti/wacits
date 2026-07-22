import { Hono } from "hono";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  campaign,
  campaignAudienceSnapshot,
  campaignRecipient,
  contact,
  contactGroup,
  contactGroupMember,
  contactTag,
  suppressionEntry,
  template,
  templateVersion,
  withSystemAccess,
  withTenant,
} from "@wacits/db";
import { sendQueue } from "@wacits/queue";
import { getOperatorUserId } from "../lib/operator";
import { resolveSender } from "../lib/sending";

/**
 * PRD §12 Campaigns — a planned bulk send to a resolved audience.
 *
 * The two things this file is careful about:
 *
 *  - The audience is SNAPSHOT at launch (campaign_audience_snapshot) and
 *    expanded into one campaign_recipient row per person. Those rows are
 *    the outbox. Re-running a filter later can never change who a campaign
 *    already went to, which is what makes a send reproducible and
 *    explainable months afterwards.
 *
 *  - Suppression and consent are applied at snapshot time, and the people
 *    removed are COUNTED, not silently dropped. "Sent to 4,860 of 5,000 —
 *    140 suppressed" is an answer; "sent to 4,860" is not.
 */
const campaigns = new Hono();

// ---------------------------------------------------------------------------
// Audience resolution
// ---------------------------------------------------------------------------

export type AudienceSpec = {
  /** Everyone in the workspace who is not archived. */
  allContacts?: boolean;
  groupIds?: string[];
  tagIds?: string[];
  contactIds?: string[];
  /** Exclude contacts whose deliverability has been marked suspect/invalid
   *  by previous send evidence (DM-22). Defaults to true — sending to
   *  known-bad numbers damages quality rating for no benefit. */
  excludeUndeliverable?: boolean;
};

async function resolveAudience(tx: any, spec: AudienceSpec): Promise<{ id: string; phoneNumber: string }[]> {
  const filters = [eq(contact.archived, "false")];

  if (spec.excludeUndeliverable !== false) {
    filters.push(sql`${contact.deliverabilityState} NOT IN ('invalid', 'suspect')` as any);
  }

  const idSources: any[] = [];
  if (spec.groupIds?.length) {
    idSources.push(
      tx
        .select({ id: contactGroupMember.contactId })
        .from(contactGroupMember)
        .where(inArray(contactGroupMember.groupId, spec.groupIds)),
    );
  }
  if (spec.tagIds?.length) {
    idSources.push(
      tx.select({ id: contactTag.contactId }).from(contactTag).where(inArray(contactTag.tagId, spec.tagIds)),
    );
  }

  if (!spec.allContacts) {
    if (spec.contactIds?.length) {
      filters.push(inArray(contact.id, spec.contactIds));
    } else if (idSources.length === 1) {
      filters.push(inArray(contact.id, idSources[0]));
    } else if (idSources.length > 1) {
      // Union of groups and tags — someone in either qualifies.
      filters.push(
        sql`(${contact.id} IN ${idSources[0]} OR ${contact.id} IN ${idSources[1]})` as any,
      );
    } else {
      return [];
    }
  }

  return tx
    .select({ id: contact.id, phoneNumber: contact.phoneNumber })
    .from(contact)
    .where(and(...filters));
}

/** Preview an audience without creating anything — the count an operator
 *  sees before they commit to a send. */
campaigns.post("/audience/preview", async (c) => {
  const { clientId } = c.get("tenant");
  const spec = await c.req.json<AudienceSpec>();

  const resolved = await withTenant(clientId, (tx) => resolveAudience(tx, spec));
  const phones = resolved.map((r) => r.phoneNumber);

  const suppressed = phones.length
    ? await withSystemAccess(async (tx) =>
        tx
          .select({ phoneNumber: suppressionEntry.phoneNumber })
          .from(suppressionEntry)
          .where(inArray(suppressionEntry.phoneNumber, phones)),
      )
    : [];

  const suppressedSet = new Set(suppressed.map((s: any) => s.phoneNumber));

  return c.json({
    resolvedCount: resolved.length,
    suppressedCount: suppressedSet.size,
    sendableCount: resolved.length - suppressedSet.size,
  });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

campaigns.get("/", async (c) => {
  const { clientId } = c.get("tenant");
  return c.json(
    await withTenant(clientId, async (tx) => {
      const rows = await tx
        .select({
          id: campaign.id,
          name: campaign.name,
          state: campaign.state,
          scheduledAt: campaign.scheduledAt,
          countQueued: campaign.countQueued,
          countSent: campaign.countSent,
          countDelivered: campaign.countDelivered,
          countRead: campaign.countRead,
          countFailed: campaign.countFailed,
          createdAt: campaign.createdAt,
          templateName: template.name,
          templateLanguage: template.language,
        })
        .from(campaign)
        .leftJoin(templateVersion, eq(templateVersion.id, campaign.templateVersionId))
        .leftJoin(template, eq(template.id, templateVersion.templateId))
        .orderBy(desc(campaign.createdAt))
        .limit(100);
      return { campaigns: rows };
    }),
  );
});

campaigns.get("/:id", async (c) => {
  const { clientId } = c.get("tenant");
  const id = c.req.param("id");

  const result = await withTenant(clientId, async (tx) => {
    const [row] = await tx
      .select({
        campaign: campaign,
        templateName: template.name,
        templateLanguage: template.language,
      })
      .from(campaign)
      .leftJoin(templateVersion, eq(templateVersion.id, campaign.templateVersionId))
      .leftJoin(template, eq(template.id, templateVersion.templateId))
      .where(eq(campaign.id, id))
      .limit(1);

    if (!row) return null;

    const [snapshot] = await tx
      .select()
      .from(campaignAudienceSnapshot)
      .where(eq(campaignAudienceSnapshot.campaignId, id))
      .limit(1);

    // Live state breakdown straight off the outbox — the campaign's own
    // counters are a cache, this is the truth.
    const breakdown = await tx
      .select({ state: campaignRecipient.state, n: count() })
      .from(campaignRecipient)
      .where(eq(campaignRecipient.campaignId, id))
      .groupBy(campaignRecipient.state);

    const failures = await tx
      .select({
        errorCode: campaignRecipient.errorCode,
        n: count(),
      })
      .from(campaignRecipient)
      .where(and(eq(campaignRecipient.campaignId, id), eq(campaignRecipient.state, "failed")))
      .groupBy(campaignRecipient.errorCode);

    return {
      ...row.campaign,
      templateName: row.templateName,
      templateLanguage: row.templateLanguage,
      snapshot: snapshot ?? null,
      breakdown: Object.fromEntries(breakdown.map((b: any) => [b.state, Number(b.n)])),
      failures: failures.map((f: any) => ({ errorCode: f.errorCode ?? "unknown", count: Number(f.n) })),
    };
  });

  if (!result) return c.json({ error: "Campaign not found" }, 404);
  return c.json(result);
});

campaigns.get("/:id/recipients", async (c) => {
  const { clientId } = c.get("tenant");
  const state = c.req.query("state");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(c.req.query("pageSize") ?? 50)));

  return c.json(
    await withTenant(clientId, async (tx) => {
      const filters = [eq(campaignRecipient.campaignId, c.req.param("id"))];
      if (state) filters.push(eq(campaignRecipient.state, state as any));
      const where = and(...filters);

      const rows = await tx
        .select({
          id: campaignRecipient.id,
          state: campaignRecipient.state,
          errorCode: campaignRecipient.errorCode,
          skipReason: campaignRecipient.skipReason,
          lastAttemptAt: campaignRecipient.lastAttemptAt,
          firstName: contact.firstName,
          lastName: contact.lastName,
          phoneNumber: contact.phoneNumber,
        })
        .from(campaignRecipient)
        .innerJoin(contact, eq(contact.id, campaignRecipient.contactId))
        .where(where)
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ total }] = await tx.select({ total: count() }).from(campaignRecipient).where(where);
      return { recipients: rows, total: Number(total), page, pageSize };
    }),
  );
});

/**
 * Creates a campaign AND expands its audience into the outbox in one step,
 * leaving it in `draft`. Nothing is sent until /launch is called — that
 * separation is what makes the "you are about to message 4,860 people"
 * confirmation meaningful.
 */
campaigns.post("/", async (c) => {
  const { clientId } = c.get("tenant");
  const body = await c.req.json<{
    name: string;
    templateVersionId: string;
    audience: AudienceSpec;
    scheduledAt?: string;
    /** Maps template placeholder index -> contact field or literal, e.g.
     *  { "1": "{{firstName}}", "2": "Annual Meet 2026" } */
    parameterMapping?: Record<string, string>;
  }>();

  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  if (!body.templateVersionId) return c.json({ error: "templateVersionId is required" }, 400);

  const operatorUserId = await getOperatorUserId();

  const result = await withTenant(clientId, async (tx) => {
    const [version] = await tx
      .select({
        id: templateVersion.id,
        templateId: templateVersion.templateId,
        language: templateVersion.language,
        status: template.currentStatus,
        name: template.name,
      })
      .from(templateVersion)
      .innerJoin(template, eq(template.id, templateVersion.templateId))
      .where(eq(templateVersion.id, body.templateVersionId))
      .limit(1);

    if (!version) return { error: "Template version not found" as const };
    // §11: an unapproved template must never be released to the sending
    // engine — Meta would reject every message with 132001.
    if (version.status !== "APPROVED") {
      return { error: `Template "${version.name}" is ${version.status}, not APPROVED. Only approved templates can be sent.` as const };
    }

    const sender = await resolveSender(tx, clientId);
    const audience = await resolveAudience(tx, body.audience);
    if (!audience.length) return { error: "This audience resolves to zero contacts." as const };

    const phones = audience.map((a) => a.phoneNumber);
    const suppressedRows = await withSystemAccess(async (stx) =>
      stx
        .select({ phoneNumber: suppressionEntry.phoneNumber })
        .from(suppressionEntry)
        .where(inArray(suppressionEntry.phoneNumber, phones)),
    );
    const suppressed = new Set(suppressedRows.map((s: any) => s.phoneNumber));
    const sendable = audience.filter((a) => !suppressed.has(a.phoneNumber));

    if (!sendable.length) {
      return { error: "Every contact in this audience is on the opt-out list." as const };
    }

    const [created] = await tx
      .insert(campaign)
      .values({
        clientId,
        name: body.name.trim(),
        senderNumberId: sender.senderNumberId,
        templateVersionId: version.id,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        state: "draft",
        stateChangedAt: new Date(),
        createdBy: operatorUserId,
      })
      .returning();

    await tx.insert(campaignAudienceSnapshot).values({
      clientId,
      campaignId: created.id,
      filterDefinition: { ...body.audience, parameterMapping: body.parameterMapping ?? null },
      groupIds: body.audience.groupIds ?? [],
      savedSegmentIds: [],
      resolvedContactCount: audience.length,
      suppressedCount: suppressed.size,
      frequencyCappedCount: 0,
    });

    // Expand the outbox. Batched because a 50k-row insert as one statement
    // is a memory spike for no benefit.
    const BATCH = 500;
    for (let i = 0; i < sendable.length; i += BATCH) {
      const slice = sendable.slice(i, i + BATCH);
      await tx.insert(campaignRecipient).values(
        slice.map((person) => ({
          clientId,
          campaignId: created.id,
          contactId: person.id,
          templateVersionId: version.id,
          attemptKey: 1,
          resolvedParameterValues: body.parameterMapping ?? {},
          state: "pending" as const,
          sendId: crypto.randomUUID(),
        })),
      );
    }

    await tx.update(campaign).set({ countQueued: sendable.length }).where(eq(campaign.id, created.id));

    return {
      campaign: { ...created, countQueued: sendable.length },
      resolvedCount: audience.length,
      suppressedCount: suppressed.size,
      sendableCount: sendable.length,
    };
  });

  if ("error" in result) return c.json({ error: result.error }, 400);
  return c.json(result, 201);
});

/**
 * Releases a draft campaign to the send queue. This is the point of no
 * return, so it is a separate, explicit call.
 */
campaigns.post("/:id/launch", async (c) => {
  const { clientId } = c.get("tenant");
  const id = c.req.param("id");

  const result = await withTenant(clientId, async (tx) => {
    const [row] = await tx.select().from(campaign).where(eq(campaign.id, id)).limit(1);
    if (!row) return { error: "Campaign not found" as const };
    if (!["draft", "scheduled", "paused"].includes(row.state)) {
      return { error: `Campaign is ${row.state} and cannot be launched.` as const };
    }

    const pending = await tx
      .select({ id: campaignRecipient.id, attemptKey: campaignRecipient.attemptKey })
      .from(campaignRecipient)
      .where(and(eq(campaignRecipient.campaignId, id), eq(campaignRecipient.state, "pending")));

    await tx
      .update(campaign)
      .set({ state: "running", stateChangedAt: new Date() })
      .where(eq(campaign.id, id));

    return { campaignId: id, pending };
  });

  if ("error" in result) return c.json({ error: result.error }, 400);

  // Enqueue outside the transaction: a job that runs before the commit
  // lands would not find its own row.
  await sendQueue.addBulk(
    result.pending.map((r: any) => ({
      name: "send",
      data: { campaignRecipientId: r.id, campaignId: id, attemptKey: r.attemptKey },
      opts: {
        // Idempotent enqueue (AR-13): re-launching a campaign can never
        // double-send, because the same (recipient, attempt) maps to the
        // same job id. Hyphen-separated deliberately — BullMQ rejects a
        // custom id containing ':' unless it has exactly three parts.
        jobId: `send-${r.id}-${r.attemptKey}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    })),
  );

  return c.json({ launched: true, queued: result.pending.length });
});

campaigns.post("/:id/pause", async (c) => {
  const { clientId } = c.get("tenant");
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as any);

  const row = await withTenant(clientId, async (tx) => {
    const [updated] = await tx
      .update(campaign)
      .set({ state: "paused", pauseReason: body?.reason ?? "Paused by operator", stateChangedAt: new Date() })
      .where(and(eq(campaign.id, c.req.param("id")), eq(campaign.state, "running")))
      .returning({ id: campaign.id, state: campaign.state });
    return updated;
  });

  if (!row) return c.json({ error: "Campaign is not running." }, 400);
  return c.json(row);
});

campaigns.post("/:id/cancel", async (c) => {
  const { clientId } = c.get("tenant");
  const id = c.req.param("id");

  const row = await withTenant(clientId, async (tx) => {
    const [updated] = await tx
      .update(campaign)
      .set({ state: "cancelled", stateChangedAt: new Date(), stopReason: "Cancelled by operator" })
      .where(eq(campaign.id, id))
      .returning({ id: campaign.id });
    if (!updated) return null;

    // Anything not yet sent is skipped — never leave rows in `pending`
    // where a stray worker could still pick them up.
    await tx
      .update(campaignRecipient)
      .set({ state: "skipped", skipReason: "campaign_cancelled" })
      .where(and(eq(campaignRecipient.campaignId, id), eq(campaignRecipient.state, "pending")));
    return updated;
  });

  if (!row) return c.json({ error: "Campaign not found" }, 404);
  return c.json({ cancelled: true });
});

// ---------------------------------------------------------------------------
// Groups (audience building blocks)
// ---------------------------------------------------------------------------

campaigns.get("/meta/groups", async (c) => {
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
        })
        .from(contactGroup)
        .leftJoin(contactGroupMember, eq(contactGroupMember.groupId, contactGroup.id))
        .groupBy(contactGroup.id, contactGroup.name, contactGroup.description, contactGroup.createdAt)
        .orderBy(desc(contactGroup.createdAt));
      return { groups: rows.map((r: any) => ({ ...r, memberCount: Number(r.memberCount) })) };
    }),
  );
});

campaigns.post("/meta/groups", async (c) => {
  const { clientId } = c.get("tenant");
  const body = await c.req.json<{ name: string; description?: string; contactIds?: string[] }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  const operatorUserId = await getOperatorUserId();

  const row = await withTenant(clientId, async (tx) => {
    const [group] = await tx
      .insert(contactGroup)
      .values({ clientId, name: body.name.trim(), description: body.description ?? null })
      .onConflictDoNothing({ target: [contactGroup.clientId, contactGroup.name] })
      .returning();
    if (!group) return null;

    if (body.contactIds?.length) {
      await tx.insert(contactGroupMember).values(
        body.contactIds.map((contactId) => ({
          clientId,
          groupId: group.id,
          contactId,
          addedBy: operatorUserId,
        })),
      );
      await tx
        .update(contactGroup)
        .set({ cachedMemberCount: body.contactIds.length, lastRecountAt: new Date() })
        .where(eq(contactGroup.id, group.id));
    }
    return group;
  });

  if (!row) return c.json({ error: "A group with that name already exists." }, 409);
  return c.json({ group: row }, 201);
});

export default campaigns;
