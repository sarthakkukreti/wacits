import Link from "next/link";
import { apiSafe } from "../../lib/api";
import { formatNumber } from "../../lib/format";
import { AddContactDialog } from "../../components/AddContactDialog";
import { ContactsTable, type ContactRow, type LabelRef } from "../../components/ContactsTable";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; deliverability?: string; groupId?: string; tagId?: string }>;
}) {
  const sp = await searchParams;
  const page = Number(sp.page ?? 1);

  // The filter the operator is looking at. It drives the list query and is
  // also what a "select all matching" bulk action is resolved against, so
  // the two can never disagree.
  const filter = {
    q: sp.q,
    deliverability: sp.deliverability,
    groupId: sp.groupId,
    tagId: sp.tagId,
  };

  const query = new URLSearchParams({ page: String(page), pageSize: "50" });
  for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value);

  const [list, stats, groupList, tagList] = await Promise.all([
    apiSafe<{ contacts: ContactRow[]; total: number; page: number; pageSize: number }>(
      `/workspace/contacts?${query.toString()}`,
    ),
    apiSafe<{ total: number; deliverable: number; suspect: number; invalid: number; unknown: number }>(
      "/workspace/contacts/stats",
    ),
    apiSafe<{ groups: (LabelRef & { memberCount: number })[] }>("/workspace/contacts/meta/groups"),
    apiSafe<{ tags: (LabelRef & { contactCount: number })[] }>("/workspace/contacts/meta/tags"),
  ]);

  const groups = groupList.ok ? groupList.data.groups : [];
  const tags = tagList.ok ? tagList.data.tags : [];
  const filtered = Boolean(sp.q || sp.deliverability || sp.groupId || sp.tagId);

  return (
    <>
      <div className="topbar">
        <h1>Contacts</h1>
        <div className="topbar-actions">
          <Link href="/contacts/labels" className="btn">
            Groups &amp; labels
          </Link>
          <Link href="/contacts/import" className="btn">
            Import CSV
          </Link>
          <AddContactDialog />
        </div>
      </div>

      <div className="content">
        {stats.ok && (
          <div className="grid grid-4 mb-16">
            <div className="card stat">
              <div className="stat-label">Total</div>
              <div className="stat-value">{formatNumber(stats.data.total)}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">Confirmed reachable</div>
              <div className="stat-value">{formatNumber(stats.data.deliverable)}</div>
              <div className="stat-hint">Replied or delivered at least once</div>
            </div>
            <div className="card stat">
              <div className="stat-label">Suspect</div>
              <div className="stat-value">{formatNumber(stats.data.suspect)}</div>
              <div className="stat-hint">Repeatedly undeliverable</div>
            </div>
            <div className="card stat">
              <div className="stat-label">Not yet contacted</div>
              <div className="stat-value">{formatNumber(stats.data.unknown)}</div>
              <div className="stat-hint">No delivery evidence yet</div>
            </div>
          </div>
        )}

        <div className="notice notice-info">
          <strong>About “reachable on WhatsApp”</strong>
          WhatsApp offers no way to check whether a number has an account — Meta retired that endpoint in October 2025
          and never replaced it. A number is only proven reachable once a message to it is delivered, or the person
          replies. Until then it shows as “not yet contacted”, and the import only guarantees the number is validly
          formatted.
        </div>

        <div className="card">
          <div className="card-head">
            <form method="GET" style={{ display: "flex", gap: 8, flex: 1, flexWrap: "wrap" }}>
              <input
                type="search"
                name="q"
                placeholder="Search name, number, organisation, email…"
                defaultValue={sp.q ?? ""}
                style={{ flex: "1 1 220px", minWidth: 180 }}
              />
              <select name="groupId" defaultValue={sp.groupId ?? ""} style={{ width: 170 }}>
                <option value="">All groups</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({formatNumber(g.memberCount)})
                  </option>
                ))}
              </select>
              <select name="tagId" defaultValue={sp.tagId ?? ""} style={{ width: 160 }}>
                <option value="">All labels</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({formatNumber(t.contactCount)})
                  </option>
                ))}
              </select>
              <select name="deliverability" defaultValue={sp.deliverability ?? ""} style={{ width: 160 }}>
                <option value="">All states</option>
                <option value="deliverable">Reachable</option>
                <option value="unknown">Not yet contacted</option>
                <option value="suspect">Suspect</option>
                <option value="invalid">Invalid</option>
              </select>
              <button type="submit" className="btn">
                Filter
              </button>
              {filtered && (
                <Link href="/contacts" className="btn">
                  Reset
                </Link>
              )}
            </form>
            {list.ok && <span className="sub nowrap">{formatNumber(list.data.total)} contacts</span>}
          </div>

          {!list.ok ? (
            <div className="card-pad">
              <div className="notice notice-danger mb-0">
                <strong>Cannot load contacts</strong>
                {list.error}
              </div>
            </div>
          ) : list.data.contacts.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">☰</div>
              <h3>{filtered ? "No matching contacts" : "No contacts yet"}</h3>
              <p>
                {filtered
                  ? "Try a different search term, group or label."
                  : "Import a CSV to add people in bulk, or add one by hand to get started."}
              </p>
              {filtered ? (
                <Link href="/contacts" className="btn mt-16">
                  Clear filters
                </Link>
              ) : (
                <Link href="/contacts/import" className="btn btn-primary mt-16">
                  Import a CSV
                </Link>
              )}
            </div>
          ) : (
            <>
              <ContactsTable
                rows={list.data.contacts}
                total={list.data.total}
                groups={groups}
                tags={tags}
                filter={filter}
              />

              {list.data.total > list.data.pageSize && (
                <div className="card-pad flex-between">
                  <span className="muted small">
                    Page {list.data.page} of {Math.ceil(list.data.total / list.data.pageSize)}
                  </span>
                  <div className="flex gap-6">
                    {page > 1 && (
                      <Link
                        href={`/contacts?${new URLSearchParams({ ...sp, page: String(page - 1) }).toString()}`}
                        className="btn btn-sm"
                      >
                        Previous
                      </Link>
                    )}
                    {page * list.data.pageSize < list.data.total && (
                      <Link
                        href={`/contacts?${new URLSearchParams({ ...sp, page: String(page + 1) }).toString()}`}
                        className="btn btn-sm"
                      >
                        Next
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
