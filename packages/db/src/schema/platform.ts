import { boolean, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsCol, updatedAt } from "./columns.helpers";
import { clientStatus, connectionStatus, qualityRating } from "./enums";

// PRD §21.2 business_portfolio — deliberately NOT client-scoped. Messaging
// limits, volume tiers and pacing state live here, never on the phone
// number (DM-3), because since 2025-10-07 Meta computes and shares them at
// the business-portfolio level across every number in the portfolio. One
// row in v1.
export const businessPortfolio = pgTable("business_portfolio", {
  id: id(),
  metaBusinessPortfolioId: text("meta_business_portfolio_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  businessVerificationStatus: text("business_verification_status").notNull().default("unverified"),
  // Ladder: 250 / 2,000 / 10,000 / 100,000 / unlimited (§7.1 / §13).
  messagingLimitTier: integer("messaging_limit_tier").notNull().default(250),
  tierSource: text("tier_source"),
  tierObservedAt: tsCol("tier_observed_at"),
  phoneNumberCapacity: integer("phone_number_capacity").notNull().default(2),
  // Portfolio pacing applies below 500,000 template messages in a rolling
  // 365 days (§2.9 / DM-3 note). This count must be refreshed from Meta and
  // read as live data, never assumed.
  templateMessagesSentRolling365d: integer("template_messages_sent_rolling_365d")
    .notNull()
    .default(0),
  countObservedAt: tsCol("count_observed_at"),
  portfolioPacingState: text("portfolio_pacing_state").notNull().default("paced"),
  enforcementState: text("enforcement_state"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// PRD §21.2 whatsapp_business_account — a WABA owned by the CITS portfolio.
// Templates live here, not on a sender number (see templates.ts).
export const whatsappBusinessAccount = pgTable("whatsapp_business_account", {
  id: id(),
  metaWabaId: text("meta_waba_id").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  currency: text("currency").notNull().default("INR"),
  accountReviewStatus: text("account_review_status"),
  // DM-4: immutable after creation. A WABA can never be migrated between
  // portfolios, so a client's number can never be handed over to them.
  businessPortfolioId: uuid("business_portfolio_id")
    .notNull()
    .references(() => businessPortfolio.id),
  templateQuota: integer("template_quota").notNull().default(250),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// PRD §21.2 client — the tenant boundary. Maps to a Better Auth Organization
// (see auth.ts); the organization id is stored as a plain column rather than
// a hard FK to avoid a module import cycle with the auth schema, since
// Better Auth may own migrations for its own tables independently.
export const client = pgTable("client", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  organizationId: uuid("organization_id"), // soft reference -> auth.organization.id
  contactPerson: text("contact_person"),
  status: clientStatus("status").notNull().default("onboarding"),
  statusChangedAt: tsCol("status_changed_at"),
  statusChangedBy: uuid("status_changed_by"),
  defaultLanguage: text("default_language").notNull().default("en"),
  notes: text("notes"),
  onboardingChecklist: jsonb("onboarding_checklist").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// PRD §21.2 sender_number — one WhatsApp business phone number, dedicated to
// one client. Carries NO messaging limit and no volume tier (DM-3) — those
// are read from business_portfolio at render time.
export const senderNumber = pgTable(
  "sender_number",
  {
    id: id(),
    metaPhoneNumberId: text("meta_phone_number_id").notNull().unique(),
    whatsappBusinessAccountId: uuid("whatsapp_business_account_id")
      .notNull()
      .references(() => whatsappBusinessAccount.id),
    clientId: uuid("client_id").notNull().references(() => client.id),
    displayPhoneNumber: text("display_phone_number").notNull(), // E.164
    displayName: text("display_name").notNull(),
    nameStatus: text("name_status").notNull().default("NONE"),
    registrationStatus: text("registration_status").notNull().default("unregistered"),
    // Set to "IN" for all India-facing numbers (PRD §7).
    dataLocalizationRegion: text("data_localization_region"),
    qualityRating: qualityRating("quality_rating").notNull().default("unknown"),
    qualityObservedAt: tsCol("quality_observed_at"),
    throughputMps: integer("throughput_mps").notNull().default(80),
    throughputObservedAt: tsCol("throughput_observed_at"),
    connectionStatus: connectionStatus("connection_status").notNull().default("connected"),
    mmLiteOnboardingState: text("mm_lite_onboarding_state").notNull().default("not_onboarded"),
    // DM-21: two independent counters, each capped at 10 per rolling 72h.
    registrationAttemptCount: integer("registration_attempt_count").notNull().default(0),
    registrationAttemptWindowStart: tsCol("registration_attempt_window_start"),
    deregistrationAttemptCount: integer("deregistration_attempt_count").notNull().default(0),
    deregistrationAttemptWindowStart: tsCol("deregistration_attempt_window_start"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("sender_number_meta_phone_id_unique").on(t.metaPhoneNumberId)],
);

// PRD §21.2 access_token — a credential for calling Meta on behalf of a WABA
// or number. Tokens are opaque strings — never parsed, never logged, never
// returned by any API response (see §19 Security).
export const accessToken = pgTable("access_token", {
  id: id(),
  scope: text("scope").notNull(), // 'waba' | 'phone_number'
  targetId: uuid("target_id").notNull(),
  encryptedTokenValue: text("encrypted_token_value").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  label: text("label"),
  expiresAt: tsCol("expires_at"), // nullable — Meta does not document whether these expire; [Verify before build]
  lastVerifiedAt: tsCol("last_verified_at"),
  lastHealthCheckAt: tsCol("last_health_check_at"),
  revokedAt: tsCol("revoked_at"),
  createdAt: createdAt(),
});
