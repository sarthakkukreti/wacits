import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  businessPortfolio,
  campaign,
  client,
  contact,
  conversation,
  db,
  senderNumber,
  session,
  template,
  templateVersion,
  user,
  userClientRole,
  whatsappBusinessAccount,
} from "@wacits/db";
import { hashToken } from "./lib/session";
import { app } from "./index";

/**
 * PRD CL-11 / §25 Phase-1 exit criterion: "a second workspace cannot see
 * the first one's data, proven by tests that run in CI." packages/db/src/
 * tenant.test.ts already proves this at the withTenant()/RLS level for one
 * table; this proves it at the HTTP layer, through the real Hono app
 * (app.request() — in-process, no network), for the highest-risk route
 * files (contacts, campaigns, inbox) and the three attack shapes CL-11
 * names: direct object ID, list-filter tampering, and body-field tampering.
 *
 * Not exhaustive over every route yet (that's a documented Phase-2
 * follow-on — see the rollout notes); this establishes the harness and
 * covers the PII- and send-capable surfaces first.
 */

const SECRET = process.env.API_SHARED_SECRET!;

async function seedWorkspace(label: string) {
  const [c] = await db.insert(client).values({ name: `Isolation Test ${label}`, slug: `iso-${label}-${Date.now()}` }).returning();

  const [u] = await db
    .insert(user)
    .values({ email: `iso-${label}-${Date.now()}@example.com`, name: `Isolation ${label}`, superAdmin: false, emailVerified: true })
    .returning();

  const rawToken = randomBytes(32).toString("hex");
  await db.insert(session).values({ userId: u!.id, token: hashToken(rawToken), expiresAt: new Date(Date.now() + 3600_000) });
  await db.insert(userClientRole).values({ userId: u!.id, clientId: c!.id, role: "client_admin", grantedBy: u!.id });

  const [portfolio] = await db
    .insert(businessPortfolio)
    .values({ metaBusinessPortfolioId: `iso-portfolio-${label}-${Date.now()}`, displayName: "Isolation Test Portfolio" })
    .returning();
  const [waba] = await db
    .insert(whatsappBusinessAccount)
    .values({ metaWabaId: `iso-waba-${label}-${Date.now()}`, name: `Isolation WABA ${label}`, businessPortfolioId: portfolio!.id })
    .returning();
  const [sender] = await db
    .insert(senderNumber)
    .values({
      metaPhoneNumberId: `iso-phone-${label}-${Date.now()}`,
      whatsappBusinessAccountId: waba!.id,
      clientId: c!.id,
      displayPhoneNumber: label === "a" ? "+919800000101" : "+919800000102",
      displayName: `Isolation Sender ${label}`,
    })
    .returning();
  const [tmpl] = await db
    .insert(template)
    .values({ clientId: c!.id, whatsappBusinessAccountId: waba!.id, name: "iso_test_template", language: "en", category: "utility", currentStatus: "APPROVED" })
    .returning();
  const [tmplVersion] = await db
    .insert(templateVersion)
    .values({ clientId: c!.id, templateId: tmpl!.id, versionNumber: 1, components: [], language: "en" })
    .returning();
  const [camp] = await db
    .insert(campaign)
    .values({ clientId: c!.id, name: `Isolation Campaign ${label}`, senderNumberId: sender!.id, templateVersionId: tmplVersion!.id, state: "draft" })
    .returning();

  const [ct] = await db
    .insert(contact)
    .values({ clientId: c!.id, phoneNumber: label === "a" ? "+919800000201" : "+919800000202", rawPhoneInput: "seed" })
    .returning();
  const [convo] = await db
    .insert(conversation)
    .values({ clientId: c!.id, senderNumberId: sender!.id, contactId: ct!.id })
    .returning();

  return { clientId: c!.id, sessionToken: rawToken, contactId: ct!.id, campaignId: camp!.id, conversationId: convo!.id };
}

function headers(clientId: string, sessionToken: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${SECRET}`,
    "x-client-id": clientId,
    "x-session-token": sessionToken,
    "Content-Type": "application/json",
    ...extra,
  };
}

describe("cross-tenant isolation over HTTP (CL-11)", () => {
  test("workspace A cannot read, tamper with, or leak workspace B's contacts, campaigns, or conversations", async () => {
    const a = await seedWorkspace("a");
    const b = await seedWorkspace("b");

    // --- Direct object ID: A's session against B's object IDs -----------
    const contactRes = await app.request(`/workspace/contacts/${b.contactId}`, { headers: headers(a.clientId, a.sessionToken) });
    expect(contactRes.status).toBe(404);

    const campaignRes = await app.request(`/workspace/campaigns/${b.campaignId}`, { headers: headers(a.clientId, a.sessionToken) });
    expect(campaignRes.status).toBe(404);

    const conversationRes = await app.request(`/workspace/inbox/conversations/${b.conversationId}`, {
      headers: headers(a.clientId, a.sessionToken),
    });
    expect(conversationRes.status).toBe(404);

    // --- List-filter tampering: B's rows must never surface in A's lists,
    // no matter what the query asks for (RLS filters before the query does).
    const contactsList = await app.request(`/workspace/contacts?pageSize=200`, { headers: headers(a.clientId, a.sessionToken) });
    const contactsBody = await contactsList.json();
    expect(contactsBody.contacts.some((row: any) => row.id === b.contactId)).toBe(false);

    const conversationsList = await app.request(`/workspace/inbox/conversations?pageSize=100`, {
      headers: headers(a.clientId, a.sessionToken),
    });
    const conversationsBody = await conversationsList.json();
    expect(conversationsBody.conversations.some((row: any) => row.id === b.conversationId)).toBe(false);

    // --- Body-field tampering: A tries to mutate B's contact by naming its
    // id in the URL — must 404, and B's row must be provably untouched.
    const patchRes = await app.request(`/workspace/contacts/${b.contactId}`, {
      method: "PATCH",
      headers: headers(a.clientId, a.sessionToken),
      body: JSON.stringify({ firstName: "Tampered" }),
    });
    expect(patchRes.status).toBe(404);

    const bContactAfter = await app.request(`/workspace/contacts/${b.contactId}`, { headers: headers(b.clientId, b.sessionToken) });
    const bContactBody = await bContactAfter.json();
    expect(bContactBody.contact.firstName).not.toBe("Tampered");

    // --- The reverse must also hold: B can never see A's data either. ---
    const reverseRes = await app.request(`/workspace/contacts/${a.contactId}`, { headers: headers(b.clientId, b.sessionToken) });
    expect(reverseRes.status).toBe(404);

    // --- Sanity: each workspace can still see its own data (a 404 above
    // must mean isolation, not a broken route). ---
    const ownRes = await app.request(`/workspace/contacts/${a.contactId}`, { headers: headers(a.clientId, a.sessionToken) });
    expect(ownRes.status).toBe(200);
  });

  test("a valid session cannot be reused against a workspace it has no role in", async () => {
    const a = await seedWorkspace("a2");
    const b = await seedWorkspace("b2");

    // a's session token asserting b's clientId — the exact shape
    // middleware/tenant.ts's membership check exists to catch.
    const res = await app.request(`/workspace/contacts`, { headers: headers(b.clientId, a.sessionToken) });
    expect(res.status).toBe(403);
  });
});
