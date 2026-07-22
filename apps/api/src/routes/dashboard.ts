import { Hono } from "hono";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { campaign, contact, conversation, message, senderNumber, withTenant } from "@wacits/db";

/**
 * PRD §15 Reporting — the numbers an operator needs on opening the app.
 * Everything here is derived at read time from the message/campaign tables
 * rather than from a counter that could drift.
 */
const dashboard = new Hono();

dashboard.get("/", async (c) => {
  const { clientId } = c.get("tenant");
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 30)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  return c.json(
    await withTenant(clientId, async (tx) => {
      const [contactStats] = await tx
        .select({
          total: count(),
          deliverable: sql<number>`count(*) filter (where ${contact.deliverabilityState} = 'deliverable')`,
          suspect: sql<number>`count(*) filter (where ${contact.deliverabilityState} = 'suspect')`,
          optedOut: sql<number>`count(*) filter (where ${contact.marketingConsentState} = 'opted_out')`,
        })
        .from(contact)
        .where(eq(contact.archived, "false"));

      const [messageStats] = await tx
        .select({
          sent: sql<number>`count(*) filter (where ${message.direction} = 'outbound')`,
          delivered: sql<number>`count(*) filter (where ${message.direction} = 'outbound' and ${message.currentStatusRank} >= 2)`,
          read: sql<number>`count(*) filter (where ${message.direction} = 'outbound' and ${message.currentStatusRank} >= 3)`,
          failed: sql<number>`count(*) filter (where ${message.currentStatus} = 'failed')`,
          received: sql<number>`count(*) filter (where ${message.direction} = 'inbound')`,
        })
        .from(message)
        .where(gte(message.createdAt, since));

      const [conversationStats] = await tx
        .select({
          open: sql<number>`count(*) filter (where ${conversation.state} = 'open')`,
          unread: sql<number>`count(*) filter (where ${conversation.unreadCount} > 0)`,
        })
        .from(conversation);

      const recentCampaigns = await tx
        .select({
          id: campaign.id,
          name: campaign.name,
          state: campaign.state,
          countQueued: campaign.countQueued,
          countSent: campaign.countSent,
          countDelivered: campaign.countDelivered,
          countFailed: campaign.countFailed,
          createdAt: campaign.createdAt,
        })
        .from(campaign)
        .orderBy(desc(campaign.createdAt))
        .limit(5);

      const numbers = await tx
        .select({
          id: senderNumber.id,
          displayPhoneNumber: senderNumber.displayPhoneNumber,
          displayName: senderNumber.displayName,
          qualityRating: senderNumber.qualityRating,
          connectionStatus: senderNumber.connectionStatus,
        })
        .from(senderNumber)
        .where(eq(senderNumber.clientId, clientId));

      // Daily outbound volume for a sparkline.
      const daily = await tx
        .select({
          day: sql<string>`date_trunc('day', ${message.createdAt})::date::text`,
          outbound: sql<number>`count(*) filter (where ${message.direction} = 'outbound')`,
          inbound: sql<number>`count(*) filter (where ${message.direction} = 'inbound')`,
        })
        .from(message)
        .where(gte(message.createdAt, since))
        .groupBy(sql`date_trunc('day', ${message.createdAt})`)
        .orderBy(sql`date_trunc('day', ${message.createdAt})`);

      const num = (v: unknown) => Number(v ?? 0);
      const sent = num(messageStats?.sent);

      return {
        windowDays: days,
        contacts: {
          total: num(contactStats?.total),
          deliverable: num(contactStats?.deliverable),
          suspect: num(contactStats?.suspect),
          optedOut: num(contactStats?.optedOut),
        },
        messages: {
          sent,
          delivered: num(messageStats?.delivered),
          read: num(messageStats?.read),
          failed: num(messageStats?.failed),
          received: num(messageStats?.received),
          // Rates are only meaningful with a denominator — return null
          // rather than a misleading 0% when nothing has been sent.
          deliveryRate: sent ? num(messageStats?.delivered) / sent : null,
          readRate: sent ? num(messageStats?.read) / sent : null,
        },
        conversations: {
          open: num(conversationStats?.open),
          unread: num(conversationStats?.unread),
        },
        recentCampaigns,
        senderNumbers: numbers,
        daily: daily.map((d: any) => ({ day: d.day, outbound: num(d.outbound), inbound: num(d.inbound) })),
      };
    }),
  );
});

export default dashboard;
