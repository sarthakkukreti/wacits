import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsCol, utcNow } from "./columns.helpers";
import { client } from "./platform";
import { campaign } from "./campaigns";
import { templateVersion } from "./templates";
import { message } from "./messaging";
import { contact } from "./contacts";

// PRD §16 Click tracking / §21.5 click_link — a trackable destination
// inside a template. The token is generated at audience-snapshot time and
// written into the recipient's resolved parameter values as the trailing
// URL-button variable (see §12 / §16).
export const clickLink = pgTable("click_link", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => campaign.id, { onDelete: "cascade" }),
  templateVersionId: uuid("template_version_id").notNull().references(() => templateVersion.id),
  destinationUrl: text("destination_url").notNull(),
  utmParameters: jsonb("utm_parameters").notNull().default({}),
  shortDomain: text("short_domain").notNull(),
  createdAt: createdAt(),
});

export const clickEvent = pgTable("click_event", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  clickLinkId: uuid("click_link_id").notNull().references(() => clickLink.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  messageId: uuid("message_id").references(() => message.id),
  wamid: text("wamid"),
  contactId: uuid("contact_id").references(() => contact.id),
  clickedAt: utcNow("clicked_at"),
  userAgent: text("user_agent"),
  coarseIp: text("coarse_ip"), // see §19 Security — no precise IP retained
});
