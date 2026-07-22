import Link from "next/link";
import { apiSafe } from "../../lib/api";
import { formatDateTime, formatNumber } from "../../lib/format";
import { AddContactDialog } from "../../components/AddContactDialog";

export const dynamic = "force-dynamic";

type Contact = {
  id: string;
  phoneNumber: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  organization: string | null;
  deliverabilityState: string;
  marketingConsentState: string;
  createdAt: string;
  lastInboundAt: string | null;
};

const DELIVERABILITY_BADGE: Record<string, string> = {
  deliverable: "badge-ok",
  suspect: "badge-warn",
  invalid: "badge-danger",
  unknown: "badge-muted",
};

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; deliverability?: string }>;
}) {
  const sp = await searchParams;
  const page = Number(sp.page ?? 1);

  const query = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (sp.q) query.set("q", sp.q);
  if (sp.deliverability) query.set("deliverability", sp.deliverability);

  const [list, stats] = await Promise.all([
    apiSafe<{ contacts: Contact[]; total: number; page: number; pageSize: number }>(
      `/workspace/contacts?${query.toString()}`,
    ),
    apiSafe<{ total: number; deliverable: number; suspect: number; invalid: number; unknown: number }>(
      "/workspace/contacts/stats",
    ),
  ]);

  return (
    <>
      <div className="topbar">
        <h1>Contacts</h1>
        <div className="topbar-actions">
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
            <form method="GET" style={{ display: "flex", gap: 8, flex: 1, maxWidth: 520 }}>
              <input
                type="search"
                name="q"
                placeholder="Search name, number, organisation, email…"
                defaultValue={sp.q ?? ""}
              />
              <select name="deliverability" defaultValue={sp.deliverability ?? ""} style={{ width: 170 }}>
                <option value="">All states</option>
                <option value="deliverable">Reachable</option>
                <option value="unknown">Not yet contacted</option>
                <option value="suspect">Suspect</option>
                <option value="invalid">Invalid</option>
              </select>
              <button type="submit" className="btn">
                Search
              </button>
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
              <h3>{sp.q ? "No matching contacts" : "No contacts yet"}</h3>
              <p>
                {sp.q
                  ? "Try a different search term."
                  : "Import a CSV to add people in bulk, or add one by hand to get started."}
              </p>
              {!sp.q && (
                <Link href="/contacts/import" className="btn btn-primary mt-16">
                  Import a CSV
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Number</th>
                      <th>Organisation</th>
                      <th>Reachability</th>
                      <th>Consent</th>
                      <th>Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.contacts.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/contacts/${c.id}`}>
                            <strong>{[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}</strong>
                          </Link>
                          {c.email && <div className="faint small">{c.email}</div>}
                        </td>
                        <td className="mono nowrap">{c.phoneNumber}</td>
                        <td>{c.organization ?? <span className="faint">—</span>}</td>
                        <td>
                          <span className={`badge ${DELIVERABILITY_BADGE[c.deliverabilityState] ?? "badge-muted"}`}>
                            {c.deliverabilityState === "unknown" ? "not contacted" : c.deliverabilityState}
                          </span>
                        </td>
                        <td>
                          {c.marketingConsentState === "opted_out" ? (
                            <span className="badge badge-danger">opted out</span>
                          ) : c.marketingConsentState === "opted_in" ? (
                            <span className="badge badge-ok">opted in</span>
                          ) : (
                            <span className="badge badge-muted">unknown</span>
                          )}
                        </td>
                        <td className="faint small nowrap">{formatDateTime(c.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

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
