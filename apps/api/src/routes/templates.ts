import { Hono } from "hono";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  accessToken,
  senderNumber,
  template,
  templateVersion,
  whatsappBusinessAccount,
  withTenant,
} from "@wacits/db";
import { decryptToken, listTemplates, MetaApiError } from "@wacits/shared";

/**
 * PRD §11 Templates. Templates live on the WABA and are authored and
 * approved inside Meta's own WhatsApp Manager — this product does not
 * submit them (that is a later phase). What it must do is know their
 * CURRENT status, because sending on a non-APPROVED template is guaranteed
 * to fail with 132001, and the campaign builder must not offer one.
 *
 * `template_version` is immutable per submitted body; campaigns reference
 * the version, never the mutable template row, so a template edited after a
 * send still explains exactly what was sent.
 */
const templates = new Hono();

templates.get("/", async (c) => {
  const { clientId } = c.get("tenant");
  const onlyApproved = c.req.query("approved") === "true";

  return c.json(
    await withTenant(clientId, async (tx) => {
      const filters = [];
      if (onlyApproved) filters.push(eq(template.currentStatus, "APPROVED"));

      const latestVersion = tx
        .selectDistinctOn([templateVersion.templateId], {
          templateId: templateVersion.templateId,
          id: templateVersion.id,
          components: templateVersion.components,
        })
        .from(templateVersion)
        .orderBy(templateVersion.templateId, desc(templateVersion.versionNumber))
        .as("latest_version");

      const rows = await tx
        .select({
          id: template.id,
          name: template.name,
          language: template.language,
          category: template.category,
          status: template.currentStatus,
          qualityScore: template.currentQualityScore,
          metaTemplateId: template.metaTemplateId,
          updatedAt: template.updatedAt,
          latestVersionId: latestVersion.id,
          components: latestVersion.components,
        })
        .from(template)
        .leftJoin(latestVersion, eq(latestVersion.templateId, template.id))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(template.name));

      return { templates: rows };
    }),
  );
});

/**
 * Pulls the current template list from Meta and reconciles it locally.
 * Idempotent — safe to press repeatedly, which matters because template
 * approval is asynchronous and operators will refresh while waiting.
 */
templates.post("/sync", async (c) => {
  const { clientId } = c.get("tenant");

  const outcome = await withTenant(clientId, async (tx) => {
    const [sender] = await tx
      .select({
        wabaRowId: whatsappBusinessAccount.id,
        metaWabaId: whatsappBusinessAccount.metaWabaId,
      })
      .from(senderNumber)
      .innerJoin(
        whatsappBusinessAccount,
        eq(whatsappBusinessAccount.id, senderNumber.whatsappBusinessAccountId),
      )
      .where(eq(senderNumber.clientId, clientId))
      .limit(1);

    if (!sender) {
      return { error: "No WhatsApp sender number is configured for this workspace yet." as const };
    }

    const [tokenRow] = await tx
      .select()
      .from(accessToken)
      .where(and(eq(accessToken.scope, "waba"), eq(accessToken.targetId, sender.wabaRowId)))
      .orderBy(desc(accessToken.createdAt))
      .limit(1);

    const token =
      tokenRow && !tokenRow.revokedAt ? decryptToken(tokenRow.encryptedTokenValue) : process.env.META_SYSTEM_USER_TOKEN;

    if (!token) return { error: "No Meta access token available to read templates." as const };

    let remote;
    try {
      remote = await listTemplates({ wabaId: sender.metaWabaId, token });
    } catch (err) {
      if (err instanceof MetaApiError) {
        return { error: `Meta rejected the template request: ${err.detail.message ?? err.message}` as const };
      }
      throw err;
    }

    let created = 0;
    let updated = 0;

    for (const t of remote) {
      const [existing] = await tx
        .select({ id: template.id })
        .from(template)
        .where(
          and(
            eq(template.whatsappBusinessAccountId, sender.wabaRowId),
            eq(template.name, t.name),
            eq(template.language, t.language),
          ),
        )
        .limit(1);

      if (existing) {
        await tx
          .update(template)
          .set({
            currentStatus: t.status as any,
            currentQualityScore: t.quality_score?.score ?? "UNKNOWN",
            category: (t.category?.toLowerCase() ?? "utility") as any,
            metaTemplateId: t.id,
            updatedAt: new Date(),
          })
          .where(eq(template.id, existing.id));
        updated++;

        const [latest] = await tx
          .select({ versionNumber: templateVersion.versionNumber, components: templateVersion.components })
          .from(templateVersion)
          .where(eq(templateVersion.templateId, existing.id))
          .orderBy(desc(templateVersion.versionNumber))
          .limit(1);

        const remoteComponents = t.components ?? [];
        if (!latest || JSON.stringify(latest.components) !== JSON.stringify(remoteComponents)) {
          await tx.insert(templateVersion).values({
            clientId,
            templateId: existing.id,
            versionNumber: (latest?.versionNumber ?? 0) + 1,
            components: remoteComponents,
            parameterFormat: "positional",
            language: t.language,
            reviewOutcome: t.status,
            approvedAt: t.status === "APPROVED" ? new Date() : null,
          });
        }
      } else {
        const [row] = await tx
          .insert(template)
          .values({
            clientId,
            whatsappBusinessAccountId: sender.wabaRowId,
            name: t.name,
            language: t.language,
            category: (t.category?.toLowerCase() ?? "utility") as any,
            currentStatus: t.status as any,
            currentQualityScore: t.quality_score?.score ?? "UNKNOWN",
            metaTemplateId: t.id,
          })
          .returning({ id: template.id });

        await tx.insert(templateVersion).values({
          clientId,
          templateId: row.id,
          versionNumber: 1,
          components: t.components ?? [],
          parameterFormat: "positional",
          language: t.language,
          reviewOutcome: t.status,
          approvedAt: t.status === "APPROVED" ? new Date() : null,
        });
        created++;
      }
    }

    return { created, updated, total: remote.length };
  });

  if ("error" in outcome) return c.json({ error: outcome.error }, 400);
  return c.json(outcome);
});

export default templates;
