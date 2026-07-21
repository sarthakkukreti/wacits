import { integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsCol } from "./columns.helpers";
import { marginChargeType } from "./enums";
import { client, senderNumber } from "./platform";
import { message } from "./messaging";

// PRD §21.5 rate_card / rate_card_entry — deliberately NOT client-scoped.
// Meta's rates are a property of market and category, not of a customer.
// India numerals are [Verify before build] — secondary transcription; must
// be re-read from the INR rate-card CSV before any figure reaches a client.
export const rateCard = pgTable("rate_card", {
  id: id(),
  region: text("region").notNull(),
  currency: text("currency").notNull(),
  effectiveFrom: tsCol("effective_from").notNull(),
  effectiveTo: tsCol("effective_to"),
  source: text("source"), // rate card CSV file name + download date
  notes: text("notes"),
  createdAt: createdAt(),
});

export const rateCardEntry = pgTable(
  "rate_card_entry",
  {
    id: id(),
    rateCardId: uuid("rate_card_id").notNull().references(() => rateCard.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // marketing | utility | authentication | service
    inWindowFlag: text("in_window_flag").notNull().default("false"),
    tierLowerBound: integer("tier_lower_bound").notNull().default(0),
    tierUpperBound: integer("tier_upper_bound"),
    unitPricePaise: integer("unit_price_paise").notNull(),
  },
  (t) => [
    unique("rate_card_entry_unique").on(
      t.rateCardId,
      t.category,
      t.inWindowFlag,
      t.tierLowerBound,
    ),
  ],
);

// PRD §21.5 margin_config / margin_config_entry — CITS service charges,
// versioned by effective date exactly like rate_card. Null client id = the
// platform default. DM-29: never mutate a config that has already priced a
// usage_record; a change is a new row.
export const marginConfig = pgTable("margin_config", {
  id: id(),
  clientId: uuid("client_id").references(() => client.id), // null = platform default
  effectiveFrom: tsCol("effective_from").notNull(),
  effectiveTo: tsCol("effective_to"),
  label: text("label").notNull(),
  createdBy: uuid("created_by"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const marginConfigEntry = pgTable(
  "margin_config_entry",
  {
    id: id(),
    marginConfigId: uuid("margin_config_id")
      .notNull()
      .references(() => marginConfig.id, { onDelete: "cascade" }),
    pricingCategory: text("pricing_category").notNull(),
    chargeType: marginChargeType("charge_type").notNull(),
    value: integer("value").notNull(), // percentage (bps) or paise, per chargeType
    minimumChargePaise: integer("minimum_charge_paise"),
    maximumChargePaise: integer("maximum_charge_paise"),
  },
  (t) => [unique("margin_config_entry_unique").on(t.marginConfigId, t.pricingCategory)],
);

// PRD §21.5 usage_record — append-only. One billable or free unit of
// consumption, attributed to a client. Not billed to anyone in v1 (§1), but
// tracked from day one so a commercial model can switch on without
// re-instrumenting the product.
export const usageRecord = pgTable("usage_record", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => message.id).unique(),
  senderNumberId: uuid("sender_number_id").notNull().references(() => senderNumber.id),
  pricingCategory: text("pricing_category").notNull(),
  billable: text("billable").notNull(),
  rateCardEntryId: uuid("rate_card_entry_id").references(() => rateCardEntry.id),
  unitCostPaise: integer("unit_cost_paise").notNull().default(0),
  marginConfigEntryId: uuid("margin_config_entry_id").references(() => marginConfigEntry.id),
  marginAmountPaise: integer("margin_amount_paise").notNull().default(0),
  gstAmountPaise: integer("gst_amount_paise").notNull().default(0),
  totalPaise: integer("total_paise").notNull().default(0),
  incurredAt: createdAt(),
  source: text("source").notNull().default("webhook_pricing"), // or 'reconciliation'
});
