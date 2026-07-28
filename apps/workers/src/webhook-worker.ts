import { Worker } from "bullmq";
import { createRedisConnection, type WebhookJobData } from "@wacits/queue";
import { and, eq, sql } from "drizzle-orm";
import {
  campaign,
  campaignRecipient,
  consentRecord,
  contact,
  conversation,
  customerServiceWindow,
  message,
  messageStatusEvent,
  optOutKeyword,
  senderNumber,
  suppressionEntry,
  webhookEvent,
  withSystemAccess,
} from "@wacits/db";
import { createHash } from "node:crypto";
import { fromWhatsAppId } from "@wacits/shared";
import { classifyError } from "./lib/error-classification";

/**
 * PRD §4.2 (b)/(c), §14 — interprets the raw webhook payloads the receiver
 * persisted. Kept off the request path so Meta always gets its fast 200
 * (AR-4) and so a bug here can be fixed and the events REPROCESSED from the
 * stored raw bytes rather than lost.
 *
 * Two payload shapes matter:
 *
 *   messages[]  — someone replied. Creates the contact if unknown, opens
 *                 the 24-hour customer service window, and (per §10)
 *                 honours opt-out keywords like STOP.
 *   statuses[]  — delivery receipts. Append-only, deduped on (wamid,
 *                 status) per DM-11, and only ever moves a message's status
 *                 FORWARD by rank (DM-7) — a late 'sent' must never
 *                 overwrite an already-recorded 'read'.
 */

/** DM-7 — monotonic rank. A status can only move a message up this ladder. */
const STATUS_RANK: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  played: 4,
  failed: 5,
};

async function resolveSenderByPhoneNumberId(tx: any, metaPhoneNumberId: string) {
  const [row] = await tx
    .select()
    .from(senderNumber)
    .where(eq(senderNumber.metaPhoneNumberId, metaPhoneNumberId))
    .limit(1);
  return row ?? null;
}

/** Extracts something displayable from any inbound message type. */
function describeInbound(msg: any): { type: string; content: Record<string, unknown> } {
  const type = msg.type ?? "unknown";
  switch (type) {
    case "text":
      return { type, content: { body: msg.text?.body ?? "" } };
    case "button":
      return { type, content: { body: msg.button?.text ?? "", payload: msg.button?.payload } };
    case "interactive": {
      const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
      return { type, content: { body: reply?.title ?? "", payload: reply?.id } };
    }
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker":
      return {
        type,
        content: { mediaId: msg[type]?.id, mimeType: msg[type]?.mime_type, caption: msg[type]?.caption ?? null },
      };
    case "location":
      return { type, content: { latitude: msg.location?.latitude, longitude: msg.location?.longitude } };
    case "reaction":
      return { type, content: { emoji: msg.reaction?.emoji, targetWamid: msg.reaction?.message_id } };
    default:
      return { type, content: { raw: msg[type] ?? null } };
  }
}

/** §10 — an inbound "STOP" is a withdrawal of consent and must be honoured
 *  immediately, not at the next campaign build. */
async function handleOptOutKeyword(
  tx: any,
  clientId: string,
  contactRow: { id: string; phoneNumber: string },
  bodyText: string,
): Promise<boolean> {
  const normalised = bodyText.trim().toLowerCase().replace(/[^a-z\s']/g, "");
  if (!normalised) return false;

  const keywords = await tx.select().from(optOutKeyword).where(eq(optOutKeyword.clientId, clientId));

  const matched = keywords.find((k: any) => k.active && normalised === k.keyword.toLowerCase());
  if (!matched) return false;

  if (matched.direction === "opt_out") {
    await tx
      .insert(suppressionEntry)
      .values({
        phoneNumber: contactRow.phoneNumber,
        reason: `Inbound opt-out keyword: "${matched.keyword}"`,
        source: "inbound_reply",
        originatingClientId: clientId,
      })
      .onConflictDoUpdate({ target: suppressionEntry.phoneNumber, set: { lastReconfirmedAt: new Date() } });

    await tx.insert(consentRecord).values({
      clientId,
      contactId: contactRow.id,
      phoneNumberAsRecorded: contactRow.phoneNumber,
      direction: "opt_out",
      category: "all",
      sourceType: "inbound_reply",
      sourceReference: bodyText.slice(0, 200),
    });

    await tx
      .update(contact)
      .set({ marketingConsentState: "opted_out", updatedAt: new Date() })
      .where(eq(contact.id, contactRow.id));
    return true;
  }

  // Opt back in — remove the suppression and record the evidence.
  await tx.delete(suppressionEntry).where(eq(suppressionEntry.phoneNumber, contactRow.phoneNumber));
  await tx.insert(consentRecord).values({
    clientId,
    contactId: contactRow.id,
    phoneNumberAsRecorded: contactRow.phoneNumber,
    direction: "opt_in",
    category: "marketing",
    sourceType: "inbound_reply",
    sourceReference: bodyText.slice(0, 200),
  });
  await tx
    .update(contact)
    .set({ marketingConsentState: "opted_in", updatedAt: new Date() })
    .where(eq(contact.id, contactRow.id));
  return true;
}

async function processInboundMessages(tx: any, value: any) {
  const metaPhoneNumberId = value?.metadata?.phone_number_id;
  if (!metaPhoneNumberId) return;

  const sender = await resolveSenderByPhoneNumberId(tx, metaPhoneNumberId);
  if (!sender) {
    console.warn(`[webhook-worker] inbound for unknown phone_number_id ${metaPhoneNumberId} — ignoring.`);
    return;
  }

  const clientId = sender.clientId;
  const profiles: Record<string, string> = {};
  for (const c of value.contacts ?? []) {
    if (c?.wa_id) profiles[c.wa_id] = c?.profile?.name ?? "";
  }

  for (const msg of value.messages ?? []) {
    const phoneNumber = fromWhatsAppId(msg.from);

    // Find or create the contact. An inbound message from a number we have
    // never seen is a lead, not an error — capture it.
    let [contactRow] = await tx
      .select()
      .from(contact)
      .where(and(eq(contact.clientId, clientId), eq(contact.phoneNumber, phoneNumber)))
      .limit(1);

    if (!contactRow) {
      const profileName = profiles[msg.from]?.trim();
      const [created] = await tx
        .insert(contact)
        .values({
          clientId,
          phoneNumber,
          rawPhoneInput: msg.from,
          firstName: profileName ? profileName.split(/\s+/)[0] : null,
          lastName: profileName && profileName.includes(" ") ? profileName.split(/\s+/).slice(1).join(" ") : null,
          source: "inbound_message",
          // They messaged us, so the number provably works — this is the
          // one place `deliverable` can be asserted rather than inferred.
          deliverabilityState: "deliverable",
          deliverabilityChangedAt: new Date(),
        })
        .onConflictDoNothing({ target: [contact.clientId, contact.phoneNumber] })
        .returning();

      contactRow =
        created ??
        (
          await tx
            .select()
            .from(contact)
            .where(and(eq(contact.clientId, clientId), eq(contact.phoneNumber, phoneNumber)))
            .limit(1)
        )[0];
    } else if (contactRow.deliverabilityState !== "deliverable") {
      // Proof of life: they just messaged us, so any earlier `suspect`
      // verdict from 131026 strikes is now known to be wrong.
      await tx
        .update(contact)
        .set({
          deliverabilityState: "deliverable",
          deliverabilityChangedAt: new Date(),
          strike131026Count: 0,
        })
        .where(eq(contact.id, contactRow.id));
    }

    const occurredAt = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();

    // Upsert the conversation and bump its unread counter.
    const [convo] = await tx
      .insert(conversation)
      .values({
        clientId,
        senderNumberId: sender.id,
        contactId: contactRow.id,
        state: "open",
        lastInboundAt: occurredAt,
        unreadCount: 1,
      })
      .onConflictDoUpdate({
        target: [conversation.senderNumberId, conversation.contactId],
        set: {
          lastInboundAt: occurredAt,
          unreadCount: sql`${conversation.unreadCount} + 1`,
          // An inbound message reopens a closed thread — the customer is
          // talking again, so it belongs back in the queue.
          state: "open",
        },
      })
      .returning({ id: conversation.id });

    const described = describeInbound(msg);

    // AR-10: deduped on wamid. Meta redelivers webhooks; a redelivery must
    // not double-post the message into the thread.
    await tx
      .insert(message)
      .values({
        clientId,
        senderNumberId: sender.id,
        contactId: contactRow.id,
        conversationId: convo.id,
        direction: "inbound",
        wamid: msg.id,
        type: described.type,
        contentOrTemplateRef: described.content,
        mediaReference: (described.content as any).mediaId ?? null,
        createdAt: occurredAt,
      })
      .onConflictDoNothing({ target: message.wamid });

    await tx
      .update(contact)
      .set({
        lastInboundAt: occurredAt,
        lifetimeMessageCount: sql`${contact.lifetimeMessageCount} + 1`,
      })
      .where(eq(contact.id, contactRow.id));

    // §14 — an inbound message opens (or extends) the 24-hour window in
    // which a free-form reply is permitted.
    const expiresAt = new Date(occurredAt.getTime() + 24 * 60 * 60 * 1000);
    await tx
      .insert(customerServiceWindow)
      .values({
        clientId,
        senderNumberId: sender.id,
        contactId: contactRow.id,
        openedAt: occurredAt,
        expiresAt,
        openedBy: "inbound_message",
      })
      .onConflictDoUpdate({
        target: [customerServiceWindow.senderNumberId, customerServiceWindow.contactId],
        set: { openedAt: occurredAt, expiresAt, openedBy: "inbound_message" },
      });

    if (described.type === "text" || described.type === "button" || described.type === "interactive") {
      await handleOptOutKeyword(tx, clientId, contactRow, String((described.content as any).body ?? ""));
    }
  }
}

async function processStatuses(tx: any, value: any, rawPayload: unknown) {
  const metaPhoneNumberId = value?.metadata?.phone_number_id;
  const sender = metaPhoneNumberId ? await resolveSenderByPhoneNumberId(tx, metaPhoneNumberId) : null;

  for (const status of value.statuses ?? []) {
    const wamid = status.id;
    const statusName = status.status;
    const rank = STATUS_RANK[statusName] ?? 0;
    if (!wamid || !rank) continue;

    const [msgRow] = await tx.select().from(message).where(eq(message.wamid, wamid)).limit(1);
    if (!msgRow) {
      // The status can legitimately arrive before our own INSERT commits.
      // The raw event is retained, so this is recoverable by reprocessing.
      console.warn(`[webhook-worker] status for unknown wamid ${wamid} — will be picked up on reprocess.`);
      continue;
    }

    const payloadHash = createHash("sha256").update(JSON.stringify(status)).digest("hex");
    const errorCode = status.errors?.[0]?.code ? String(status.errors[0].code) : null;

    // DM-11/AR-11: unique on (wamid, status) only — a redelivery with a
    // shifted provider timestamp is absorbed as a conflict, not a new row.
    await tx
      .insert(messageStatusEvent)
      .values({
        clientId: msgRow.clientId,
        messageId: msgRow.id,
        wamid,
        status: statusName,
        providerTimestamp: status.timestamp ? new Date(Number(status.timestamp) * 1000) : null,
        errorCode,
        apiSurface: "/messages",
        rawPayload: status,
        payloadHash,
      })
      .onConflictDoNothing({ target: [messageStatusEvent.wamid, messageStatusEvent.status] });

    // DM-7: only ever move forward. Webhooks arrive out of order and a late
    // 'sent' must never clobber a 'read' already recorded.
    if (rank > (msgRow.currentStatusRank ?? 0)) {
      await tx
        .update(message)
        .set({
          currentStatus: statusName,
          currentStatusRank: rank,
          failedErrorCode: statusName === "failed" ? errorCode : msgRow.failedErrorCode,
          pricingCategory: status.pricing?.category ?? msgRow.pricingCategory,
          billable: status.pricing?.billable !== undefined ? String(status.pricing.billable) : msgRow.billable,
        })
        .where(eq(message.id, msgRow.id));
    }

    // Keep the campaign outbox row and its counters in step.
    if (msgRow.campaignRecipientId) {
      const recipientState =
        statusName === "failed" ? "failed" : statusName === "read" ? "read" : statusName === "delivered" ? "delivered" : "sent";

      const [recipientRow] = await tx
        .select()
        .from(campaignRecipient)
        .where(eq(campaignRecipient.id, msgRow.campaignRecipientId))
        .limit(1);

      if (recipientRow) {
        const currentRank = STATUS_RANK[recipientRow.state] ?? 0;
        if (rank > currentRank) {
          await tx
            .update(campaignRecipient)
            .set({ state: recipientState as any, errorCode: errorCode ?? recipientRow.errorCode })
            .where(eq(campaignRecipient.id, recipientRow.id));

          const counterColumn =
            statusName === "delivered"
              ? { countDelivered: sql`${campaign.countDelivered} + 1` }
              : statusName === "read"
                ? { countRead: sql`${campaign.countRead} + 1` }
                : statusName === "failed"
                  ? { countFailed: sql`${campaign.countFailed} + 1` }
                  : null;

          if (counterColumn) {
            await tx.update(campaign).set(counterColumn).where(eq(campaign.id, recipientRow.campaignId));
          }
        }
      }
    }

    // A delivered message proves the number is reachable on WhatsApp — the
    // only positive signal available now that contact validation is gone.
    if (statusName === "delivered" && sender) {
      await tx
        .update(contact)
        .set({ deliverabilityState: "deliverable", deliverabilityChangedAt: new Date(), strike131026Count: 0 })
        .where(and(eq(contact.id, msgRow.contactId), sql`${contact.deliverabilityState} <> 'deliverable'`));
    }

    // send-worker.ts applies DM-22's strike-to-suspect rule when Meta
    // rejects the send synchronously, but a message just as often gets
    // accepted and THEN fails asynchronously — this status event is that
    // path, and until now it recorded failedErrorCode on the message
    // (above) without ever touching the contact. Same rule, same
    // classification table, so the two paths cannot disagree about what a
    // given code means: accumulate a strike, escalate to `suspect` only at
    // the threshold, never straight to `invalid` (that stays reserved for
    // syntactic validation per DM-22 canon).
    if (statusName === "failed" && errorCode) {
      const classification = await classifyError(tx, "/messages", errorCode);
      if (classification.countsToward131026) {
        const [contactRow] = await tx
          .select({
            strike131026Count: contact.strike131026Count,
            deliverabilityState: contact.deliverabilityState,
            deliverabilityChangedAt: contact.deliverabilityChangedAt,
          })
          .from(contact)
          .where(eq(contact.id, msgRow.contactId))
          .limit(1);

        if (contactRow) {
          const nextCount = (contactRow.strike131026Count ?? 0) + 1;
          const reachedThreshold = nextCount >= 3;
          await tx
            .update(contact)
            .set({
              strike131026Count: nextCount,
              deliverabilityState: reachedThreshold ? "suspect" : contactRow.deliverabilityState,
              deliverabilityChangedAt: reachedThreshold ? new Date() : contactRow.deliverabilityChangedAt,
              updatedAt: new Date(),
            })
            .where(eq(contact.id, msgRow.contactId));
        }
      }
    }
  }
}

const worker = new Worker<WebhookJobData>(
  "webhook",
  async (job) => {
    const { webhookEventId } = job.data;

    await withSystemAccess(async (tx) => {
      const [event] = await tx.select().from(webhookEvent).where(eq(webhookEvent.id, webhookEventId)).limit(1);
      if (!event) return;
      if (event.processingState === "processed") return; // idempotent

      let parsed: any;
      try {
        parsed = JSON.parse(event.rawBody);
      } catch {
        await tx
          .update(webhookEvent)
          .set({ processingState: "failed", lastError: "Body is not valid JSON" })
          .where(eq(webhookEvent.id, event.id));
        return;
      }

      try {
        for (const entry of parsed?.entry ?? []) {
          for (const change of entry?.changes ?? []) {
            const value = change?.value;
            if (!value) continue;

            if (value.messages?.length) await processInboundMessages(tx, value);
            if (value.statuses?.length) await processStatuses(tx, value, parsed);
          }
        }

        await tx
          .update(webhookEvent)
          .set({
            processingState: "processed",
            processingAttempts: sql`${webhookEvent.processingAttempts} + 1`,
            lastError: null,
          })
          .where(eq(webhookEvent.id, event.id));
      } catch (err) {
        await tx
          .update(webhookEvent)
          .set({
            processingState: "failed",
            processingAttempts: sql`${webhookEvent.processingAttempts} + 1`,
            lastError: String(err),
          })
          .where(eq(webhookEvent.id, event.id));
        throw err;
      }
    });
  },
  {
    connection: createRedisConnection(),
    prefix: process.env.QUEUE_PREFIX ?? "wacits",
    concurrency: Number(process.env.WEBHOOK_CONCURRENCY ?? 4),
  },
);

worker.on("failed", (job, err) => {
  console.error(`[webhook-worker] job ${job?.id} failed:`, err.message);
});

console.log("Webhook worker running.");
