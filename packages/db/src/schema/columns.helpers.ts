import { timestamp, uuid } from "drizzle-orm/pg-core";

// DM-1: every timestamp is stored UTC, timezone-aware; rendered in
// Asia/Kolkata only at the presentation layer.
export const id = () => uuid("id").defaultRandom().primaryKey();

// A NOT NULL, default-now, UTC timestamp column under an arbitrary name.
// Use this (not createdAt()) for any "when did X happen" column that is
// not literally the row's own created_at — e.g. grantedAt, occurredAt,
// firstSeenAt. createdAt() hardcodes the column name to "created_at" and
// must only ever be used once per table.
export const utcNow = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const createdAt = () => utcNow("created_at");

export const updatedAt = () => utcNow("updated_at");

// Convenience for a nullable UTC timestamp column (e.g. revoked_at, expires_at).
export const tsCol = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
