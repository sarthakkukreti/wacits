"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { formatRelative } from "../lib/format";

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

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "open", label: "Open" },
  { key: "replied", label: "Replies received" },
] as const;

export function ConversationList({ conversations }: { conversations: ConversationSummary[] }) {
  const params = useParams<{ id?: string }>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  // Filtering client-side keeps typing instant. The server already caps the
  // list at 100, so this stays cheap; a workspace past that would want the
  // server-side `q` parameter instead.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filter === "unread" && !c.unreadCount) return false;
      if (filter === "open" && c.state !== "open") return false;
      if (filter === "replied" && !c.lastInboundAt) return false;
      if (!q) return true;
      return (
        c.displayName.toLowerCase().includes(q) ||
        c.phoneNumber.includes(q) ||
        (c.lastMessage ?? "").toLowerCase().includes(q)
      );
    });
  }, [conversations, query, filter]);

  return (
    <div className="inbox-list">
      <div className="inbox-list-head">
        <input
          type="search"
          placeholder="Search name, number or message…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="tabs mt-8" style={{ marginBottom: 0, borderBottom: "none" }}>
          {FILTERS.map((f) => (
            <button key={f.key} className={filter === f.key ? "active" : ""} onClick={() => setFilter(f.key)} type="button">
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="inbox-list-scroll">
        {visible.length === 0 ? (
          <div className="empty" style={{ padding: "32px 18px" }}>
            <h3>{conversations.length === 0 ? "No conversations yet" : "No matches"}</h3>
            <p>
              {conversations.length === 0
                ? "Conversations appear here when someone replies, or when you start one."
                : "Try a different search."}
            </p>
          </div>
        ) : (
          visible.map((c) => (
            <Link
              key={c.id}
              href={`/inbox/${c.id}`}
              className={`convo ${params?.id === c.id ? "active" : ""}`}
            >
              <div className="convo-top">
                <span className="convo-name">{c.displayName}</span>
                <span className="convo-time">{formatRelative(c.lastMessageAt)}</span>
              </div>
              <div className="convo-preview">
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.lastMessage || <em className="faint">No messages yet</em>}
                </span>
                {c.unreadCount > 0 && <span className="convo-unread">{c.unreadCount}</span>}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
