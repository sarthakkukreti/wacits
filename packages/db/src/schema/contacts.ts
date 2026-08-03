import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsCol, updatedAt, utcNow } from "./columns.helpers";
import {
  consentCategory,
  consentDirection,
  consentSourceType,
  deliverabilityState,
  metaBlockState,
} from "./enums";
import { client, senderNumber } from "./platform";
import { contactType } from "./settings";
import { user } from "./auth";

// PRD §21.3 contact — a person a client may message. Unique on (client,
// normalised phone number). Contact type is a real FK column, never stuffed
// into custom_attributes (DM-23).
export const contact = pgTable(
  "contact",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(), // E.164, normalised (DM-5)
    rawPhoneInput: text("raw_phone_input").notNull(),
    countryCode: text("country_code"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    memberId: text("member_id"),
    designation: text("designation"),
    organization: text("organization"),
    city: text("city"),
    state: text("state"),
    contactTypeId: uuid("contact_type_id").references(() => contactType.id),
    email: text("email"),
    language: text("language").notNull().default("en"),
    notes: text("notes"),
    deliverabilityState: deliverabilityState("deliverability_state").notNull().default("unknown"),
    deliverabilityChangedAt: tsCol("deliverability_changed_at"),
    deliverabilityChangedBy: uuid("deliverability_changed_by").references(() => user.id),
    archived: text("archived").notNull().default("false"),
    archivedAt: tsCol("archived_at"),
    customAttributes: jsonb("custom_attributes").notNull().default({}),
    source: text("source"),
    marketingConsentState: text("marketing_consent_state").notNull().default("unknown"), // derived
    firstSeenAt: utcNow("first_seen_at"),
    lastInboundAt: tsCol("last_inbound_at"),
    lastOutboundAt: tsCol("last_outbound_at"),
    lifetimeMessageCount: integer("lifetime_message_count").notNull().default(0),
    // DM-22: 131026 strike tracking towards `suspect` (N/M/D parameters).
    strike131026Count: integer("strike_131026_count").notNull().default(0),
    strike131026DistinctCampaigns: integer("strike_131026_distinct_campaigns").notNull().default(0),
    strike131026DistinctDays: integer("strike_131026_distinct_days").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("contact_client_phone_unique").on(t.clientId, t.phoneNumber),
    // PRD §21.3 contact-list filtering by type/city and fuzzy name search.
    // Not yet exercised by the current UI filters (only q/deliverability/
    // tag/group/errorCode are wired today), but part of the PRD's named
    // contact-search index set (DM-14) — added now since the columns exist.
    index("contact_client_contact_type_idx").on(t.clientId, t.contactTypeId),
    index("contact_client_city_idx").on(t.clientId, t.city),
    index("contact_custom_attributes_gin_idx").using("gin", t.customAttributes),
    index("contact_name_trgm_idx").using(
      "gin",
      sql`(coalesce(${t.firstName}, '') || ' ' || coalesce(${t.lastName}, '')) gin_trgm_ops`,
    ),
  ],
);

// PRD §21.3 contact_group — a named STATIC list. No `type` column, no
// `dynamic` variant (canon: groups vs saved segments are resolved this way).
export const contactGroup = pgTable(
  "contact_group",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    cachedMemberCount: integer("cached_member_count").notNull().default(0),
    lastRecountAt: tsCol("last_recount_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("contact_group_client_name_unique").on(t.clientId, t.name)],
);

export const contactGroupMember = pgTable(
  "contact_group_member",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }), // denormalised for scoping
    groupId: uuid("group_id").notNull().references(() => contactGroup.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by").notNull().references(() => user.id),
    addedAt: utcNow("added_at"),
  },
  (t) => [unique("contact_group_member_unique").on(t.groupId, t.contactId)],
);

// PRD §21.3 saved_segment — a stored filter definition resolved to contacts
// at the moment it is used. Separate entity from contact_group.
export const savedSegment = pgTable(
  "saved_segment",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    filterDefinition: jsonb("filter_definition").notNull(),
    createdBy: uuid("created_by").notNull().references(() => user.id),
    lastUsedAt: tsCol("last_used_at"),
    lastResolvedCount: integer("last_resolved_count"), // advisory cache only
    lastResolvedAt: tsCol("last_resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [unique("saved_segment_client_name_unique").on(t.clientId, t.name)],
);

export const tag = pgTable(
  "tag",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: createdAt(),
  },
  (t) => [unique("tag_client_name_unique").on(t.clientId, t.name)],
);

export const contactTag = pgTable(
  "contact_tag",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id").notNull().references(() => tag.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
    appliedBy: uuid("applied_by").notNull().references(() => user.id),
  },
  (t) => [unique("contact_tag_unique").on(t.tagId, t.contactId)],
);

// PRD §21.3 consent_record — append-only evidence of an opt-in or opt-out.
// DM-6: never updated, never deleted. A withdrawal is a new row.
export const consentRecord = pgTable("consent_record", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
  phoneNumberAsRecorded: text("phone_number_as_recorded").notNull(),
  direction: consentDirection("direction").notNull(),
  category: consentCategory("category").notNull(),
  verbatimConsentWording: text("verbatim_consent_wording"),
  businessNameShown: text("business_name_shown"),
  channelDisclosureText: text("channel_disclosure_text"),
  sourceType: consentSourceType("source_type").notNull(),
  sourceReference: text("source_reference"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  recordedBy: uuid("recorded_by").references(() => user.id),
  occurredAt: utcNow("occurred_at"),
});

// PRD §21.3 suppression_entry — deliberately NOT client-scoped. The duty not
// to contact is owed to the person, not to one client (see §21.7).
export const suppressionEntry = pgTable("suppression_entry", {
  id: id(),
  phoneNumber: text("phone_number").notNull().unique(),
  reason: text("reason").notNull(),
  source: text("source").notNull(),
  firstSuppressedAt: utcNow("first_suppressed_at"),
  lastReconfirmedAt: tsCol("last_reconfirmed_at"),
  notes: text("notes"),
  originatingClientId: uuid("originating_client_id").references(() => client.id), // informational only
});

// PRD §21.3 meta_block_entry — Meta-side block, per sender number. Distinct
// from suppression_entry (see the note in §21.3 / §10).
export const metaBlockEntry = pgTable(
  "meta_block_entry",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    senderNumberId: uuid("sender_number_id").notNull().references(() => senderNumber.id),
    contactPhoneNumber: text("contact_phone_number").notNull(),
    state: metaBlockState("state").notNull(),
    blockedAt: tsCol("blocked_at"),
    unblockedAt: tsCol("unblocked_at"),
    lastErrorCode: text("last_error_code"),
  },
  (t) => [unique("meta_block_entry_unique").on(t.senderNumberId, t.contactPhoneNumber)],
);

// PRD §21.3 frequency_ledger_entry — one marketing message counted against
// the CITS-side frequency governor (independent of Meta's own per-user cap).
export const frequencyLedgerEntry = pgTable("frequency_ledger_entry", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id"), // FK added in campaigns.ts's relations to avoid a cycle
  countedAt: utcNow("counted_at"),
});
