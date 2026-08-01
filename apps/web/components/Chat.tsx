"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { formatDay, formatTime, formatWindowRemaining } from "../lib/format";
import { sendMessageAction, sendTemplateAction } from "../app/inbox/actions";
import { buildTemplateComponents, missingParams, readTemplateBody } from "../lib/template-params";

export type ChatMessage = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  contentOrTemplateRef: any;
  currentStatus: string | null;
  createdAt: string;
  sentAt: string | null;
  failedErrorCode: string | null;
};

export type ServiceWindow = { open: boolean; expiresAt: string | null };

type Template = { id: string; name: string; language: string; status: string; components: any };

type Props = {
  conversationId: string;
  initialMessages: ChatMessage[];
  initialWindow: ServiceWindow;
  templates: Template[];
  blockedNotice?: string;
};

/** The tick marks WhatsApp users recognise, driven by our own status rank. */
function StatusTicks({ status, errorCode }: { status: string | null; errorCode: string | null }) {
  if (errorCode || status === "failed") return <span title={`Failed${errorCode ? ` (${errorCode})` : ""}`}>⚠</span>;
  switch (status) {
    case "read":
    case "played":
      return <span style={{ color: "#53bdeb" }} title="Read">✓✓</span>;
    case "delivered":
      return <span title="Delivered">✓✓</span>;
    case "sent":
      return <span title="Sent to WhatsApp">✓</span>;
    default:
      return <span title="Pending">·</span>;
  }
}

function messageBody(m: ChatMessage): string {
  const c = m.contentOrTemplateRef ?? {};
  if (m.type === "text" || m.type === "button" || m.type === "interactive") return c.body ?? "";
  if (m.type === "template") return c.body ?? "";
  if (["image", "video", "audio", "document", "sticker"].includes(m.type)) {
    return c.caption ? `[${m.type}] ${c.caption}` : `[${m.type}]`;
  }
  if (m.type === "location") return `[location] ${c.latitude}, ${c.longitude}`;
  if (m.type === "reaction") return `Reacted ${c.emoji ?? ""}`;
  return `[${m.type}]`;
}

export function Chat({ conversationId, initialMessages, initialWindow, templates, blockedNotice }: Props) {
  const [messages, setMessages] = useState(initialMessages);
  const [window, setWindow] = useState(initialWindow);
  const [error, setError] = useState<string | null>(blockedNotice ?? null);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [showTemplates, setShowTemplates] = useState(false);

  // A template whose body has {{n}} placeholders cannot be sent on one
  // click — Meta rejects a parameter count that does not match the approved
  // body (132000), so the agent is asked to fill them in first.
  const [filling, setFilling] = useState<{ name: string; language: string; placeholders: string[] } | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});

  const bodyRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);

  // Only auto-scroll if the agent is already at the bottom — yanking the
  // view while they are reading history is worse than a missed scroll.
  const handleScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    shouldStickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (shouldStickToBottom.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages]);

  // Poll for inbound replies and status changes. Webhooks land server-side,
  // so without this the agent would have to reload to see a reply.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setMessages(data.messages ?? []);
        setWindow(data.serviceWindow ?? { open: false, expiresAt: null });
      } catch {
        // A failed poll is not worth surfacing — the next one will retry.
      }
    };
    const interval = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [conversationId]);

  const submit = () => {
    const body = text.trim();
    if (!body || pending) return;

    setError(null);
    const optimistic: ChatMessage = {
      id: `pending-${Date.now()}`,
      direction: "outbound",
      type: "text",
      contentOrTemplateRef: { body },
      currentStatus: null,
      createdAt: new Date().toISOString(),
      sentAt: null,
      failedErrorCode: null,
    };
    setMessages((prev) => [...prev, optimistic]);
    setText("");
    shouldStickToBottom.current = true;

    startTransition(async () => {
      const form = new FormData();
      form.set("text", body);
      const result = await sendMessageAction(conversationId, form);
      if (!result.ok) {
        // Roll the optimistic bubble back and explain why — silently
        // dropping it would leave the agent believing it was sent.
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setText(body);
        setError(result.error);
      }
    });
  };

  /** Entry point from every template button: send straight away when the
   *  template takes no variables, otherwise open the fill-in panel. */
  const chooseTemplate = (t: Template) => {
    setError(null);
    setShowTemplates(false);
    const { placeholders } = readTemplateBody(t.components);
    if (placeholders.length) {
      setParams({});
      setFilling({ name: t.name, language: t.language, placeholders });
      return;
    }
    sendTemplate(t.name, t.language, []);
  };

  const sendTemplate = (name: string, language: string, components: ReturnType<typeof buildTemplateComponents>) => {
    setError(null);
    setFilling(null);
    startTransition(async () => {
      const result = await sendTemplateAction(conversationId, name, language, components);
      if (!result.ok) setError(result.error);
      else {
        const res = await fetch(`/api/conversations/${conversationId}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages ?? []);
        }
      }
    });
  };

  const remaining = formatWindowRemaining(window.expiresAt);
  const approved = templates.filter((t) => t.status === "APPROVED");

  // Group by day so the thread reads like a conversation, not a log.
  const grouped: { day: string; items: ChatMessage[] }[] = [];
  for (const m of messages) {
    const day = formatDay(m.createdAt);
    const last = grouped[grouped.length - 1];
    if (last && last.day === day) last.items.push(m);
    else grouped.push({ day, items: [m] });
  }

  return (
    <>
      <div className="thread-body" ref={bodyRef} onScroll={handleScroll}>
        {messages.length === 0 && (
          <div className="empty">
            <h3>No messages yet</h3>
            <p>Anything you send, and any reply you receive, will appear here.</p>
          </div>
        )}

        {grouped.map((group) => (
          <div key={group.day} style={{ display: "contents" }}>
            <div className="day-sep">
              <span>{group.day}</span>
            </div>
            {group.items.map((m) => (
              <div key={m.id} className={`msg ${m.direction === "inbound" ? "msg-in" : "msg-out"}`}>
                {m.type === "template" && (
                  <div className="msg-tmpl">Template · {m.contentOrTemplateRef?.template ?? "unknown"}</div>
                )}
                <div className="msg-body">{messageBody(m) || <em className="faint">(empty)</em>}</div>
                <div className="msg-meta">
                  <span>{formatTime(m.createdAt)}</span>
                  {m.direction === "outbound" && (
                    <StatusTicks status={m.currentStatus} errorCode={m.failedErrorCode} />
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="composer">
        {error && (
          <div className="notice notice-danger" style={{ marginBottom: 10 }}>
            {error}
          </div>
        )}

        {filling && (
          <div className="card card-pad mb-8">
            <div className="flex-between mb-8">
              <strong>
                {filling.name} <span className="faint">({filling.language})</span>
              </strong>
              <button type="button" className="btn btn-sm" onClick={() => setFilling(null)} disabled={pending}>
                Cancel
              </button>
            </div>
            <div className="small muted mb-8">
              Fill in {filling.placeholders.length} variable{filling.placeholders.length === 1 ? "" : "s"} before
              sending.
            </div>
            {filling.placeholders.map((index) => (
              <div key={index} className="field">
                <label htmlFor={`tmpl_param_${index}`}>Variable {`{{${index}}}`}</label>
                <input
                  id={`tmpl_param_${index}`}
                  type="text"
                  value={params[index] ?? ""}
                  placeholder="e.g. 30 September 2026"
                  autoComplete="off"
                  onChange={(e) => setParams((prev) => ({ ...prev, [index]: e.target.value }))}
                />
              </div>
            ))}
            <button
              type="button"
              className="btn btn-primary mt-8"
              disabled={pending || missingParams(filling.placeholders, params).length > 0}
              onClick={() =>
                sendTemplate(filling.name, filling.language, buildTemplateComponents(filling.placeholders, params))
              }
            >
              {pending ? <span className="spinner" /> : "Send template"}
            </button>
          </div>
        )}

        {window.open ? (
          <>
            <div className="flex-between mb-8">
              <span className="badge badge-ok">Service window open{remaining ? ` · ${remaining}` : ""}</span>
              {approved.length > 0 && (
                <button type="button" className="btn btn-sm" onClick={() => setShowTemplates((v) => !v)}>
                  Send a template
                </button>
              )}
            </div>

            {showTemplates && (
              <div className="card card-pad mb-8">
                <div className="small muted mb-8">Approved templates</div>
                <div className="flex gap-6" style={{ flexWrap: "wrap" }}>
                  {approved.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="btn btn-sm"
                      disabled={pending}
                      onClick={() => chooseTemplate(t)}
                    >
                      {t.name} <span className="faint">({t.language})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="composer-row">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter makes a newline — the
                  // convention every messaging app uses.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Type a message…  (Enter to send, Shift+Enter for a new line)"
                rows={1}
                disabled={pending}
              />
              <button type="button" className="btn btn-primary" onClick={submit} disabled={pending || !text.trim()}>
                {pending ? <span className="spinner" /> : "Send"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="notice notice-warn" style={{ marginBottom: 10 }}>
              <strong>The 24-hour service window is closed</strong>
              WhatsApp only allows a free-text reply within 24 hours of the contact&apos;s last message. To reach them
              now you must send an approved template, which reopens the window if they reply.
            </div>

            {approved.length === 0 ? (
              <p className="muted small mb-0">
                No approved templates are available yet. Sync them on the Templates page once they are approved in Meta.
              </p>
            ) : (
              <div className="flex gap-6" style={{ flexWrap: "wrap" }}>
                {approved.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="btn"
                    disabled={pending}
                    onClick={() => chooseTemplate(t)}
                  >
                    {pending ? <span className="spinner" /> : `Send "${t.name}"`}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
