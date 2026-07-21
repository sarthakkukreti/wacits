import { boolean, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsCol, updatedAt, utcNow } from "./columns.helpers";
import { workspaceRole } from "./enums";
import { client } from "./platform";

// --- Better Auth core tables ------------------------------------------------
// These mirror Better Auth's default schema (email/password + Organization
// plugin). In a real setup, prefer generating this file with
// `npx @better-auth/cli generate` against the actual Better Auth config so it
// always matches the installed plugin set exactly; this hand-authored version
// exists so the rest of the schema has something concrete to reference at
// scaffold time (PRD §3.2 "Better Auth").

export const user = pgTable("user", {
  id: id(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name").notNull(),
  image: text("image"),
  // PRD §21.2: "The application-level Super Admin role lives here, on the
  // user record, and nowhere else. Workspace roles are held through
  // user_client_role." There is no cross-workspace operator role (§6.1).
  superAdmin: boolean("super_admin").notNull().default(false),
  lastSignInAt: tsCol("last_sign_in_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable("session", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: tsCol("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

export const account = pgTable("account", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull(),
  accountId: text("account_id").notNull(),
  passwordHash: text("password_hash"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verification = pgTable("verification", {
  id: id(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: tsCol("expires_at").notNull(),
  createdAt: createdAt(),
});

// Better Auth's Organization plugin — `client.organizationId` (see
// platform.ts) references this row. One organization per CITS client
// workspace.
export const organization = pgTable("organization", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: createdAt(),
});

export const member = pgTable("member", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const invitation = pgTable("invitation", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  invitedBy: uuid("invited_by").notNull().references(() => user.id),
  expiresAt: tsCol("expires_at").notNull(),
  acceptedAt: tsCol("accepted_at"),
  createdAt: createdAt(),
});

// --- Application-level role and permission tables ---------------------------

// PRD §21.2 user_client_role — grants one user one workspace role inside one
// client. Unique on (user, client) where not revoked.
export const userClientRole = pgTable(
  "user_client_role",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    role: workspaceRole("role").notNull(),
    grantedBy: uuid("granted_by").notNull().references(() => user.id),
    grantedAt: utcNow("granted_at"),
    revokedAt: tsCol("revoked_at"),
  },
  (t) => [unique("user_client_role_active_unique").on(t.userId, t.clientId, t.revokedAt)],
);

// PRD §21.2 user_client_permission — named extra permissions on top of a
// workspace role. v1 defines exactly one key: view_full_phone_numbers.
export const userClientPermission = pgTable(
  "user_client_permission",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(),
    grantedBy: uuid("granted_by").notNull().references(() => user.id),
    grantedAt: utcNow("granted_at"),
    revokedAt: tsCol("revoked_at"),
  },
  (t) => [
    unique("user_client_permission_active_unique").on(
      t.userId,
      t.clientId,
      t.permissionKey,
      t.revokedAt,
    ),
  ],
);

export const VIEW_FULL_PHONE_NUMBERS = "view_full_phone_numbers" as const;
