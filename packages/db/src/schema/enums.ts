import { pgEnum } from "drizzle-orm/pg-core";

// PRD §6 — exactly five roles. Super Admin is application-level (lives on
// `user`, not here); the other four are per-workspace (see user_client_role).
export const workspaceRole = pgEnum("workspace_role", [
  "client_admin",
  "campaign_manager",
  "inbox_agent",
  "viewer",
]);

// PRD §21.2 — client statuses (canon: exactly five).
export const clientStatus = pgEnum("client_status", [
  "onboarding",
  "active",
  "paused",
  "suspended",
  "archived",
]);

// PRD §21.2 sender_number.quality — green / yellow / red / unknown, computed
// by Meta from the last 7 days of user feedback. No thresholds published.
export const qualityRating = pgEnum("quality_rating", [
  "green",
  "yellow",
  "red",
  "unknown",
]);

export const connectionStatus = pgEnum("connection_status", [
  "connected",
  "restricted",
]);

// PRD §21.3 contact.deliverability_state — canon: exactly four. `invalid` is
// reserved for syntactic validation failure only (DM-22); delivery evidence
// (error 131026) can only ever reach `suspect`.
export const deliverabilityState = pgEnum("deliverability_state", [
  "unknown",
  "deliverable",
  "suspect",
  "invalid",
]);

// PRD §21.3 consent_record — append-only, direction of a consent event.
export const consentDirection = pgEnum("consent_direction", [
  "opt_in",
  "opt_out",
]);

export const consentCategory = pgEnum("consent_category", [
  "marketing",
  "utility",
  "authentication",
  "all",
]);

// PRD §10 / §21.3 — the normative source_type enumeration. UI pickers (e.g.
// the import screen, §9) map their friendlier labels onto these values;
// this list is the one that is authoritative.
export const consentSourceType = pgEnum("consent_source_type", [
  "website_form",
  "sms",
  "ivr",
  "paper",
  "import",
  "inbound_reply",
  "opt_out_button",
  "user_preferences_webhook",
  "error_131050",
  "off_platform_request",
]);

export const metaBlockState = pgEnum("meta_block_state", [
  "blocked",
  "unblocked",
  "failed",
]);

// PRD §11 / §21.4 — template lifecycle status and category.
export const templateCategory = pgEnum("template_category", [
  "marketing",
  "utility",
  "authentication",
]);

export const templateStatus = pgEnum("template_status", [
  "APPROVED",
  "PENDING",
  "PAUSED",
  "DISABLED",
  "REJECTED",
]);

export const sendPath = pgEnum("send_path", ["cloud_api", "marketing_messages"]);

// PRD §21.4 campaign.state — canon: exactly eleven. `halted` and
// `blocked_by_client_status` do not exist (see §12.2).
export const campaignState = pgEnum("campaign_state", [
  "draft",
  "pending_approval",
  "queued",
  "scheduled",
  "running",
  "paused",
  "completed",
  "partially_delivered",
  "stopped_by_meta",
  "failed",
  "cancelled",
]);

// PRD §21.4 campaign_recipient.state — the send outbox row's own lifecycle.
export const recipientState = pgEnum("recipient_state", [
  "pending",
  "queued",
  "accepted",
  "held",
  "sent",
  "delivered",
  "read",
  "failed",
  "skipped",
]);

// PRD §4.5 / DM-7 — message.current_status, monotonic rank order.
export const messageStatus = pgEnum("message_status", [
  "sent",
  "delivered",
  "read",
  "played",
  "failed",
]);

export const messageDirection = pgEnum("message_direction", ["inbound", "outbound"]);

// PRD §21.4 conversation.state — canon: exactly two. No `snoozed`.
export const conversationState = pgEnum("conversation_state", ["open", "closed"]);

// PRD §13 / §21.5 / Appendix A — the five canonical error classes, keyed
// on (api_surface, code), never on code alone (DM-27).
export const errorClass = pgEnum("error_class", [
  "RETRY_BACKOFF",
  "TERMINAL",
  "CONDITIONAL",
  "PROBABLE_INVALID_CONTACT",
  "OPERATIONAL_ALERT",
]);

export const importJobState = pgEnum("import_job_state", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const notificationSeverity = pgEnum("notification_severity", [
  "informational",
  "paging",
]);

export const settingValueType = pgEnum("setting_value_type", [
  "integer",
  "decimal",
  "boolean",
  "text",
  "duration",
  "time_of_day",
  "json",
]);

export const marginChargeType = pgEnum("margin_charge_type", [
  "percentage",
  "fixed_per_message",
]);

export const notificationChannel = pgEnum("notification_channel", ["in_app", "email"]);

export const auditActorType = pgEnum("audit_actor_type", ["user", "system", "webhook"]);
