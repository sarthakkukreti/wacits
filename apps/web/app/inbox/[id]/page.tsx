import Link from "next/link";
import { apiSafe } from "../../../lib/api";
import { Chat, type ChatMessage, type ServiceWindow } from "../../../components/Chat";
import { ConversationActions } from "../../../components/ConversationActions";

export const dynamic = "force-dynamic";

type ThreadResponse = {
  conversation: {
    id: string;
    displayName: string;
    phoneNumber: string;
    state: string;
    contactId: string;
    organization: string | null;
    deliverabilityState: string;
    marketingConsentState: string;
  };
  messages: ChatMessage[];
  notes: { id: string; body: string; createdAt: string }[];
  serviceWindow: ServiceWindow;
};

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ blocked?: string }>;
}) {
  const { id } = await params;
  const { blocked } = await searchParams;

  const [thread, templates] = await Promise.all([
    apiSafe<ThreadResponse>(`/workspace/inbox/conversations/${id}`),
    apiSafe<{
      templates: { id: string; name: string; language: string; status: string; components: any }[];
    }>("/workspace/templates?approved=true"),
  ]);

  if (!thread.ok) {
    return (
      <div className="thread">
        <div className="content">
          <div className="notice notice-danger">
            <strong>Cannot load this conversation</strong>
            {thread.error}
          </div>
          <Link href="/inbox" className="btn">
            Back to inbox
          </Link>
        </div>
      </div>
    );
  }

  const { conversation, messages, serviceWindow } = thread.data;

  return (
    <div className="thread">
      <div className="thread-head">
        <div style={{ minWidth: 0 }}>
          <div className="flex gap-6" style={{ alignItems: "center" }}>
            <strong>{conversation.displayName}</strong>
            {conversation.marketingConsentState === "opted_out" && (
              <span className="badge badge-danger">Opted out</span>
            )}
            {conversation.deliverabilityState === "suspect" && <span className="badge badge-warn">Suspect</span>}
          </div>
          <div className="faint small mono">
            {conversation.phoneNumber}
            {conversation.organization ? ` · ${conversation.organization}` : ""}
          </div>
        </div>

        <div className="flex gap-6" style={{ alignItems: "center" }}>
          <Link href={`/contacts/${conversation.contactId}`} className="btn btn-sm">
            Contact
          </Link>
          <ConversationActions conversationId={conversation.id} state={conversation.state} />
        </div>
      </div>

      <Chat
        conversationId={conversation.id}
        initialMessages={messages}
        initialWindow={serviceWindow}
        templates={templates.ok ? templates.data.templates : []}
        blockedNotice={blocked}
      />
    </div>
  );
}
