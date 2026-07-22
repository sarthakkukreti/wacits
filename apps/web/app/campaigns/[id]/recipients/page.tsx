import Link from "next/link";
import { apiSafe } from "../../../../lib/api";
import { formatDateTime, formatNumber } from "../../../../lib/format";

export const dynamic = "force-dynamic";

type Recipient = {
  id: string;
  state: string;
  errorCode: string | null;
  skipReason: string | null;
  lastAttemptAt: string | null;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string;
};

const STATE_BADGE: Record<string, string> = {
  pending: "badge-muted",
  queued: "badge-info",
  accepted: "badge-info",
  sent: "badge-info",
  delivered: "badge-ok",
  read: "badge-ok",
  failed: "badge-danger",
  skipped: "badge-warn",
};

export default async function RecipientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ state?: string; page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const page = Number(sp.page ?? 1);

  const query = new URLSearchParams({ page: String(page), pageSize: "100" });
  if (sp.state) query.set("state", sp.state);

  const result = await apiSafe<{ recipients: Recipient[]; total: number; page: number; pageSize: number }>(
    `/workspace/campaigns/${id}/recipients?${query.toString()}`,
  );

  const STATES = ["", "delivered", "read", "failed", "skipped", "pending"];

  return (
    <>
      <div className="topbar">
        <h1>Recipients</h1>
        <div className="topbar-actions">
          <Link href={`/campaigns/${id}`} className="btn">
            Back to campaign
          </Link>
        </div>
      </div>

      <div className="content">
        <div className="tabs">
          {STATES.map((s) => (
            <Link
              key={s || "all"}
              href={`/campaigns/${id}/recipients${s ? `?state=${s}` : ""}`}
              className={(sp.state ?? "") === s ? "active" : ""}
            >
              {s === "" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </Link>
          ))}
        </div>

        {!result.ok ? (
          <div className="notice notice-danger">
            <strong>Cannot load recipients</strong>
            {result.error}
          </div>
        ) : result.data.recipients.length === 0 ? (
          <div className="card">
            <div className="empty">
              <h3>Nothing here</h3>
              <p>No recipients in this state.</p>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-head">
              <h2>{formatNumber(result.data.total)} recipients</h2>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Number</th>
                    <th>State</th>
                    <th>Reason</th>
                    <th>Last attempt</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.recipients.map((r) => (
                    <tr key={r.id}>
                      <td>{[r.firstName, r.lastName].filter(Boolean).join(" ") || <span className="faint">—</span>}</td>
                      <td className="mono nowrap">{r.phoneNumber}</td>
                      <td>
                        <span className={`badge ${STATE_BADGE[r.state] ?? "badge-muted"}`}>{r.state}</span>
                      </td>
                      <td className="small muted">
                        {r.errorCode ? <span className="mono">{r.errorCode}</span> : (r.skipReason ?? "—")}
                      </td>
                      <td className="faint small nowrap">{formatDateTime(r.lastAttemptAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.data.total > result.data.pageSize && (
              <div className="card-pad flex-between">
                <span className="muted small">
                  Page {page} of {Math.ceil(result.data.total / result.data.pageSize)}
                </span>
                <div className="flex gap-6">
                  {page > 1 && (
                    <Link
                      href={`/campaigns/${id}/recipients?${new URLSearchParams({ ...sp, page: String(page - 1) })}`}
                      className="btn btn-sm"
                    >
                      Previous
                    </Link>
                  )}
                  {page * result.data.pageSize < result.data.total && (
                    <Link
                      href={`/campaigns/${id}/recipients?${new URLSearchParams({ ...sp, page: String(page + 1) })}`}
                      className="btn btn-sm"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
