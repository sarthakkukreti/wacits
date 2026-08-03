import { Hono } from "hono";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import {
  contact,
  conversation,
  conversationNote,
  message,
  quickReply,
  withTenant,
} from "@wacits/db";
import { formatPhoneForDisplay, normalisePhone } from "@wacits/shared";
import { getServiceWindow, resolveSender, sendOutbound, SendBlockedError } from "../lib/sending";
import { requirePermission } from "../middleware/permission";

/**
 * PRD §14 Inbox — one-to-one conversations. The single rule that shapes
 * this entire surface: outside the 24-hour customer service window, a
 * free-text message is impossible and only an approved template will
 * deliver. Every response here therefore reports the window state, so the
 * UI can offer the right composer instead of letting an agent type a reply
 * that Meta will silently reject.
 */
const inbox = new Hono();

/** Conversation list, newest activity first, with the contact joined in. */
inbox.get("/conversations", requirePermission("view_inbox"), async (c) => {
  const { clientId } = c.get("tenant");
  const state = c.req.query("state"); // 'open' | 'closed'
  const q = c.req.query("q")?.trim();
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 50)));

  return c.json(
    await withTenant(clientId, async (tx) => {
      const filters = [];
      if (state === "open" || state === "closed") filters.push(eq(conversation.state, state));
      if (q) {
        const like = `%${q}%`;
        filters.push(
          sql`(${contact.firstName} ILIKE ${like} OR ${contact.lastName} ILIKE ${like} OR ${contact.phoneNumber} ILIKE ${like})`,
        );
      }
      const where = filters.length ? and(...filters) : undefined;

      const rows = await tx
        .select({
          id: conversation.id,
          state: conversation.state,
          unreadCount: conversation.unreadCount,
          lastInboundAt: conversation.lastInboundAt,
          lastOutboundAt: conversation.lastOutboundAt,
          senderNumberId: conversation.senderNumberId,
          contactId: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          phoneNumber: contact.phoneNumber,
          organization: contact.organization,
          // The last message body, for the list preview. Correlated
          // subquery rather than a join so one row per conversation is
          // guaranteed regardless of message volume.
          lastMessage: sql<string | null>`(
            select case
              when m.type = 'text' then m.content_or_template_ref->>'body'
              else '[' || m.type || ']'
            end
            from message m
            where m.conversation_id = ${conversation.id}
            order by m.created_at desc limit 1
          )`,
          lastMessageAt: sql<Date | null>`(
            select m.created_at from message m
            where m.conversation_id = ${conversation.id}
            order by m.created_at desc limit 1
          )`,
        })
        .from(conversation)
        .innerJoin(contact, eq(contact.id, conversation.contactId))
        .where(where)
        .orderBy(desc(sql`greatest(coalesce(${conversation.lastInboundAt}, 'epoch'), coalesce(${conversation.lastOutboundAt}, 'epoch'))`))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ total }] = await tx
        .select({ total: count() })
        .from(conversation)
        .innerJoin(contact, eq(contact.id, conversation.contactId))
        .where(where);

      return {
        conversations: rows.map((r: any) => ({
          ...r,
          displayName:
            [r.firstName, r.lastName].filter(Boolean).join(" ") || formatPhoneForDisplay(r.phoneNumber),
        })),
        total: Number(total),
        page,
        pageSize,
      };
    }),
  );
});

/** One conversation with its full message thread, oldest first. */
inbox.get("/conversations/:id", requirePermission("view_inbox"), async (c) => {
  const { clientId } = c.get("tenant");
  const id = c.req.param("id");

  const result = await withTenant(clientId, async (tx) => {
    const [convo] = await tx
      .select({
        id: conversation.id,
        state: conversation.state,
        senderNumberId: conversation.senderNumberId,
        unreadCount: conversation.unreadCount,
        contactId: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phoneNumber: contact.phoneNumber,
        organization: contact.organization,
        email: contact.email,
        deliverabilityState: contact.deliverabilityState,
        marketingConsentState: contact.marketingConsentState,
      })
      .from(conversation)
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .where(eq(conversation.id, id))
      .limit(1);

    if (!convo) return null;

    const messages = await tx
      .select()
      .from(message)
      .where(eq(message.conversationId, id))
      .orderBy(asc(message.createdAt))
      .limit(500);

    const notes = await tx
      .select()
      .from(conversationNote)
      .where(eq(conversationNote.conversationId, id))
      .orderBy(desc(conversationNote.createdAt));

    const window = await getServiceWindow(tx, clientId, convo.senderNumberId, convo.contactId);

    // Opening the thread is what marks it read.
    await tx.update(conversation).set({ unreadCount: 0 }).where(eq(conversation.id, id));

    return {
      conversation: {
        ...convo,
        displayName:
          [convo.firstName, convo.lastName].filter(Boolean).join(" ") || formatPhoneForDisplay(convo.phoneNumber),
      },
      messages,
      notes,
      serviceWindow: window,
    };
  });

  if (!result) return c.json({ error: "Conversation not found" }, 404);
  return c.json(result);
});

/**
 * Sends a reply in an existing conversation. Accepts either free text
 * (window must be open) or a template (always allowed).
 */
inbox.post("/conversations/:id/messages", requirePermission("reply_in_inbox"), async (c) => {
  const { clientId } = c.get("tenant");
  const id = c.req.param("id");
  const body = await c.req.json<{
    text?: string;
    template?: { name: string; languageCode: string; components?: any[] };
  }>();

  if (!body.text?.trim() && !body.template) {
    return c.json({ error: "Provide either `text` or `template`." }, 400);
  }

  try {
    const result = await withTenant(clientId, async (tx) => {
      const [convo] = await tx
        .select({
          id: conversation.id,
          contactId: conversation.contactId,
          senderNumberId: conversation.senderNumberId,
          phoneNumber: contact.phoneNumber,
        })
        .from(conversation)
        .innerJoin(contact, eq(contact.id, conversation.contactId))
        .where(eq(conversation.id, id))
        .limit(1);

      if (!convo) return { notFound: true as const };

      const sender = await resolveSender(tx, clientId, convo.senderNumberId);
      return {
        sent: await sendOutbound(tx, {
          clientId,
          contactId: convo.contactId,
          contactPhone: convo.phoneNumber,
          sender,
          text: body.text?.trim(),
          template: body.template
            ? { name: body.template.name, languageCode: body.template.languageCode, components: body.template.components }
            : undefined,
        }),
      };
    });

    if ("notFound" in result) return c.json({ error: "Conversation not found" }, 404);
    const outcome = result.sent;

    if (outcome.ok) return c.json({ sent: true, messageId: outcome.messageId, wamid: outcome.wamid }, 201);
    if (outcome.blocked) return c.json({ sent: false, reason: outcome.reason, error: outcome.detail }, 422);
    return c.json({ sent: false, errorCode: outcome.errorCode, error: outcome.detail }, 502);
  } catch (err) {
    if (err instanceof SendBlockedError) return c.json({ sent: false, reason: err.reason, error: err.message }, 422);
    throw err;
  }
});

/**
 * "New chat" — start a conversation from nothing but a phone number, which
 * is what an agent does when a lead calls in or a colleague forwards a
 * number. Creates the contact if it does not exist, then sends.
 *
 * Note the window rule still applies: if this person has never messaged
 * this number, free text is impossible and a template is required. The
 * response says so explicitly rather than failing opaquely.
 */
inbox.post("/start", requirePermission("reply_in_inbox"), async (c) => {
  const { clientId } = c.get("tenant");
  const body = await c.req.json<{
    phoneNumber: string;
    firstName?: string;
    lastName?: string;
    text?: string;
    template?: { name: string; languageCode: string; components?: any[] };
  }>();

  if (!body.phoneNumber?.trim()) return c.json({ error: "phoneNumber is required" }, 400);

  const normalised = normalisePhone(body.phoneNumber);
  if (!normalised.ok) {
    return c.json({ error: `Invalid phone number: ${normalised.message}`, reason: normalised.reason }, 400);
  }

  try {
    const result = await withTenant(clientId, async (tx) => {
      // Find or create the contact.
      let [row] = await tx.select().from(contact).where(eq(contact.phoneNumber, normalised.e164)).limit(1);
      let createdContact = false;

      if (!row) {
        const [created] = await tx
          .insert(contact)
          .values({
            clientId,
            phoneNumber: normalised.e164,
            rawPhoneInput: normalised.raw,
            countryCode: normalised.countryCode ?? null,
            firstName: body.firstName ?? null,
            lastName: body.lastName ?? null,
            source: "inbox_new_chat",
          })
          .returning();
        row = created;
        createdContact = true;
      } else if (body.firstName && !row.firstName) {
        // Fill in a name the agent supplied for a contact we only knew by
        // number — but never overwrite one already there.
        await tx
          .update(contact)
          .set({ firstName: body.firstName, lastName: body.lastName ?? row.lastName, updatedAt: new Date() })
          .where(eq(contact.id, row.id));
      }

      const sender = await resolveSender(tx, clientId);
      const window = await getServiceWindow(tx, clientId, sender.senderNumberId, row.id);

      // Nothing to send — the caller just wanted the conversation opened
      // (e.g. to look at history before typing).
      if (!body.text && !body.template) {
        const { ensureConversation } = await import("../lib/sending");
        const conversationId = await ensureConversation(tx, clientId, sender.senderNumberId, row.id);
        return { conversationId, contactId: row.id, createdContact, serviceWindow: window, sent: null };
      }

      const sent = await sendOutbound(tx, {
        clientId,
        contactId: row.id,
        contactPhone: row.phoneNumber,
        sender,
        text: body.text?.trim(),
        template: body.template,
      });

      const { ensureConversation } = await import("../lib/sending");
      const conversationId = await ensureConversation(tx, clientId, sender.senderNumberId, row.id);
      return { conversationId, contactId: row.id, createdContact, serviceWindow: window, sent };
    });

    if (result.sent && !result.sent.ok) {
      const outcome = result.sent;
      const status = outcome.blocked ? 422 : 502;
      return c.json(
        {
          conversationId: result.conversationId,
          contactId: result.contactId,
          sent: false,
          reason: "blocked" in outcome ? (outcome as any).reason : undefined,
          errorCode: "errorCode" in outcome ? (outcome as any).errorCode : undefined,
          error: (outcome as any).detail,
        },
        status,
      );
    }

    return c.json(
      {
        conversationId: result.conversationId,
        contactId: result.contactId,
        createdContact: result.createdContact,
        serviceWindow: result.serviceWindow,
        sent: !!result.sent,
        wamid: result.sent && result.sent.ok ? result.sent.wamid : undefined,
      },
      201,
    );
  } catch (err) {
    if (err instanceof SendBlockedError) return c.json({ sent: false, reason: err.reason, error: err.message }, 422);
    throw err;
  }
});

inbox.post("/conversations/:id/state", requirePermission("reply_in_inbox"), async (c) => {
  const { clientId, userId } = c.get("tenant");
  const body = await c.req.json<{ state: "open" | "closed" }>();

  const row = await withTenant(clientId, async (tx) => {
    const [updated] = await tx
      .update(conversation)
      .set({ state: body.state, stateChangedAt: new Date(), stateChangedBy: userId })
      .where(eq(conversation.id, c.req.param("id")))
      .returning({ id: conversation.id, state: conversation.state });
    return updated;
  });

  if (!row) return c.json({ error: "Conversation not found" }, 404);
  return c.json(row);
});

inbox.post("/conversations/:id/notes", requirePermission("reply_in_inbox"), async (c) => {
  const { clientId, userId } = c.get("tenant");
  const body = await c.req.json<{ body: string }>();
  if (!body.body?.trim()) return c.json({ error: "body is required" }, 400);

  const row = await withTenant(clientId, async (tx) => {
    const [created] = await tx
      .insert(conversationNote)
      .values({ clientId, conversationId: c.req.param("id"), authorId: userId, body: body.body.trim() })
      .returning();
    return created;
  });
  return c.json({ note: row }, 201);
});

/** Canned replies (§14) — the shortcuts agents actually live on. */
inbox.get("/quick-replies", requirePermission("view_inbox"), async (c) => {
  const { clientId } = c.get("tenant");
  return c.json(
    await withTenant(clientId, async (tx) => {
      const rows = await tx
        .select()
        .from(quickReply)
        .where(eq(quickReply.active, true))
        .orderBy(asc(quickReply.shortcut));
      return { quickReplies: rows };
    }),
  );
});

inbox.post("/quick-replies", requirePermission("manage_quick_replies"), async (c) => {
  const { clientId } = c.get("tenant");
  const body = await c.req.json<{ title: string; shortcut: string; body: string; category?: string }>();
  if (!body.title?.trim() || !body.shortcut?.trim() || !body.body?.trim()) {
    return c.json({ error: "title, shortcut and body are all required" }, 400);
  }

  const row = await withTenant(clientId, async (tx) => {
    const [created] = await tx
      .insert(quickReply)
      .values({
        clientId,
        title: body.title.trim(),
        shortcut: body.shortcut.trim().replace(/^\//, ""),
        body: body.body,
        category: body.category ?? null,
      })
      .onConflictDoNothing({ target: [quickReply.clientId, quickReply.shortcut] })
      .returning();
    return created;
  });
  return c.json({ quickReply: row ?? null }, row ? 201 : 409);
});

export default inbox;
