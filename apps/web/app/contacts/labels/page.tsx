import Link from "next/link";
import { apiSafe } from "../../../lib/api";
import { LabelManager } from "../../../components/LabelManager";

export const dynamic = "force-dynamic";

export default async function LabelsPage() {
  const [groupList, tagList] = await Promise.all([
    apiSafe<{ groups: { id: string; name: string; description: string | null; memberCount: number }[] }>(
      "/workspace/contacts/meta/groups",
    ),
    apiSafe<{ tags: { id: string; name: string; color: string | null; contactCount: number }[] }>(
      "/workspace/contacts/meta/tags",
    ),
  ]);

  return (
    <>
      <div className="topbar">
        <h1>Groups &amp; labels</h1>
        <div className="topbar-actions">
          <Link href="/contacts" className="btn">
            Back to contacts
          </Link>
        </div>
      </div>

      <div className="content">
        {(!groupList.ok || !tagList.ok) && (
          <div className="notice notice-danger">
            <strong>Cannot load labels</strong>
            {!groupList.ok ? groupList.error : !tagList.ok ? tagList.error : null}
          </div>
        )}

        <div className="notice notice-info">
          <strong>Groups vs labels</strong>
          Both survive an import and both can be targeted by a campaign. Use a <em>group</em> for the fixed answer to
          “whose contact is this” — one client, one group. Use a <em>label</em> for anything a contact can have several
          of at once. Deleting either only removes the labelling; the contacts stay.
        </div>

        <LabelManager groups={groupList.ok ? groupList.data.groups : []} tags={tagList.ok ? tagList.data.tags : []} />
      </div>
    </>
  );
}
