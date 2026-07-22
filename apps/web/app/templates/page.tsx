import { apiSafe } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { SyncTemplatesButton } from "../../components/SyncTemplatesButton";

export const dynamic = "force-dynamic";

type Template = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  qualityScore: string;
  components: any;
  updatedAt: string;
};

const STATUS_BADGE: Record<string, string> = {
  APPROVED: "badge-ok",
  PENDING: "badge-warn",
  PAUSED: "badge-warn",
  REJECTED: "badge-danger",
  DISABLED: "badge-danger",
};

function bodyOf(components: any): string {
  const list = Array.isArray(components) ? components : [];
  return list.find((c: any) => (c?.type ?? "").toUpperCase() === "BODY")?.text ?? "";
}

export default async function TemplatesPage() {
  const result = await apiSafe<{ templates: Template[] }>("/workspace/templates");

  return (
    <>
      <div className="topbar">
        <h1>Templates</h1>
        <div className="topbar-actions">
          <SyncTemplatesButton />
        </div>
      </div>

      <div className="content">
        <div className="notice notice-info">
          <strong>Templates are created in Meta, not here</strong>
          WhatsApp requires every message that starts a conversation to use a template Meta has approved. Write and
          submit them in WhatsApp Manager, then press “Sync from Meta” to pull their current approval status in.
        </div>

        {!result.ok ? (
          <div className="notice notice-danger">
            <strong>Cannot load templates</strong>
            {result.error}
          </div>
        ) : result.data.templates.length === 0 ? (
          <div className="card">
            <div className="empty">
              <div className="empty-icon">▤</div>
              <h3>No templates synced yet</h3>
              <p>
                Once you have created at least one template in Meta&apos;s WhatsApp Manager, press “Sync from Meta” to
                bring it here. Only approved templates can be used in campaigns.
              </p>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Language</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Quality</th>
                    <th>Body</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.templates.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <strong className="mono">{t.name}</strong>
                      </td>
                      <td className="faint">{t.language}</td>
                      <td>
                        <span className="badge badge-muted">{t.category}</span>
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[t.status] ?? "badge-muted"}`}>{t.status}</span>
                      </td>
                      <td className="faint small">{t.qualityScore === "UNKNOWN" ? "—" : t.qualityScore}</td>
                      <td className="small muted" style={{ maxWidth: 320 }}>
                        {bodyOf(t.components).slice(0, 120) || <span className="faint">—</span>}
                        {bodyOf(t.components).length > 120 ? "…" : ""}
                      </td>
                      <td className="faint small nowrap">{formatDateTime(t.updatedAt)}</td>
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
