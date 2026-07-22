import Link from "next/link";
import { apiSafe } from "../../../lib/api";
import { formatDateTime, formatNumber, formatPercent } from "../../../lib/format";
import { CampaignControls } from "../../../components/CampaignControls";
import { CAMPAIGN_BADGE } from "../../page";

export const dynamic = "force-dynamic";

type CampaignDetail = {
  id: string;
  name: string;
  state: string;
  countQueued: number;
  countSent: number;
  countDelivered: number;
  countRead: number;
  countFailed: number;
  pauseReason: string | null;
  stopReason: string | null;
  createdAt: string;
  templateName: string | null;
  templateLanguage: string | null;
  snapshot: { resolvedContactCount: number; suppressedCount: number } | null;
  breakdown: Record<string, number>;
  failures: { errorCode: string; count: number }[];
};

const STATE_LABEL: Record<string, string> = {
  pending: "Waiting to send",
  queued: "Queued at WhatsApp",
  accepted: "Accepted by WhatsApp",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
  skipped: "Skipped",
  held: "Held",
};

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await apiSafe<CampaignDetail>(`/workspace/campaigns/${id}`);

  if (!result.ok) {
    return (
      <>
        <div className="topbar">
          <h1>Campaign</h1>
        </div>
        <div className="content">
          <div className="notice notice-danger">
            <strong>Cannot load this campaign</strong>
            {result.error}
          </div>
          <Link href="/campaigns" className="btn">
            Back to campaigns
          </Link>
        </div>
      </>
    );
  }

  const c = result.data;
  const total = c.countQueued || 1;
  const progressed = c.countSent + c.countFailed;

  return (
    <>
      <div className="topbar">
        <h1>{c.name}</h1>
        <div className="topbar-actions">
          <Link href="/campaigns" className="btn">
            Back
          </Link>
          <CampaignControls id={c.id} state={c.state} recipientCount={c.countQueued} />
        </div>
      </div>

      <div className="content">
        <div className="flex gap-10 mb-16" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <span className={`badge ${CAMPAIGN_BADGE[c.state] ?? "badge-muted"}`}>{c.state.replace(/_/g, " ")}</span>
          <span className="muted small">
            {c.templateName ? `Template: ${c.templateName} (${c.templateLanguage})` : "No template"}
          </span>
          <span className="faint small">Created {formatDateTime(c.createdAt)}</span>
        </div>

        {c.state === "draft" && (
          <div className="notice notice-info">
            <strong>This campaign has not been sent yet</strong>
            {formatNumber(c.countQueued)} recipients are queued in the outbox. Review the numbers below, then press
            Launch. Sending cannot be undone once it starts.
          </div>
        )}

        {c.state === "paused" && c.pauseReason && (
          <div className="notice notice-warn">
            <strong>Paused</strong>
            {c.pauseReason}
          </div>
        )}

        {c.state === "stopped_by_meta" && (
          <div className="notice notice-danger">
            <strong>Stopped by WhatsApp</strong>
            {c.stopReason ?? "Meta stopped the remaining queue."} This is portfolio pacing, not a fault in your list —
            the rest of the messages were not sent.
          </div>
        )}

        <div className="grid grid-4 mb-16">
          <div className="card stat">
            <div className="stat-label">Audience</div>
            <div className="stat-value">{formatNumber(c.countQueued)}</div>
            {c.snapshot && c.snapshot.suppressedCount > 0 && (
              <div className="stat-hint">{formatNumber(c.snapshot.suppressedCount)} opted-out numbers excluded</div>
            )}
          </div>
          <div className="card stat">
            <div className="stat-label">Sent</div>
            <div className="stat-value">{formatNumber(c.countSent)}</div>
            <div className="stat-hint">{formatPercent(c.countQueued ? c.countSent / c.countQueued : null)}</div>
          </div>
          <div className="card stat">
            <div className="stat-label">Delivered</div>
            <div className="stat-value">{formatNumber(c.countDelivered)}</div>
            <div className="stat-hint">{formatPercent(c.countSent ? c.countDelivered / c.countSent : null)}</div>
          </div>
          <div className="card stat">
            <div className="stat-label">Failed</div>
            <div className="stat-value" style={{ color: c.countFailed ? "var(--danger)" : undefined }}>
              {formatNumber(c.countFailed)}
            </div>
            <div className="stat-hint">{formatPercent(c.countQueued ? c.countFailed / c.countQueued : null)}</div>
          </div>
        </div>

        {progressed > 0 && (
          <div className="card card-pad mb-16">
            <div className="flex-between mb-8">
              <strong style={{ fontSize: 13 }}>Progress</strong>
              <span className="muted small">
                {formatNumber(progressed)} of {formatNumber(c.countQueued)} processed
              </span>
            </div>
            <div className="bar">
              <div
                className="bar-seg"
                style={{ width: `${(c.countRead / total) * 100}%`, background: "var(--ok)" }}
                title={`${c.countRead} read`}
              />
              <div
                className="bar-seg"
                style={{
                  width: `${((c.countDelivered - c.countRead) / total) * 100}%`,
                  background: "var(--accent)",
                }}
                title={`${c.countDelivered - c.countRead} delivered`}
              />
              <div
                className="bar-seg"
                style={{
                  width: `${((c.countSent - c.countDelivered) / total) * 100}%`,
                  background: "var(--brand-light)",
                }}
                title={`${c.countSent - c.countDelivered} sent`}
              />
              <div
                className="bar-seg"
                style={{ width: `${(c.countFailed / total) * 100}%`, background: "var(--danger)" }}
                title={`${c.countFailed} failed`}
              />
            </div>
          </div>
        )}

        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <h2>Recipient states</h2>
            </div>
            {Object.keys(c.breakdown).length === 0 ? (
              <div className="card-pad">
                <p className="muted small mb-0">No recipients yet.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {Object.entries(c.breakdown)
                      .sort((a, b) => b[1] - a[1])
                      .map(([state, count]) => (
                        <tr key={state}>
                          <td>{STATE_LABEL[state] ?? state}</td>
                          <td className="text-right">
                            <strong>{formatNumber(count)}</strong>
                          </td>
                          <td className="text-right muted" style={{ width: 70 }}>
                            {formatPercent(count / total)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Failures by reason</h2>
              {c.countFailed > 0 && (
                <Link href={`/campaigns/${c.id}/recipients?state=failed`} className="sub">
                  See who →
                </Link>
              )}
            </div>
            {c.failures.length === 0 ? (
              <div className="card-pad">
                <p className="muted small mb-0">No failures.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Meta error</th>
                      <th className="text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.failures.map((f) => (
                      <tr key={f.errorCode}>
                        <td className="mono">{f.errorCode}</td>
                        <td className="text-right">{formatNumber(f.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
