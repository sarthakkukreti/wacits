import { Worker, UnrecoverableError } from "bullmq";
import { createRedisConnection, type SendJobData } from "@wacits/queue";
import { and, eq, sql } from "drizzle-orm";
import {
  accessToken,
  campaign,
  campaignRecipient,
  consentRecord,
  contact,
  conversation,
  message,
  senderNumber,
  suppressionEntry,
  template,
  templateVersion,
  withSystemAccess,
} from "@wacits/db";
import {
  createLogger,
  decryptToken,
  MetaApiError,
  MetaTransportError,
  sendTemplateMessage,
  toWhatsAppId,
  type TemplateComponent,
} from "@wacits/shared";
import { classifyError } from "./lib/error-classification";
import { startWorkerHealthServer } from "./lib/health";

const log = createLogger("send-worker");

/**
 * PRD §13 Sending engine — drains the send queue, calls Meta, records the
 * result, and reacts to a failure according to its CLASS rather than a
 * hardcoded switch on the code (APP-2/DM-27).
 *
 * The rules that matter here:
 *
 *  - AR-16: never resend. A row that has left `pending`/`queued` is done;
 *    a repeat job is BullMQ's at-least-once delivery, not a retry request.
 *  - DM-27: (api_surface, code) is the key into error_code_classification.
 *    The same numeric code means different things on different endpoints.
 *  - DM-22: error 131026 is EVIDENCE that a number is undeliverable, never
 *    proof. It accumulates strikes and can only ever reach `suspect`.
 *  - 131050 (user opted out) writes to the global suppression list
 *    immediately — a legal obligation, not a preference.
 */

/**
 * Builds the template `components` array from the campaign's parameter
 * mapping and this contact's own fields.
 *
 * Placeholders are written {{firstName}} and resolved per recipient;
 * anything else passes through as a literal. A missing value becomes an
 * empty string rather than the literal text "{{firstName}}" — the failure
 * mode people actually see in badly built blasts.
 */
export function buildComponents(
  parameterMapping: Record<string, string> | null | undefined,
  person: { firstName: string | null; lastName: string | null; organization: string | null; city: string | null },
): TemplateComponent[] {
  if (!parameterMapping || !Object.keys(parameterMapping).length) return [];

  const substitutions: Record<string, string> = {
    firstName: person.firstName ?? "",
    lastName: person.lastName ?? "",
    fullName: [person.firstName, person.lastName].filter(Boolean).join(" "),
    organization: person.organization ?? "",
    city: person.city ?? "",
  };

  const indices = Object.keys(parameterMapping)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b));

  if (!indices.length) return [];

  const parameters = indices.map((index) => {
    const spec = parameterMapping[index] ?? "";
    const resolved = spec.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => substitutions[key] ?? "");
    return { type: "text" as const, text: resolved };
  });

  return [{ type: "body", parameters }];
}

const worker = new Worker<SendJobData>(
  "send",
  async (job) => {
    const { campaignRecipientId, correlationId } = job.data;
    const jobLog = log.child({ correlationId, campaignRecipientId });

    await withSystemAccess(async (tx) => {
      const [row] = await tx
        .select({
          recipient: campaignRecipient,
          contact: contact,
          campaignState: campaign.state,
          senderNumberId: campaign.senderNumberId,
          templateName: template.name,
          templateLanguage: templateVersion.language,
        })
        .from(campaignRecipient)
        .innerJoin(contact, eq(contact.id, campaignRecipient.contactId))
        .innerJoin(campaign, eq(campaign.id, campaignRecipient.campaignId))
        .innerJoin(templateVersion, eq(templateVersion.id, campaignRecipient.templateVersionId))
        .innerJoin(template, eq(template.id, templateVersion.templateId))
        .where(eq(campaignRecipient.id, campaignRecipientId))
        .limit(1);

      if (!row) {
        jobLog.warn("campaign_recipient not found — skipping");
        return;
      }

      const recipient = row.recipient;

      // AR-16: never resend.
      if (recipient.state !== "pending" && recipient.state !== "queued") {
        jobLog.info({ state: recipient.state }, "already resolved — no-op");
        return;
      }

      // A campaign paused or cancelled after this job was enqueued must not
      // keep sending. Checked here, not only at launch, because the queue
      // may hold tens of thousands of jobs behind this one.
      if (row.campaignState === "paused" || row.campaignState === "cancelled") {
        await tx
          .update(campaignRecipient)
          .set({ state: "skipped", skipReason: `campaign_${row.campaignState}` })
          .where(eq(campaignRecipient.id, recipient.id));
        return;
      }

      // Late suppression check: someone may have opted out between the
      // audience snapshot and this job running.
      const [suppressed] = await tx
        .select({ id: suppressionEntry.id })
        .from(suppressionEntry)
        .where(eq(suppressionEntry.phoneNumber, row.contact.phoneNumber))
        .limit(1);

      if (suppressed) {
        await tx
          .update(campaignRecipient)
          .set({ state: "skipped", skipReason: "suppressed" })
          .where(eq(campaignRecipient.id, recipient.id));
        return;
      }

      const [sender] = await tx.select().from(senderNumber).where(eq(senderNumber.id, row.senderNumberId)).limit(1);
      if (!sender) throw new UnrecoverableError(`Sender number ${row.senderNumberId} no longer exists.`);

      const [tokenRow] = await tx
        .select()
        .from(accessToken)
        .where(and(eq(accessToken.scope, "phone_number"), eq(accessToken.targetId, sender.id)))
        .limit(1);

      const token =
        tokenRow && !tokenRow.revokedAt
          ? decryptToken(tokenRow.encryptedTokenValue)
          : process.env.META_SYSTEM_USER_TOKEN;

      if (!token) throw new UnrecoverableError("No Meta access token available for this sender number.");

      await tx
        .update(campaignRecipient)
        .set({
          state: "queued",
          firstQueuedAt: recipient.firstQueuedAt ?? new Date(),
          lastAttemptAt: new Date(),
        })
        .where(eq(campaignRecipient.id, recipient.id));

      try {
        const result = await sendTemplateMessage({
          phoneNumberId: sender.metaPhoneNumberId,
          token,
          toWaId: toWhatsAppId(row.contact.phoneNumber),
          templateName: row.templateName,
          languageCode: row.templateLanguage,
          components: buildComponents(recipient.resolvedParameterValues as any, row.contact),
          // AR-14: echoed back on every status webhook, so a status can be
          // matched to this outbox row even before the wamid is known.
          bizOpaqueCallbackData: recipient.sendId,
        });

        // AR-15: 'accepted', never straight to 'sent'. Meta has taken the
        // message; whether it was delivered is what the status webhook
        // tells us later.
        await tx
          .update(campaignRecipient)
          .set({ state: "accepted", messageId: result.wamid, errorCode: null })
          .where(eq(campaignRecipient.id, recipient.id));

        // Mirror into the conversation thread so campaign sends appear in
        // the inbox alongside one-to-one messages.
        const [convo] = await tx
          .insert(conversation)
          .values({
            clientId: recipient.clientId,
            senderNumberId: sender.id,
            contactId: row.contact.id,
            state: "open",
            lastOutboundAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [conversation.senderNumberId, conversation.contactId],
            set: { lastOutboundAt: new Date() },
          })
          .returning({ id: conversation.id });

        await tx.insert(message).values({
          clientId: recipient.clientId,
          senderNumberId: sender.id,
          contactId: row.contact.id,
          conversationId: convo.id,
          direction: "outbound",
          wamid: result.wamid,
          sendId: recipient.sendId,
          campaignRecipientId: recipient.id,
          templateVersionId: recipient.templateVersionId,
          type: "template",
          contentOrTemplateRef: { template: row.templateName, language: row.templateLanguage },
          currentStatus: "sent",
          currentStatusRank: 1,
          sentAt: new Date(),
        });

        await tx
          .update(campaign)
          .set({
            countSent: sql`${campaign.countSent} + 1`,
            countAccepted: sql`${campaign.countAccepted} + 1`,
          })
          .where(eq(campaign.id, recipient.campaignId));

        await tx
          .update(contact)
          .set({
            lastOutboundAt: new Date(),
            lifetimeMessageCount: sql`${contact.lifetimeMessageCount} + 1`,
          })
          .where(eq(contact.id, row.contact.id));
      } catch (err) {
        // Transport failures always deserve a retry and carry no Meta code.
        if (err instanceof MetaTransportError) {
          await tx
            .update(campaignRecipient)
            .set({ state: "pending", errorCode: "transport" })
            .where(eq(campaignRecipient.id, recipient.id));
          throw err; // let BullMQ's backoff handle it
        }

        if (!(err instanceof MetaApiError)) throw err;

        const { code, apiSurface } = err.detail;
        const classification = await classifyError(tx, apiSurface, code);

        jobLog.warn({ apiSurface, code, errorClass: classification.errorClass, title: classification.title }, "send failed");

        if (classification.errorClass === "RETRY_BACKOFF") {
          await tx
            .update(campaignRecipient)
            .set({ state: "pending", errorCode: code })
            .where(eq(campaignRecipient.id, recipient.id));
          throw err; // BullMQ retries with exponential backoff
        }

        await tx
          .update(campaignRecipient)
          .set({ state: "failed", errorCode: code })
          .where(eq(campaignRecipient.id, recipient.id));

        await tx
          .update(campaign)
          .set({ countFailed: sql`${campaign.countFailed} + 1` })
          .where(eq(campaign.id, recipient.campaignId));

        // 131050 — the person opted out at Meta. Suppress globally and
        // record the evidence; this is a compliance duty (§10/§20).
        if (code === "131050") {
          await tx
            .insert(suppressionEntry)
            .values({
              phoneNumber: row.contact.phoneNumber,
              reason: "Meta error 131050 — user opted out of marketing from this business",
              source: "meta_error_131050",
              originatingClientId: recipient.clientId,
            })
            .onConflictDoUpdate({
              target: suppressionEntry.phoneNumber,
              set: { lastReconfirmedAt: new Date() },
            });

          await tx.insert(consentRecord).values({
            clientId: recipient.clientId,
            contactId: row.contact.id,
            phoneNumberAsRecorded: row.contact.phoneNumber,
            direction: "opt_out",
            category: "marketing",
            sourceType: "error_131050",
            sourceReference: `campaign:${recipient.campaignId}`,
          });

          await tx
            .update(contact)
            .set({ marketingConsentState: "opted_out", updatedAt: new Date() })
            .where(eq(contact.id, row.contact.id));
        }

        // DM-22 — 131026 is evidence, not proof. Accumulate a strike; only
        // ever reach `suspect`. `invalid` is reserved for numbers that fail
        // syntactic validation, which this one did not.
        if (classification.countsToward131026) {
          const nextCount = (row.contact.strike131026Count ?? 0) + 1;
          const reachedThreshold = nextCount >= 3;
          await tx
            .update(contact)
            .set({
              strike131026Count: nextCount,
              deliverabilityState: reachedThreshold ? "suspect" : row.contact.deliverabilityState,
              deliverabilityChangedAt: reachedThreshold ? new Date() : row.contact.deliverabilityChangedAt,
              updatedAt: new Date(),
            })
            .where(eq(contact.id, row.contact.id));
        }

        // 135000 — portfolio pacing dropped the remaining queue (§2.9). The
        // campaign was not partially failed, it was stopped by Meta.
        if (code === "135000") {
          await tx
            .update(campaign)
            .set({
              state: "stopped_by_meta",
              stopReason: "Portfolio pacing dropped the remaining queue (135000)",
              stateChangedAt: new Date(),
            })
            .where(eq(campaign.id, recipient.campaignId));
        }

        if (classification.errorClass === "OPERATIONAL_ALERT") {
          // These block ALL sending, not just this message — pause so an
          // operator sees one alert rather than thousands of failures.
          await tx
            .update(campaign)
            .set({
              state: "paused",
              pauseReason: `${code}: ${classification.title}`,
              stateChangedAt: new Date(),
            })
            .where(eq(campaign.id, recipient.campaignId));
        }
      }
    });
  },
  {
    connection: createRedisConnection(),
    prefix: process.env.QUEUE_PREFIX ?? "wacits",
    // Meta's per-number default throughput is 80 msg/s and the real ceiling
    // lives on sender_number.throughput_mps. Stay well under it: being
    // rate-limited (130429) costs more than sending slightly slower.
    concurrency: Number(process.env.SEND_CONCURRENCY ?? 8),
    limiter: { max: Number(process.env.SEND_RATE_MAX ?? 20), duration: 1000 },
  },
);

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, correlationId: job?.data?.correlationId, err: err.message }, "job failed");
});

startWorkerHealthServer(Number(process.env.SEND_WORKER_PORT ?? 8790), worker);
log.info("send worker running");
