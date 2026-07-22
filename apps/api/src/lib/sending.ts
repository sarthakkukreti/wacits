import { and, desc, eq, sql } from "drizzle-orm";
import {
  accessToken,
  contact,
  conversation,
  customerServiceWindow,
  message,
  senderNumber,
  suppressionEntry,
} from "@wacits/db";
import {
  decryptToken,
  MetaApiError,
  MetaTransportError,
  sendTemplateMessage,
  sendTextMessage,
  toWhatsAppId,
  type TemplateComponent,
} from "@wacits/shared";

/**
 * PRD §13/§14 — the shared send path used by both the inbox (one-to-one)
 * and the campaign worker. Everything that must be true of *every* outbound
 * message lives here exactly once: suppression check, 24-hour window rule,
 * conversation upsert, message row, status seeding.
 */

export type Tx = any;

// ---------------------------------------------------------------------------
// Sender number + credential resolution
// ---------------------------------------------------------------------------

export type ResolvedSender = {
  senderNumberId: string;
  metaPhoneNumberId: string;
  displayPhoneNumber: string;
  displayName: string;
  token: string;
};

/**
 * Resolves the sender number a client sends from, plus a usable Meta token.
 *
 * Token precedence: a per-number token in `access_token` wins, because that
 * is the credential model the PRD specifies (§21.2 — per-client tokens,
 * encrypted at rest). META_SYSTEM_USER_TOKEN is the documented fallback for
 * the single-portfolio phase CITS is in today (Appendix B), where one
 * system user token covers every number in the portfolio.
 */
export async function resolveSender(tx: Tx, clientId: string, senderNumberId?: string): Promise<ResolvedSender> {
  const rows = await tx
    .select()
    .from(senderNumber)
    .where(
      senderNumberId
        ? and(eq(senderNumber.clientId, clientId), eq(senderNumber.id, senderNumberId))
        : eq(senderNumber.clientId, clientId),
    )
    .orderBy(desc(senderNumber.createdAt))
    .limit(1);

  const sender = rows[0];
  if (!sender) {
    throw new SendBlockedError(
      "no_sender_number",
      "This workspace has no WhatsApp sender number yet. Register a number in Meta and add it under Settings before sending.",
    );
  }

  const [tokenRow] = await tx
    .select()
    .from(accessToken)
    .where(and(eq(accessToken.scope, "phone_number"), eq(accessToken.targetId, sender.id)))
    .orderBy(desc(accessToken.createdAt))
    .limit(1);

  let token: string | undefined;
  if (tokenRow && !tokenRow.revokedAt) {
    token = decryptToken(tokenRow.encryptedTokenValue);
  } else {
    token = process.env.META_SYSTEM_USER_TOKEN;
  }

  if (!token) {
    throw new SendBlockedError(
      "no_token",
      "No Meta access token is configured for this sender number. Add one under Settings, or set META_SYSTEM_USER_TOKEN.",
    );
  }

  return {
    senderNumberId: sender.id,
    metaPhoneNumberId: sender.metaPhoneNumberId,
    displayPhoneNumber: sender.displayPhoneNumber,
    displayName: sender.displayName,
    token,
  };
}

/** A refusal to send that is expected and explainable to an operator —
 *  as opposed to an unexpected crash. Carries a machine-readable reason so
 *  the caller can record it on the outbox row (`skip_reason`). */
export class SendBlockedError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "SendBlockedError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Pre-send gates
// ---------------------------------------------------------------------------

/**
 * PRD §10 / §21.7 — the suppression list is deliberately global, not
 * client-scoped: the duty not to contact someone is owed to the person, not
 * to one workspace. Checked before every single send, campaign or not.
 */
export async function isSuppressed(tx: Tx, phoneNumber: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: suppressionEntry.id })
    .from(suppressionEntry)
    .where(eq(suppressionEntry.phoneNumber, phoneNumber))
    .limit(1);
  return !!row;
}

export type ServiceWindow = { open: boolean; expiresAt: Date | null };

/**
 * PRD §14 — free-form (non-template) messages are only permitted inside the
 * 24-hour customer service window, which an inbound message from the
 * contact opens. Outside it, Meta rejects with 131047 and the message is
 * simply not delivered, so the UI must know this *before* offering a
 * free-text composer.
 */
export async function getServiceWindow(
  tx: Tx,
  clientId: string,
  senderNumberId: string,
  contactId: string,
): Promise<ServiceWindow> {
  const [row] = await tx
    .select()
    .from(customerServiceWindow)
    .where(
      and(
        eq(customerServiceWindow.clientId, clientId),
        eq(customerServiceWindow.senderNumberId, senderNumberId),
        eq(customerServiceWindow.contactId, contactId),
      ),
    )
    .limit(1);

  if (!row) return { open: false, expiresAt: null };
  return { open: row.expiresAt.getTime() > Date.now(), expiresAt: row.expiresAt };
}

// ---------------------------------------------------------------------------
// Conversation + message persistence
// ---------------------------------------------------------------------------

export async function ensureConversation(
  tx: Tx,
  clientId: string,
  senderNumberId: string,
  contactId: string,
): Promise<string> {
  const [existing] = await tx
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.senderNumberId, senderNumberId), eq(conversation.contactId, contactId)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await tx
    .insert(conversation)
    .values({ clientId, senderNumberId, contactId, state: "open" })
    .onConflictDoNothing({ target: [conversation.senderNumberId, conversation.contactId] })
    .returning({ id: conversation.id });

  if (created) return created.id;

  // Lost the race with a concurrent inbound webhook — re-read.
  const [raced] = await tx
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.senderNumberId, senderNumberId), eq(conversation.contactId, contactId)))
    .limit(1);
  return raced.id;
}

// ---------------------------------------------------------------------------
// The send itself
// ---------------------------------------------------------------------------

export type OutboundRequest = {
  clientId: string;
  contactId: string;
  contactPhone: string;
  sender: ResolvedSender;
  /** Free-form text, only valid inside an open service window. */
  text?: string;
  /** Template send — always valid, and the only option outside the window. */
  template?: {
    name: string;
    languageCode: string;
    components?: TemplateComponent[];
    templateVersionId?: string;
  };
  campaignRecipientId?: string;
  sendId?: string;
};

export type OutboundResult =
  | { ok: true; messageId: string; wamid: string }
  | { ok: false; blocked: true; reason: string; detail: string }
  | { ok: false; blocked: false; errorCode: string; apiSurface: string; detail: string };

/**
 * Sends one message and records it. Returns a discriminated result rather
 * than throwing for expected refusals (suppression, closed window, Meta
 * rejection), because every one of those is something an operator needs
 * shown in the UI, not a 500.
 */
export async function sendOutbound(tx: Tx, req: OutboundRequest): Promise<OutboundResult> {
  const { clientId, contactId, contactPhone, sender } = req;

  if (await isSuppressed(tx, contactPhone)) {
    return {
      ok: false,
      blocked: true,
      reason: "suppressed",
      detail: "This number is on the opt-out (suppression) list and must not be contacted.",
    };
  }

  if (req.text && !req.template) {
    const window = await getServiceWindow(tx, clientId, sender.senderNumberId, contactId);
    if (!window.open) {
      return {
        ok: false,
        blocked: true,
        reason: "window_closed",
        detail:
          "The 24-hour customer service window is closed for this contact. WhatsApp only allows a free-text reply within 24 hours of their last message — send an approved template instead.",
      };
    }
  }

  const conversationId = await ensureConversation(tx, clientId, sender.senderNumberId, contactId);
  const sendId = req.sendId ?? crypto.randomUUID();

  let result: { wamid: string };
  try {
    if (req.template) {
      result = await sendTemplateMessage({
        phoneNumberId: sender.metaPhoneNumberId,
        token: sender.token,
        toWaId: toWhatsAppId(contactPhone),
        templateName: req.template.name,
        languageCode: req.template.languageCode,
        components: req.template.components,
        bizOpaqueCallbackData: sendId,
      });
    } else if (req.text) {
      result = await sendTextMessage({
        phoneNumberId: sender.metaPhoneNumberId,
        token: sender.token,
        toWaId: toWhatsAppId(contactPhone),
        body: req.text,
        bizOpaqueCallbackData: sendId,
      });
    } else {
      throw new Error("sendOutbound requires either `text` or `template`.");
    }
  } catch (err) {
    if (err instanceof MetaApiError) {
      return {
        ok: false,
        blocked: false,
        errorCode: err.detail.code,
        apiSurface: err.detail.apiSurface,
        detail: err.detail.details ?? err.detail.message ?? err.message,
      };
    }
    if (err instanceof MetaTransportError) {
      return { ok: false, blocked: false, errorCode: "transport", apiSurface: "/messages", detail: err.message };
    }
    throw err;
  }

  // AR-15: record the wamid Meta returned. `sent` is seeded here as rank 1;
  // delivered/read arrive later on the status webhook and only ever move
  // the status forward (DM-7).
  const [row] = await tx
    .insert(message)
    .values({
      clientId,
      senderNumberId: sender.senderNumberId,
      contactId,
      conversationId,
      direction: "outbound",
      wamid: result.wamid,
      sendId,
      campaignRecipientId: req.campaignRecipientId ?? null,
      type: req.template ? "template" : "text",
      contentOrTemplateRef: req.template
        ? { template: req.template.name, language: req.template.languageCode, components: req.template.components ?? [] }
        : { body: req.text },
      templateVersionId: req.template?.templateVersionId ?? null,
      currentStatus: "sent",
      currentStatusRank: 1,
      sentAt: new Date(),
    })
    .returning({ id: message.id });

  const now = new Date();
  await tx.update(conversation).set({ lastOutboundAt: now }).where(eq(conversation.id, conversationId));
  await tx
    .update(contact)
    .set({ lastOutboundAt: now, lifetimeMessageCount: sql`${contact.lifetimeMessageCount} + 1` })
    .where(eq(contact.id, contactId));

  return { ok: true, messageId: row.id, wamid: result.wamid };
}
