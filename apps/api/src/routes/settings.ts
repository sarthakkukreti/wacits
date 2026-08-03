import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import {
  accessToken,
  businessPortfolio,
  senderNumber,
  whatsappBusinessAccount,
  withSystemAccess,
  withTenant,
} from "@wacits/db";
import { DEFAULT_REGION, encryptToken, maskToken, normalisePhone } from "@wacits/shared";
import { requirePermission } from "../middleware/permission";
import { writeAuditLog } from "../lib/audit";

/**
 * Settings — connecting this workspace to Meta. PRD §7 (sender numbers) and
 * Appendix B (onboarding runbook).
 *
 * A token is written encrypted (§19) and never returned. Every read path
 * returns a mask so an operator can confirm *which* token is stored without
 * the value being recoverable from the dashboard.
 */
const settings = new Hono();

settings.get("/sender-numbers", async (c) => {
  const { clientId } = c.get("tenant");
  return c.json(
    await withTenant(clientId, async (tx) => {
      const rows = await tx
        .select({
          id: senderNumber.id,
          metaPhoneNumberId: senderNumber.metaPhoneNumberId,
          displayPhoneNumber: senderNumber.displayPhoneNumber,
          displayName: senderNumber.displayName,
          qualityRating: senderNumber.qualityRating,
          registrationStatus: senderNumber.registrationStatus,
          connectionStatus: senderNumber.connectionStatus,
          throughputMps: senderNumber.throughputMps,
          wabaId: whatsappBusinessAccount.metaWabaId,
          wabaName: whatsappBusinessAccount.name,
        })
        .from(senderNumber)
        .leftJoin(
          whatsappBusinessAccount,
          eq(whatsappBusinessAccount.id, senderNumber.whatsappBusinessAccountId),
        )
        .where(eq(senderNumber.clientId, clientId));

      // Report whether a usable credential exists, without exposing it.
      const withTokens = [];
      for (const row of rows) {
        const [tok] = await tx
          .select({ id: accessToken.id, label: accessToken.label, revokedAt: accessToken.revokedAt })
          .from(accessToken)
          .where(and(eq(accessToken.scope, "phone_number"), eq(accessToken.targetId, row.id)))
          .orderBy(desc(accessToken.createdAt))
          .limit(1);
        withTokens.push({
          ...row,
          hasToken: !!tok && !tok.revokedAt,
          tokenLabel: tok?.label ?? null,
        });
      }
      return { senderNumbers: withTokens, systemTokenConfigured: !!process.env.META_SYSTEM_USER_TOKEN };
    }),
  );
});

/**
 * Registers a WhatsApp sender number against this workspace. The three ids
 * come straight out of Meta's dashboard once the number is registered
 * there — this does not create anything at Meta, it records what exists.
 */
settings.post("/sender-numbers", requirePermission("add_whatsapp_number"), async (c) => {
  const { clientId, userId } = c.get("tenant");
  const body = await c.req.json<{
    metaPhoneNumberId: string;
    displayPhoneNumber: string;
    displayName: string;
    metaWabaId: string;
    wabaName?: string;
    /** Optional per-number token. Falls back to META_SYSTEM_USER_TOKEN. */
    token?: string;
    tokenLabel?: string;
  }>();

  for (const field of ["metaPhoneNumberId", "displayPhoneNumber", "displayName", "metaWabaId"] as const) {
    if (!body[field]?.trim()) return c.json({ error: `${field} is required` }, 400);
  }

  // This is the WABA's own sender number, not a contact — CT-8's
  // mobile-only rule does not apply. Meta explicitly supports registering a
  // landline as a Cloud API sender, verified by voice call instead of SMS,
  // since it is an API endpoint rather than a handset anyone dials.
  const phone = normalisePhone(body.displayPhoneNumber, DEFAULT_REGION, false);
  if (!phone.ok) return c.json({ error: `displayPhoneNumber is not valid: ${phone.message}` }, 400);

  // The portfolio and WABA are platform-level rows shared across clients,
  // so they are created with system access rather than inside the tenant.
  const wabaRowId = await withSystemAccess(async (tx) => {
    const [portfolio] = await tx.select().from(businessPortfolio).limit(1);
    let portfolioId = portfolio?.id;
    if (!portfolioId) {
      const [created] = await tx
        .insert(businessPortfolio)
        .values({
          metaBusinessPortfolioId: process.env.META_BUSINESS_PORTFOLIO_ID ?? "unknown",
          displayName: "Cyberlative IT Solutions",
          businessVerificationStatus: "verified",
        })
        .returning({ id: businessPortfolio.id });
      portfolioId = created.id;
    }

    const [existing] = await tx
      .select({ id: whatsappBusinessAccount.id })
      .from(whatsappBusinessAccount)
      .where(eq(whatsappBusinessAccount.metaWabaId, body.metaWabaId.trim()))
      .limit(1);
    if (existing) return existing.id;

    const [created] = await tx
      .insert(whatsappBusinessAccount)
      .values({
        metaWabaId: body.metaWabaId.trim(),
        name: body.wabaName?.trim() || body.displayName.trim(),
        businessPortfolioId: portfolioId,
      })
      .returning({ id: whatsappBusinessAccount.id });
    return created.id;
  });

  try {
    const row = await withTenant(clientId, async (tx) => {
      const [created] = await tx
        .insert(senderNumber)
        .values({
          clientId,
          metaPhoneNumberId: body.metaPhoneNumberId.trim(),
          whatsappBusinessAccountId: wabaRowId,
          displayPhoneNumber: phone.e164,
          displayName: body.displayName.trim(),
          registrationStatus: "registered",
          dataLocalizationRegion: phone.countryCode === "IN" ? "IN" : null,
        })
        .returning();

      if (body.token?.trim()) {
        const { value, keyVersion } = encryptToken(body.token.trim());
        await tx.insert(accessToken).values({
          scope: "phone_number",
          targetId: created.id,
          encryptedTokenValue: value,
          keyVersion,
          label: body.tokenLabel ?? `Token for ${created.displayPhoneNumber}`,
        });
        // The same credential is used to read templates off the WABA.
        await tx.insert(accessToken).values({
          scope: "waba",
          targetId: wabaRowId,
          encryptedTokenValue: value,
          keyVersion,
          label: body.tokenLabel ?? `WABA token`,
        });
        await writeAuditLog(tx, {
          clientId,
          actorUserId: userId,
          action: "sender_token_stored",
          entityType: "sender_number",
          entityId: created.id,
        });
      }
      return created;
    });

    return c.json({ senderNumber: { ...row, tokenPreview: body.token ? maskToken(body.token) : null } }, 201);
  } catch (err: any) {
    // Drizzle wraps the driver error (`Failed query: insert into ...` as
    // .message) with the real PostgresError on .cause — matching on the
    // wrapper's message here would never see the constraint name.
    const cause = err?.cause ?? err;
    if (cause?.code === "23505" && cause?.constraint_name === "sender_number_meta_phone_id_unique") {
      return c.json({ error: "This Meta phone number id is already registered." }, 409);
    }
    throw err;
  }
});

/** Replaces the stored token for a sender number. */
settings.post("/sender-numbers/:id/token", requirePermission("add_whatsapp_number"), async (c) => {
  const { clientId, userId } = c.get("tenant");
  const id = c.req.param("id");
  const body = await c.req.json<{ token: string; label?: string }>();
  if (!body.token?.trim()) return c.json({ error: "token is required" }, 400);

  const ok = await withTenant(clientId, async (tx) => {
    const [sender] = await tx
      .select({ id: senderNumber.id, wabaId: senderNumber.whatsappBusinessAccountId })
      .from(senderNumber)
      .where(eq(senderNumber.id, id))
      .limit(1);
    if (!sender) return false;

    const { value, keyVersion } = encryptToken(body.token.trim());
    // Revoke rather than delete — §19 wants the history of which
    // credential was in force when.
    await tx
      .update(accessToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(accessToken.scope, "phone_number"), eq(accessToken.targetId, id)));
    await tx.insert(accessToken).values({
      scope: "phone_number",
      targetId: id,
      encryptedTokenValue: value,
      keyVersion,
      label: body.label ?? "Rotated token",
    });
    await tx
      .update(accessToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(accessToken.scope, "waba"), eq(accessToken.targetId, sender.wabaId)));
    await tx.insert(accessToken).values({
      scope: "waba",
      targetId: sender.wabaId,
      encryptedTokenValue: value,
      keyVersion,
      label: body.label ?? "Rotated WABA token",
    });
    await writeAuditLog(tx, {
      clientId,
      actorUserId: userId,
      action: "sender_token_rotated",
      entityType: "sender_number",
      entityId: id,
    });
    return true;
  });

  if (!ok) return c.json({ error: "Sender number not found" }, 404);
  return c.json({ updated: true, preview: maskToken(body.token) });
});

export default settings;
