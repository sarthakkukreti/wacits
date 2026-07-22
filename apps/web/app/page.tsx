import Link from "next/link";
import { apiSafe } from "../lib/api";
import { formatDateTime, formatNumber, formatPercent } from "../lib/format";

export const dynamic = "force-dynamic";

type Dashboard = {
  windowDays: number;
  contacts: { total: number; deliverable: number; suspect: number; optedOut: number };
  messages: {
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    received: number;
    deliveryRate: number | null;
    readRate: number | null;
  };
  conversations: { open: number; unread: number };
  recentCampaigns: {
    id: string;
    name: string;
    state: string;
    countQueued: number;
    countSent: number;
    countDelivered: number;
    countFailed: number;
    createdAt: string;
  }[];
  senderNumbers: {
    id: string;
    displayPhoneNumber: string;
    displayName: string;
    qualityRating: string;
    connectionStatus: string;
  }[];
  daily: { day: string; outbound: number; inbound: number }[];
};

const QUALITY_BADGE: Record<string, string> = {
  green: "badge-ok",
  yellow: "badge-warn",
  red: "badge-danger",
  unknown: "badge-muted",
};

export const CAMPAIGN_BADGE: Record<string, string> = {
  draft: "badge-muted",
  pending_approval: "badge-warn",
  queued: "badge-info",
  scheduled: "badge-info",
  running: "badge-info",
  paused: "badge-warn",
  completed: "badge-ok",
  partially_delivered: "badge-warn",
  stopped_by_meta: "badge-danger",
  failed: "badge-danger",
  cancelled: "badge-muted",
};

export default async function DashboardPage() {
  const result = await apiSafe<Dashboard>("/workspace/dashboard?days=30");

  if (!result.ok) {
    return (
      <>
        <div className="topbar">
          <h1>Dashboard</h1>
        </div>
        <div className="content">
          <div className="notice notice-danger">
            <strong>Cannot reach the API</strong>
            {result.error}
          </div>
          <p className="muted small">
            Check that the API container is running and that <code>API_BASE_URL</code> and{" "}
            <code>API_SHARED_SECRET</code> are set correctly for this web app.
          </p>
        </div>
      </>
    );
  }

  const d = result.data;
  const hasSender = d.senderNumbers.length > 0;
  const maxDaily = Math.max(1, ...d.daily.map((x) => Math.max(x.outbound, x.inbound)));

  // The API only returns days that actually had traffic. Pad the series out
  // to the full window so a single busy day renders as one bar in a 30-day
  // chart, rather than one bar stretched across the entire width.
  const byDay = new Map(d.daily.map((x) => [x.day, x]));
  const series = Array.from({ length: d.windowDays }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (d.windowDays - 1 - i));
    const key = date.toISOString().slice(0, 10);
    return byDay.get(key) ?? { day: key, outbound: 0, inbound: 0 };
  });

  return (
    <>
      <div className="topbar">
        <h1>Dashboard</h1>
        <div className="topbar-actions">
          <Link href="/inbox/new" className="btn">
            New chat
          </Link>
          <Link href="/campaigns/new" className="btn btn-primary">
            New campaign
          </Link>
        </div>
      </div>

      <div className="content">
        {!hasSender && (
          <div className="notice notice-warn">
            <strong>No WhatsApp sender number connected yet</strong>
            Nothing can be sent until a registered number is added. Once you finish registering your number in Meta,
            add it under <Link href="/settings">Settings</Link>.
          </div>
        )}

        <div className="grid grid-4 mb-16">
          <div className="card stat">
            <div className="stat-label">Contacts</div>
            <div className="stat-value">{formatNumber(d.contacts.total)}</div>
            <div className="stat-hint">
              {formatNumber(d.contacts.optedOut)} opted out · {formatNumber(d.contacts.suspect)} suspect
            </div>
          </div>

          <div className="card stat">
            <div className="stat-label">Sent · {d.windowDays}d</div>
            <div className="stat-value">{formatNumber(d.messages.sent)}</div>
            <div className="stat-hint">
              {d.messages.deliveryRate === null
                ? "No sends yet"
                : `${formatPercent(d.messages.deliveryRate)} delivered`}
            </div>
          </div>

          <div className="card stat">
            <div className="stat-label">Received · {d.windowDays}d</div>
            <div className="stat-value">{formatNumber(d.messages.received)}</div>
            <div className="stat-hint">{formatNumber(d.conversations.open)} open conversations</div>
          </div>

          <div className="card stat">
            <div className="stat-label">Unread</div>
            <div className="stat-value">{formatNumber(d.conversations.unread)}</div>
            <div className="stat-hint">
              {d.conversations.unread > 0 ? <Link href="/inbox">Open the inbox →</Link> : "All caught up"}
            </div>
          </div>
        </div>

        <div className="grid grid-2 mb-16">
          <div className="card">
            <div className="card-head">
              <h2>Message volume</h2>
              <span className="sub">Last {d.windowDays} days</span>
            </div>
            <div className="card-pad">
              {d.messages.sent === 0 && d.messages.received === 0 ? (
                <p className="muted small mb-0">No messages in this period yet.</p>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 110 }}>
                    {series.map((day) => (
                      <div
                        key={day.day}
                        title={`${day.day}: ${day.outbound} sent, ${day.inbound} received`}
                        style={{
                          flex: 1,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "flex-end",
                          gap: 1,
                        }}
                      >
                        <div
                          style={{
                            height: `${(day.outbound / maxDaily) * 80}px`,
                            background: "var(--brand-light)",
                            borderRadius: "2px 2px 0 0",
                            minHeight: day.outbound ? 2 : 0,
                          }}
                        />
                        <div
                          style={{
                            height: `${(day.inbound / maxDaily) * 80}px`,
                            background: "var(--accent)",
                            minHeight: day.inbound ? 2 : 0,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-10 mt-8 small muted">
                    <span>
                      <span
                        style={{
                          display: "inline-block",
                          width: 9,
                          height: 9,
                          background: "var(--brand-light)",
                          borderRadius: 2,
                          marginRight: 5,
                        }}
                      />
                      Sent
                    </span>
                    <span>
                      <span
                        style={{
                          display: "inline-block",
                          width: 9,
                          height: 9,
                          background: "var(--accent)",
                          borderRadius: 2,
                          marginRight: 5,
                        }}
                      />
                      Received
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Delivery breakdown</h2>
              <span className="sub">Last {d.windowDays} days</span>
            </div>
            <div className="card-pad">
              {d.messages.sent === 0 ? (
                <p className="muted small mb-0">Nothing has been sent yet, so there are no delivery rates to report.</p>
              ) : (
                <>
                  <div className="bar mb-16">
                    <div
                      className="bar-seg"
                      style={{ width: `${(d.messages.read / d.messages.sent) * 100}%`, background: "var(--ok)" }}
                    />
                    <div
                      className="bar-seg"
                      style={{
                        width: `${((d.messages.delivered - d.messages.read) / d.messages.sent) * 100}%`,
                        background: "var(--accent)",
                      }}
                    />
                    <div
                      className="bar-seg"
                      style={{ width: `${(d.messages.failed / d.messages.sent) * 100}%`, background: "var(--danger)" }}
                    />
                  </div>
                  <table className="table">
                    <tbody>
                      <tr>
                        <td>Delivered</td>
                        <td className="text-right">{formatNumber(d.messages.delivered)}</td>
                        <td className="text-right muted">{formatPercent(d.messages.deliveryRate)}</td>
                      </tr>
                      <tr>
                        <td>Read</td>
                        <td className="text-right">{formatNumber(d.messages.read)}</td>
                        <td className="text-right muted">{formatPercent(d.messages.readRate)}</td>
                      </tr>
                      <tr>
                        <td>Failed</td>
                        <td className="text-right">{formatNumber(d.messages.failed)}</td>
                        <td className="text-right muted">
                          {formatPercent(d.messages.sent ? d.messages.failed / d.messages.sent : null)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <h2>Recent campaigns</h2>
              <Link href="/campaigns" className="sub">
                View all →
              </Link>
            </div>
            {d.recentCampaigns.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">◈</div>
                <h3>No campaigns yet</h3>
                <p>A campaign sends an approved template to a list of contacts.</p>
                <Link href="/campaigns/new" className="btn btn-primary mt-16">
                  Create one
                </Link>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>State</th>
                      <th className="text-right">Sent</th>
                      <th className="text-right">Delivered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recentCampaigns.map((camp) => (
                      <tr key={camp.id}>
                        <td>
                          <Link href={`/campaigns/${camp.id}`}>
                            <strong>{camp.name}</strong>
                          </Link>
                          <div className="faint small">{formatDateTime(camp.createdAt)}</div>
                        </td>
                        <td>
                          <span className={`badge ${CAMPAIGN_BADGE[camp.state] ?? "badge-muted"}`}>
                            {camp.state.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="text-right">
                          {formatNumber(camp.countSent)}
                          <span className="faint"> / {formatNumber(camp.countQueued)}</span>
                        </td>
                        <td className="text-right">{formatNumber(camp.countDelivered)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Sender numbers</h2>
              <Link href="/settings" className="sub">
                Manage →
              </Link>
            </div>
            {d.senderNumbers.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">☎</div>
                <h3>No number connected</h3>
                <p>Add your registered WhatsApp Business number to start sending.</p>
                <Link href="/settings" className="btn btn-primary mt-16">
                  Add a number
                </Link>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>Quality</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.senderNumbers.map((n) => (
                      <tr key={n.id}>
                        <td>
                          <strong>{n.displayName}</strong>
                          <div className="faint mono">{n.displayPhoneNumber}</div>
                        </td>
                        <td>
                          <span className={`badge ${QUALITY_BADGE[n.qualityRating] ?? "badge-muted"}`}>
                            {n.qualityRating}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${n.connectionStatus === "connected" ? "badge-ok" : "badge-danger"}`}>
                            {n.connectionStatus}
                          </span>
                        </td>
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
