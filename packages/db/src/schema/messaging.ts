import { integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsCol, utcNow } from "./columns.helpers";
import { conversationState, messageDirection, messageStatus } from "./enums";
import { client, senderNumber } from "./platform";
import { contact } from "./contacts";
import { campaignRecipient } from "./campaigns";
import { templateVersion } from "./templates";
import { user } from "./auth";

// PRD §21.4 conversation — a thread between one sender number and one
// contact. Canon: exactly two states, open/closed. No `snoozed`.
export const conversation = pgTable(
  "conversation",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    senderNumberId: uuid("sender_number_id").notNull().references(() => senderNumber.id),
    contactId: uuid("contact_id").notNull().references(() => contact.id),
    state: conversationState("state").notNull().default("open"),
    stateChangedAt: tsCol("state_changed_at"),
    stateChangedBy: uuid("state_changed_by").references(() => user.id),
    assignedUserId: uuid("assigned_user_id").references(() => user.id),
    lastInboundAt: tsCol("last_inbound_at"),
    lastOutboundAt: tsCol("last_outbound_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [unique("conversation_number_contact_unique").on(t.senderNumberId, t.contactId)],
);

export const conversationNote = pgTable("conversation_note", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => user.id),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

// PRD §21.4 customer_service_window — tracks the 24h free-form window per
// (sender number, contact) pairing. The composer reads this to decide
// whether free-form is possible (see §13/§14).
export const customerServiceWindow = pgTable(
  "customer_service_window",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    senderNumberId: uuid("sender_number_id").notNull().references(() => senderNumber.id),
    contactId: uuid("contact_id").notNull().references(() => contact.id),
    openedAt: tsCol("opened_at").notNull(),
    expiresAt: tsCol("expires_at").notNull(),
    openedBy: text("opened_by").notNull(), // 'inbound_message' | 'inbound_call'
    metaConversationId: text("meta_conversation_id"),
    freeEntryPointFlag: text("free_entry_point_flag").notNull().default("false"),
  },
  (t) => [unique("customer_service_window_unique").on(t.senderNumberId, t.contactId)],
);

// PRD §21.4 message — a single WhatsApp message in either direction.
// current_status is derived by monotonic rank (DM-7), never written
// directly by a webhook handler.
export const message = pgTable("message", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  senderNumberId: uuid("sender_number_id").notNull().references(() => senderNumber.id),
  contactId: uuid("contact_id").notNull().references(() => contact.id),
  direction: messageDirection("direction").notNull(),
  wamid: text("wamid").unique(),
  sendId: text("send_id"),
  campaignRecipientId: uuid("campaign_recipient_id").references(() => campaignRecipient.id),
  conversationId: uuid("conversation_id").notNull().references(() => conversation.id),
  type: text("type").notNull(), // text | template | image | ...
  contentOrTemplateRef: jsonb("content_or_template_ref"),
  templateVersionId: uuid("template_version_id").references(() => templateVersion.id),
  mediaReference: text("media_reference"),
  currentStatus: messageStatus("current_status"),
  currentStatusRank: integer("current_status_rank").notNull().default(0),
  pricingCategory: text("pricing_category"),
  billable: text("billable").notNull().default("unknown"),
  sentAt: tsCol("sent_at"),
  failedErrorCode: text("failed_error_code"),
  failedApiSurface: text("failed_api_surface"),
  createdAt: createdAt(),
});

// PRD §21.4 message_status_event — append-only. DM-11/AR-11: unique on
// (wamid, status) ONLY — provider timestamp is stored but deliberately
// excluded from the key so a redelivery with a shifted timestamp is still
// absorbed as a conflict rather than a second row.
export const messageStatusEvent = pgTable(
  "message_status_event",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull().references(() => message.id, { onDelete: "cascade" }),
    wamid: text("wamid").notNull(),
    status: messageStatus("status").notNull(),
    providerTimestamp: tsCol("provider_timestamp"),
    receivedAt: utcNow("received_at"),
    errorCode: text("error_code"),
    apiSurface: text("api_surface"),
    rawPayload: jsonb("raw_payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
  },
  (t) => [unique("message_status_event_wamid_status_unique").on(t.wamid, t.status)],
);
