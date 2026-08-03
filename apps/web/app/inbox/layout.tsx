import Link from "next/link";
import { apiSafe } from "../../lib/api";
import { ConversationList } from "../../components/ConversationList";

export const dynamic = "force-dynamic";

type ConversationSummary = {
  id: string;
  displayName: string;
  phoneNumber: string;
  state: string;
  unreadCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
  /** Set the first time this contact replies; null if they never have. */
  lastInboundAt: string | null;
};

export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const result = await apiSafe<{ conversations: ConversationSummary[] }>("/workspace/inbox/conversations?pageSize=100");

  return (
    <>
      <div className="topbar">
        <h1>Inbox</h1>
        <div className="topbar-actions">
          <Link href="/inbox/new" className="btn btn-primary">
            New chat
          </Link>
        </div>
      </div>

      <div className="content-flush">
        <div className="inbox">
          {result.ok ? (
            <ConversationList conversations={result.data.conversations} />
          ) : (
            <div className="inbox-list">
              <div className="card-pad">
                <div className="notice notice-danger mb-0">
                  <strong>Cannot load conversations</strong>
                  {result.error}
                </div>
              </div>
            </div>
          )}
          {children}
        </div>
      </div>
    </>
  );
}
