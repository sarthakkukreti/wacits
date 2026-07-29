import Link from "next/link";
import { apiSafe } from "../../lib/api";
import { formatNumber } from "../../lib/format";
import { MessageLogTable, type LogRow } from "../../components/MessageLogTable";

export const dynamic = "force-dynamic";

/** Outbound lifecycle first, then the inbound-only bucket. `skipped` is
 *  included because "why did this person not get it" is the same question
 *  as "why did it fail" from an operator's point of view. */
const STATUSES = [
  { value: "", label: "All" },
  { value: "delivered", label: "Delivered" },
  { value: "read", label: "Read" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
  { value: "pending", label: "Pending" },
  { value: "received", label: "Received" },
];

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    direction?: string;
    campaignId?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Number(sp.page ?? 1);

  const query = new URLSearchParams({ page: String(page), pageSize: "50" });
  for (const key of ["status", "direction", "campaignId", "q"] as const) {
    if (sp[key]) query.set(key, sp[key]!);
  }
  const statsQuery = new URLSearchParams(query);
  statsQuery.delete("status");

  const [log, stats, campaigns] = await Promise.all([
    apiSafe<{ messages: LogRow[]; total: number; page: number; pageSize: number }>(
      `/workspace/messages?${query.toString()}`,
    ),
    apiSafe<{ byStatus: Record<string, number>; total: number; resendEligibleCount: number | null }>(
      `/workspace/messages/stats?${statsQuery.toString()}`,
    ),
    apiSafe<{ campaigns: { id: string; name: string }[] }>("/workspace/campaigns"),
  ]);

  const byStatus = stats.ok ? stats.data.byStatus : {};
  const filtered = Boolean(sp.status || sp.direction || sp.campaignId || sp.q);

  return (
    <>
      <div className="topbar">
        <h1>Message log</h1>
      </div>

      <div className="content">
        <div className="card">
          <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <form method="GET" style={{ display: "flex", gap: 8, flex: 1, flexWrap: "wrap" }}>
              {/* Preserved so switching status doesn't silently drop the
                  other filters the operator already set. */}
              {sp.status && <input type="hidden" name="status" value={sp.status} />}
              <input
                type="search"
                name="q"
                placeholder="Search name or number…"
                defaultValue={sp.q ?? ""}
                style={{ flex: "1 1 200px", minWidth: 170 }}
              />
              <select name="campaignId" defaultValue={sp.campaignId ?? ""} style={{ width: 200 }}>
                <option value="">All campaigns</option>
                {campaigns.ok &&
                  campaigns.data.campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <select name="direction" defaultValue={sp.direction ?? ""} style={{ width: 150 }}>
                <option value="">Both directions</option>
                <option value="outbound">Outbound</option>
                <option value="inbound">Inbound</option>
              </select>
              <button type="submit" className="btn">
                Filter
              </button>
              {filtered && (
                <Link href="/messages" className="btn">
                  Reset
                </Link>
              )}
            </form>
            {log.ok && <span className="sub nowrap">{formatNumber(log.data.total)} messages</span>}
          </div>

          <div className="card-pad" style={{ paddingTop: 0, paddingBottom: 10 }}>
            <div className="chips">
              {STATUSES.map((s) => {
                const active = (sp.status ?? "") === s.value;
                const next = new URLSearchParams();
                for (const key of ["direction", "campaignId", "q"] as const) {
                  if (sp[key]) next.set(key, sp[key]!);
                }
                if (s.value) next.set("status", s.value);
                const n = s.value ? byStatus[s.value] : stats.ok ? stats.data.total : undefined;
                return (
                  <Link
                    key={s.value || "all"}
                    href={`/messages${next.toString() ? `?${next}` : ""}`}
                    className={`chip ${active ? "chip-active" : ""}`}
                  >
                    <span>{s.label}</span>
                    {n !== undefined && <span className="faint">{formatNumber(n)}</span>}
                  </Link>
                );
              })}
            </div>
          </div>

          {!log.ok ? (
            <div className="card-pad">
              <div className="notice notice-danger mb-0">
                <strong>Cannot load the message log</strong>
                {log.error}
              </div>
            </div>
          ) : log.data.messages.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">✉</div>
              <h3>{filtered ? "No messages match these filters" : "No messages yet"}</h3>
              <p>
                {filtered
                  ? "Try a different status, campaign, or search term."
                  : "Once a campaign runs or a conversation starts, every message and its outcome shows up here."}
              </p>
              {filtered && (
                <Link href="/messages" className="btn mt-16">
                  Clear filters
                </Link>
              )}
            </div>
          ) : (
            <>
              <MessageLogTable
                rows={log.data.messages}
                total={log.data.total}
                campaignId={sp.campaignId}
                campaignEligibleCount={stats.ok ? stats.data.resendEligibleCount : null}
              />

              {log.data.total > log.data.pageSize && (
                <div className="card-pad flex-between">
                  <span className="muted small">
                    Page {log.data.page} of {Math.ceil(log.data.total / log.data.pageSize)}
                  </span>
                  <div className="flex gap-6">
                    {page > 1 && (
                      <Link
                        href={`/messages?${new URLSearchParams({ ...sp, page: String(page - 1) })}`}
                        className="btn btn-sm"
                      >
                        Previous
                      </Link>
                    )}
                    {page * log.data.pageSize < log.data.total && (
                      <Link
                        href={`/messages?${new URLSearchParams({ ...sp, page: String(page + 1) })}`}
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
