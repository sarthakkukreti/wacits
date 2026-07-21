import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { client, contact } from "./schema/index";
import { withTenant } from "./tenant";

/**
 * DM-20: the migration that enables row-level security must be verified by
 * an automated test that attempts a cross-client read and asserts that zero
 * rows are returned. This must run in CI and block deployment on failure.
 *
 * This is the minimal version of that test: two workspaces, one contact
 * each, and a proof that client A's session can never see client B's row —
 * regardless of what the query itself asks for.
 */
describe("tenant isolation (DM-20)", () => {
  test("a workspace session can only ever see its own contacts", async () => {
    const [clientA] = await db.insert(client).values({ name: "Test Society A", slug: `test-a-${Date.now()}` }).returning();
    const [clientB] = await db.insert(client).values({ name: "Test Society B", slug: `test-b-${Date.now()}` }).returning();

    await db.insert(contact).values({
      clientId: clientA!.id,
      phoneNumber: "+919800000001",
      rawPhoneInput: "9800000001",
    });
    await db.insert(contact).values({
      clientId: clientB!.id,
      phoneNumber: "+919800000002",
      rawPhoneInput: "9800000002",
    });

    // Scoped to A: must see A's contact, must never see B's — even though
    // the query below does not filter by clientId at all. RLS is the thing
    // doing the filtering, not the query.
    const seenFromA = await withTenant(clientA!.id, (tx) => tx.select().from(contact));
    expect(seenFromA.map((c) => c.phoneNumber)).toContain("+919800000001");
    expect(seenFromA.map((c) => c.phoneNumber)).not.toContain("+919800000002");

    // Scoped to B: the reverse must also hold.
    const seenFromB = await withTenant(clientB!.id, (tx) => tx.select().from(contact));
    expect(seenFromB.map((c) => c.phoneNumber)).toContain("+919800000002");
    expect(seenFromB.map((c) => c.phoneNumber)).not.toContain("+919800000001");

    // An explicit attempt to read the other tenant's row by id must also
    // return zero rows, not an error — RLS filters, it does not throw.
    const crossRead = await withTenant(clientA!.id, (tx) =>
      tx.select().from(contact).where(eq(contact.clientId, clientB!.id)),
    );
    expect(crossRead).toHaveLength(0);
  });
});
