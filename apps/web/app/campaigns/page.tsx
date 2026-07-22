import Link from "next/link";
import { apiSafe } from "../../lib/api";
import { formatDateTime, formatNumber } from "../../lib/format";
import { CAMPAIGN_BADGE } from "../page";

export const dynamic = "force-dynamic";

type Campaign = {
  id: string;
  name: string;
  state: string;
  countQueued: number;
  countSent: number;
  countDelivered: number;
  countRead: number;
  countFailed: number;
  createdAt: string;
  templateName: string | null;
  templateLanguage: string | null;
};

export default async function CampaignsPage() {
  const result = await apiSafe<{ campaigns: Campaign[] }>("/workspace/campaigns");

  return (
    <>
      <div className="topbar">
        <h1>Campaigns</h1>
        <div className="topbar-actions">
          <Link href="/campaigns/new" className="btn btn-primary">
            New campaign
          </Link>
        </div>
      </div>

      <div className="content">
        {!result.ok ? (
          <div className="notice notice-danger">
            <strong>Cannot load campaigns</strong>
            {result.error}
          </div>
        ) : result.data.campaigns.length === 0 ? (
          <div className="card">
            <div className="empty">
              <div className="empty-icon">◈</div>
              <h3>No campaigns yet</h3>
              <p>
                A campaign sends one approved WhatsApp template to a list of contacts, then tracks delivery for every
                recipient.
              </p>
              <Link href="/campaigns/new" className="btn btn-primary mt-16">
                Create a campaign
              </Link>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Template</th>
                    <th>State</th>
                    <th className="text-right">Audience</th>
                    <th className="text-right">Sent</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.campaigns.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/campaigns/${c.id}`}>
                          <strong>{c.name}</strong>
                        </Link>
                        <div className="faint small">{formatDateTime(c.createdAt)}</div>
                      </td>
                      <td className="small">
                        {c.templateName ?? <span className="faint">—</span>}
                        {c.templateLanguage && <span className="faint"> ({c.templateLanguage})</span>}
                      </td>
                      <td>
                        <span className={`badge ${CAMPAIGN_BADGE[c.state] ?? "badge-muted"}`}>
                          {c.state.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="text-right">{formatNumber(c.countQueued)}</td>
                      <td className="text-right">{formatNumber(c.countSent)}</td>
                      <td className="text-right">{formatNumber(c.countDelivered)}</td>
                      <td className="text-right">
                        {c.countFailed > 0 ? (
                          <span className="badge badge-danger">{formatNumber(c.countFailed)}</span>
                        ) : (
                          <span className="faint">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
