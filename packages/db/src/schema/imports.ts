import { integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsCol } from "./columns.helpers";
import { importJobState } from "./enums";
import { client } from "./platform";
import { contact } from "./contacts";
import { user } from "./auth";

// PRD §21.5 import_job — one uploaded contact file. The 24-hour undo window
// (DM-28) is the only rollback that exists — there is no general rollback.
export const importJob = pgTable("import_job", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  uploadedBy: uuid("uploaded_by").notNull().references(() => user.id),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  rowCount: integer("row_count"),
  state: importJobState("state").notNull().default("pending"),
  createdCount: integer("created_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  erroredCount: integer("errored_count").notNull().default(0),
  mappingDefinition: jsonb("mapping_definition"),
  startedAt: tsCol("started_at"),
  finishedAt: tsCol("finished_at"),
  undoAvailableUntil: tsCol("undo_available_until"), // finishedAt + 24h
  undoneAt: tsCol("undone_at"),
  undoneBy: uuid("undone_by").references(() => user.id),
  createdAt: createdAt(),
});

export const importError = pgTable("import_error", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  importJobId: uuid("import_job_id").notNull().references(() => importJob.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  rawRow: jsonb("raw_row").notNull(),
  errorType: text("error_type").notNull(),
  errorMessage: text("error_message").notNull(),
});

// PRD §21.5 / DM-28 — exists solely so "undo import" can identify its own
// creations (never updates to pre-existing contacts).
export const importCreatedContact = pgTable("import_created_contact", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  importJobId: uuid("import_job_id").notNull().references(() => importJob.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contact.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});
