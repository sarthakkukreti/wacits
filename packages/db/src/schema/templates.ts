import { integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsCol, updatedAt, utcNow } from "./columns.helpers";
import { sendPath, templateCategory, templateStatus } from "./enums";
import { client, whatsappBusinessAccount } from "./platform";

// PRD §21.4 template — a logical template as CITS manages it, owned by one
// client, living on exactly one WABA (never bound to a sender number — see
// §11). Unique on (WABA, name, language): Meta's own rule, per WABA per
// language.
export const template = pgTable(
  "template",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    whatsappBusinessAccountId: uuid("whatsapp_business_account_id")
      .notNull()
      .references(() => whatsappBusinessAccount.id),
    name: text("name").notNull(), // lowercase, underscores
    language: text("language").notNull(),
    category: templateCategory("category").notNull(),
    currentStatus: templateStatus("current_status").notNull().default("PENDING"),
    currentQualityScore: text("current_quality_score").notNull().default("UNKNOWN"),
    correctCategory: templateCategory("correct_category"), // last reported by Meta, if different
    pauseCount: integer("pause_count").notNull().default(0),
    pausedUntil: tsCol("paused_until"),
    metaTemplateId: text("meta_template_id"),
    sendPath: sendPath("send_path").notNull().default("cloud_api"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("template_waba_name_language_unique").on(t.whatsappBusinessAccountId, t.name, t.language),
  ],
);

// PRD §21.4 template_version — an immutable snapshot of one submitted body.
// The version actually used is recorded on every campaign and message.
export const templateVersion = pgTable("template_version", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").notNull().references(() => template.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  components: jsonb("components").notNull(), // { header, body, footer, buttons }
  parameterFormat: text("parameter_format").notNull().default("positional"), // 'named' | 'positional'
  sampleValues: jsonb("sample_values").notNull().default([]),
  submittedAt: utcNow("submitted_at"),
  reviewOutcome: text("review_outcome"),
  rejectionReason: text("rejection_reason"),
  rejectionRecommendation: text("rejection_recommendation"),
  approvedAt: tsCol("approved_at"),
  language: text("language").notNull(),
});
