import Link from "next/link";
import { apiSafe } from "../../../lib/api";
import { CampaignBuilder } from "../../../components/CampaignBuilder";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const [templates, groups, stats] = await Promise.all([
    apiSafe<{
      templates: { id: string; name: string; language: string; status: string; latestVersionId: string | null; components: any }[];
    }>("/workspace/templates?approved=true"),
    apiSafe<{ groups: { id: string; name: string; memberCount: number }[] }>("/workspace/contacts/meta/groups"),
    apiSafe<{ total: number }>("/workspace/contacts/stats"),
  ]);

  const approved = templates.ok ? templates.data.templates.filter((t) => t.latestVersionId) : [];

  return (
    <>
      <div className="topbar">
        <h1>New campaign</h1>
        <div className="topbar-actions">
          <Link href="/campaigns" className="btn">
            Cancel
          </Link>
        </div>
      </div>

      <div className="content">
        <div style={{ maxWidth: 780 }}>
          {approved.length === 0 ? (
            <div className="card">
              <div className="empty">
                <div className="empty-icon">▤</div>
                <h3>No approved templates available</h3>
                <p>
                  WhatsApp requires an approved template for any message that starts a conversation. Create one in
                  Meta&apos;s WhatsApp Manager, wait for approval, then sync it here.
                </p>
                <Link href="/templates" className="btn btn-primary mt-16">
                  Go to templates
                </Link>
              </div>
            </div>
          ) : (
            <CampaignBuilder
              templates={approved}
              groups={groups.ok ? groups.data.groups : []}
              totalContacts={stats.ok ? stats.data.total : 0}
            />
          )}
        </div>
      </div>
    </>
  );
}
