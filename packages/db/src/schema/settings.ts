import { boolean, integer, jsonb, pgTable, text, time, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsCol, updatedAt, utcNow } from "./columns.helpers";
import { notificationChannel, settingValueType } from "./enums";
import { client } from "./platform";
import { senderNumber } from "./platform";
import { user } from "./auth";

// PRD §21.6 — roughly a dozen "configurable without a deploy" promises live
// here. Nothing promised as configurable may be a literal in application
// code (DM-30).

export const platformSetting = pgTable("platform_setting", {
  key: text("key").primaryKey(),
  valueType: settingValueType("value_type").notNull(),
  value: jsonb("value").notNull(),
  description: text("description").notNull(),
  minimum: jsonb("minimum"),
  maximum: jsonb("maximum"),
  updatedBy: uuid("updated_by").references(() => user.id),
  updatedAt: updatedAt(),
});

export const workspaceSetting = pgTable(
  "workspace_setting",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    key: text("key").notNull().references(() => platformSetting.key),
    value: jsonb("value").notNull(),
    setBy: uuid("set_by").notNull().references(() => user.id),
    setAt: utcNow("set_at"),
  },
  (t) => [unique("workspace_setting_client_key_unique").on(t.clientId, t.key)],
);

export const contactType = pgTable(
  "contact_type",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("contact_type_client_name_unique").on(t.clientId, t.name)],
);

export const campaignType = pgTable(
  "campaign_type",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("campaign_type_client_name_unique").on(t.clientId, t.name)],
);

export const optOutKeyword = pgTable(
  "opt_out_keyword",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    direction: text("direction").notNull(), // 'opt_out' | 'opt_in'
    language: text("language").notNull().default("en"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("opt_out_keyword_unique").on(t.clientId, t.keyword, t.language)],
);

export const internalTestNumber = pgTable(
  "internal_test_number",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(), // E.164
    label: text("label"),
    addedBy: uuid("added_by").notNull().references(() => user.id),
    addedAt: utcNow("added_at"),
  },
  (t) => [unique("internal_test_number_unique").on(t.clientId, t.phoneNumber)],
);

// CITS product policy, entirely optional (§12/§21.6) — a workspace with no
// rows here has no quiet hours. Not a Meta rule.
export const quietHoursWindow = pgTable("quiet_hours_window", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  daysOfWeek: jsonb("days_of_week").notNull(), // e.g. [0,1,2,3,4,5,6]
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const notificationRecipient = pgTable(
  "notification_recipient",
  {
    id: id(),
    clientId: uuid("client_id").references(() => client.id, { onDelete: "cascade" }), // nullable = platform alerts
    category: text("category").notNull(),
    userId: uuid("user_id").references(() => user.id),
    externalAddress: text("external_address"),
    channel: notificationChannel("channel").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    unique("notification_recipient_unique").on(t.clientId, t.category, t.userId, t.channel),
  ],
);

export const quickReply = pgTable(
  "quick_reply",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    shortcut: text("shortcut").notNull(),
    body: text("body").notNull(),
    category: text("category"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("quick_reply_client_shortcut_unique").on(t.clientId, t.shortcut)],
);

export const conversationalComponent = pgTable(
  "conversational_component",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    senderNumberId: uuid("sender_number_id").notNull().references(() => senderNumber.id),
    componentType: text("component_type").notNull(), // welcome_message | ice_breaker | command
    payload: jsonb("payload").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastSyncedToMetaAt: tsCol("last_synced_to_meta_at"),
    lastSyncError: text("last_sync_error"),
  },
  (t) => [unique("conversational_component_unique").on(t.senderNumberId, t.componentType)],
);

export const clickTrackingConfig = pgTable("click_tracking_config", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }).unique(),
  shortDomain: text("short_domain").notNull(),
  fallbackUrl: text("fallback_url").notNull(),
  linkExpiryDays: integer("link_expiry_days").notNull().default(90),
  active: boolean("active").notNull().default(true),
});
