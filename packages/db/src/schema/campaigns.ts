import { integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsCol, updatedAt, utcNow } from "./columns.helpers";
import { campaignState, recipientState, sendPath } from "./enums";
import { client, senderNumber } from "./platform";
import { templateVersion } from "./templates";
import { contact } from "./contacts";
import { user } from "./auth";
import { campaignType } from "./settings";

// PRD §21.4 campaign — one planned outbound send. Canon: exactly eleven
// states; `halted` and `blocked_by_client_status` do not exist (§12.2).
// Approval fields are non-null only once the recipient count reached the
// campaign approval threshold (DM-25).
export const campaign = pgTable("campaign", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  campaignTypeId: uuid("campaign_type_id").references(() => campaignType.id),
  senderNumberId: uuid("sender_number_id").notNull().references(() => senderNumber.id),
  templateVersionId: uuid("template_version_id").notNull().references(() => templateVersion.id),
  sendPath: sendPath("send_path").notNull().default("cloud_api"),
  optimisationSpec: jsonb("optimisation_spec"), // nullable — reserved for MM Lite max-price bidding
  scheduledAt: tsCol("scheduled_at"),
  state: campaignState("state").notNull().default("draft"),
  stateChangedAt: tsCol("state_changed_at"),
  pauseReason: text("pause_reason"),
  stopReason: text("stop_reason"),
  // DM-25 — campaign approval workflow.
  approvalRequestedBy: uuid("approval_requested_by").references(() => user.id),
  approvalRequestedAt: tsCol("approval_requested_at"),
  approvedBy: uuid("approved_by").references(() => user.id),
  approvedAt: tsCol("approved_at"),
  approvalNote: text("approval_note"),
  typedConfirmationGivenBy: uuid("typed_confirmation_given_by").references(() => user.id),
  typedConfirmationGivenAt: tsCol("typed_confirmation_given_at"),
  countQueued: integer("count_queued").notNull().default(0),
  countAccepted: integer("count_accepted").notNull().default(0),
  countSent: integer("count_sent").notNull().default(0),
  countDelivered: integer("count_delivered").notNull().default(0),
  countRead: integer("count_read").notNull().default(0),
  countFailed: integer("count_failed").notNull().default(0),
  droppedByPacingCount: integer("dropped_by_pacing_count").notNull().default(0),
  blockedByFrequencyCapCount: integer("blocked_by_frequency_cap_count").notNull().default(0),
  costEstimate: integer("cost_estimate"), // paise
  costActual: integer("cost_actual"), // paise
  createdBy: uuid("created_by").references(() => user.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// PRD §21.4 campaign_audience_snapshot — append-only, frozen record of who
// the audience was and how it was chosen. Makes a campaign reproducible.
export const campaignAudienceSnapshot = pgTable("campaign_audience_snapshot", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => campaign.id, { onDelete: "cascade" }),
  filterDefinition: jsonb("filter_definition"),
  groupIds: jsonb("group_ids").notNull().default([]),
  savedSegmentIds: jsonb("saved_segment_ids").notNull().default([]),
  resolvedContactCount: integer("resolved_contact_count").notNull(),
  suppressedCount: integer("suppressed_count").notNull().default(0),
  frequencyCappedCount: integer("frequency_capped_count").notNull().default(0),
  snapshotTakenAt: utcNow("snapshot_taken_at"),
});

// PRD §21.4 campaign_recipient — one intended send. Doubles as the send
// outbox. Unique on (campaign, contact, template_version, attempt_key) —
// the only structural defence against double-sending (AR-13). Uses the
// immutable template VERSION id, never the mutable template id.
export const campaignRecipient = pgTable(
  "campaign_recipient",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaign.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contact.id),
    templateVersionId: uuid("template_version_id").notNull().references(() => templateVersion.id),
    // AR-13a / DM-24: integer starting at 1, incremented only by an explicit
    // operator-initiated retry. Automatic retries reuse the same value.
    attemptKey: integer("attempt_key").notNull().default(1),
    resolvedParameterValues: jsonb("resolved_parameter_values").notNull().default({}),
    state: recipientState("state").notNull().default("pending"),
    skipReason: text("skip_reason"),
    errorCode: text("error_code"),
    messageId: text("message_id"), // wamid, once known
    sendId: text("send_id").notNull(), // used as biz_opaque_callback_data
    firstQueuedAt: tsCol("first_queued_at"),
    lastAttemptAt: tsCol("last_attempt_at"),
  },
  (t) => [
    unique("campaign_recipient_outbox_unique").on(
      t.campaignId,
      t.contactId,
      t.templateVersionId,
      t.attemptKey,
    ),
    unique("campaign_recipient_send_id_unique").on(t.sendId),
  ],
);
