import Link from "next/link";

export default function InboxIndexPage() {
  return (
    <div className="thread">
      <div className="empty" style={{ margin: "auto" }}>
        <div className="empty-icon">✉</div>
        <h3>Select a conversation</h3>
        <p>
          Pick a conversation from the list, or start a new one by entering a phone number with its country code.
        </p>
        <Link href="/inbox/new" className="btn btn-primary mt-16">
          New chat
        </Link>
      </div>
    </div>
  );
}
