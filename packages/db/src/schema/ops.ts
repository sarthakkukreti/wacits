import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsCol, utcNow } from "./columns.helpers";
import { auditActorType, errorClass, notificationSeverity } from "./enums";
import { client } from "./platform";
import { user } from "./auth";

// PRD §21.5 audit_log — append-only. An audit trail the application can
// rewrite has no value. Nullable client_id for platform-level actions
// (e.g. a Super Admin action outside any workspace).
export const auditLog = pgTable("audit_log", {
  id: id(),
  clientId: uuid("client_id").references(() => client.id),
  actorUserId: uuid("actor_user_id").references(() => user.id),
  actorType: auditActorType("actor_type").notNull().default("user"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  beforeAfterSummary: jsonb("before_after_summary"), // secrets redacted
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  // AU-2: a correlation identifier shared by every log line, queue job and
  // outbound API call tied to the same originating request.
  correlationId: text("correlation_id"),
  occurredAt: utcNow("occurred_at"),
});

// PRD §21.5 webhook_event — raw, durable capture of every inbound webhook,
// written BEFORE any parsing (AR-8/DM-9). Not client-scoped at write time;
// the resolved client id is stored once known, purely for debugging.
export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: id(),
    clientId: uuid("client_id").references(() => client.id),
    receivedAt: utcNow("received_at"),
    signatureVerified: text("signature_verified").notNull(),
    objectType: text("object_type"),
    wabaId: text("waba_id"),
    field: text("field"),
    rawBody: text("raw_body").notNull(), // exactly as received
    bodyHash: text("body_hash").notNull(),
    processingState: text("processing_state").notNull().default("pending"),
    processingAttempts: integer("processing_attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    // Serves the webhook worker's / scheduler's lookup of stuck or
    // unprocessed events (apps/workers/src/webhook-worker.ts checks
    // processingState; feeds the unresolved-send sweep).
    index("webhook_event_unprocessed_idx")
      .on(t.receivedAt)
      .where(sql`${t.processingState} != 'processed'`),
  ],
);

export const notification = pgTable("notification", {
  id: id(),
  clientId: uuid("client_id").references(() => client.id),
  recipientUserId: uuid("recipient_user_id").notNull().references(() => user.id),
  severity: notificationSeverity("severity").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  relatedEntity: text("related_entity"),
  deliveredChannels: jsonb("delivered_channels").notNull().default([]),
  readAt: tsCol("read_at"),
  createdAt: createdAt(),
});

// PRD §21.5 error_code_classification — deliberately NOT client-scoped.
// DM-27: unique on (api_surface, code, subcode), never on code alone, since
// Meta reuses codes across endpoints with different meanings. Seeded from
// the table in Appendix A; must be editable without a deploy (TS-9).
export const errorCodeClassification = pgTable(
  "error_code_classification",
  {
    id: id(),
    apiSurface: text("api_surface").notNull(), // e.g. '/messages', '/block_users'
    code: text("code").notNull(),
    subcode: text("subcode"),
    title: text("title").notNull(),
    errorClass: errorClass("error_class").notNull(),
    retryPolicy: jsonb("retry_policy"),
    userFacingExplanation: text("user_facing_explanation"),
    countsToward131026Evidence: text("counts_toward_131026_evidence").notNull().default("false"),
    updatedAt: tsCol("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("error_code_classification_unique").on(t.apiSurface, t.code, t.subcode)],
);
