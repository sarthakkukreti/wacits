import { apiSafe } from "../../../lib/api";
import { NewChatForm } from "../../../components/NewChatForm";

export const dynamic = "force-dynamic";

export default async function NewChatPage() {
  const templates = await apiSafe<{ templates: { id: string; name: string; language: string; status: string }[] }>(
    "/workspace/templates?approved=true",
  );

  return (
    <div className="thread">
      <div style={{ padding: 24, overflowY: "auto" }}>
        <div style={{ maxWidth: 560 }}>
          <h2 className="mt-0">Start a new chat</h2>
          <p className="muted">
            Enter a phone number with its country code. If this person is not already a contact, they will be added
            automatically.
          </p>

          <NewChatForm templates={templates.ok ? templates.data.templates : []} />
        </div>
      </div>
    </div>
  );
}
