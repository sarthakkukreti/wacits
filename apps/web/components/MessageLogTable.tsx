"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resendAllEligibleAction, resendMessagesAction, type ResendResult } from "../app/messages/actions";
import { formatDateTime, formatNumber } from "../lib/format";

export type LogRow = {
  source: "campaign" | "direct";
  rowId: string;
  messageId: string | null;
  campaignId: string | null;
  campaignName: string | null;
  attemptKey: number | null;
  contactId: string;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string;
  direction: string;
  status: string;
  errorCode: string | null;
  skipReason: string | null;
  failure: { errorClass: string; title: string; explanation: string | null } | null;
  resendEligible: boolean;
  resendBlockedReason: string | null;
  occurredAt: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  delivered: "badge-ok",
  read: "badge-ok",
  sent: "badge-info",
  accepted: "badge-info",
  queued: "badge-info",
  received: "badge-info",
  pending: "badge-muted",
  held: "badge-warn",
  skipped: "badge-warn",
  failed: "badge-danger",
};

export function MessageLogTable({
  rows,
  total,
  campaignId,
  campaignEligibleCount,
}: {
  rows: LogRow[];
  total: number;
  /** Set when the log is filtered to one campaign — the only situation in
   *  which "resend all eligible" is offered, since it resolves per campaign. */
  campaignId?: string;
  /** Campaign-wide resendable count from the API. The bulk action resends
   *  the whole campaign, not just this page, so the confirmation must quote
   *  this rather than a page-sized number. */
  campaignEligibleCount?: number | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | { kind: "selected" | "all"; count: number }>(null);
  const [result, setResult] = useState<ResendResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const eligibleRows = rows.filter((r) => r.resendEligible);
  const eligibleOnPage = eligibleRows.map((r) => r.rowId);
  const selectedEligible = [...selected].filter((id) => eligibleOnPage.includes(id));
  const allEligibleSelected = eligibleOnPage.length > 0 && eligibleOnPage.every((id) => selected.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allEligibleSelected) eligibleOnPage.forEach((id) => next.delete(id));
      else eligibleOnPage.forEach((id) => next.add(id));
      return next;
    });

  const run = (fn: () => Promise<ResendResult>) => {
    startTransition(async () => {
      const res = await fn();
      setResult(res);
      setConfirming(null);
      if (res.ok) setSelected(new Set());
      router.refresh();
    });
  };

  return (
    <>
      {result && (
        <div
          className={`notice ${result.ok ? (result.refused > 0 ? "notice-warn" : "notice-ok") : "notice-danger"} mb-0`}
          style={{ borderRadius: 0 }}
        >
          {result.ok ? (
            <>
              <strong>
                {formatNumber(result.queued)} message{result.queued === 1 ? "" : "s"} queued for resend
                {result.refused > 0 ? `, ${formatNumber(result.refused)} refused` : ""}
              </strong>
              {result.refused > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {[...new Set(result.outcomes.filter((o) => !o.queued).map((o) => o.reason))]
                    .filter(Boolean)
                    .map((reason) => (
                      <li key={reason} className="small">
                        {reason}
                      </li>
                    ))}
                </ul>
              )}
            </>
          ) : (
            result.error
          )}
        </div>
      )}

      {/* Sending real, billable messages is never one click away. */}
      {confirming && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.42)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "10vh 16px",
            zIndex: 100,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirming(null);
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 460 }}>
            <div className="card-head">
              <h2>Resend {formatNumber(confirming.count)} message{confirming.count === 1 ? "" : "s"}?</h2>
            </div>
            <div className="card-pad">
              <div className="notice notice-warn">
                <strong>These are real WhatsApp messages</strong>
                Each delivered message is billed by Meta. Recipients will receive the template again.
              </div>
              <p className="muted small">
                This creates a new attempt in the same campaign; the original failed record is kept so both attempts
                stay visible in the report. Anything ineligible — opted out, terminally failed, or already retrying —
                is excluded from the {formatNumber(confirming.count)} above and will not be sent.
              </p>
              <div className="flex gap-6">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      confirming.kind === "all" && campaignId
                        ? resendAllEligibleAction(campaignId)
                        : resendMessagesAction(selectedEligible),
                    )
                  }
                >
                  {pending ? <span className="spinner" /> : `Yes, resend ${formatNumber(confirming.count)}`}
                </button>
                <button type="button" className="btn" onClick={() => setConfirming(null)} disabled={pending}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {(selectedEligible.length > 0 || (campaignId && (campaignEligibleCount ?? 0) > 0)) && (
        <div className="bulkbar">
          {selectedEligible.length > 0 ? (
            <>
              <span className="bulkbar-count">{formatNumber(selectedEligible.length)} selected</span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={pending}
                onClick={() => setConfirming({ kind: "selected", count: selectedEligible.length })}
              >
                Resend selected
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())} disabled={pending}>
                Clear
              </button>
            </>
          ) : (
            <span className="muted small">Tick any resendable row, or resend every eligible failure at once.</span>
          )}
          {campaignId && (campaignEligibleCount ?? 0) > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending}
              onClick={() => setConfirming({ kind: "all", count: campaignEligibleCount ?? 0 })}
              title="Resends every eligible failure in this campaign, not just this page"
            >
              Resend all {formatNumber(campaignEligibleCount ?? 0)} eligible in campaign
            </button>
          )}
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="check-cell">
                <input
                  type="checkbox"
                  checked={allEligibleSelected}
                  onChange={togglePage}
                  disabled={eligibleOnPage.length === 0}
                  aria-label="Select every resendable message on this page"
                />
              </th>
              <th>Contact</th>
              <th>Campaign</th>
              <th>Status</th>
              <th>Reason</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || "—";
              const isOpen = expanded === r.rowId;
              return (
                <tr key={`${r.source}-${r.rowId}`}>
                  <td className="check-cell">
                    <input
                      type="checkbox"
                      checked={selected.has(r.rowId)}
                      onChange={() => toggle(r.rowId)}
                      disabled={!r.resendEligible}
                      title={r.resendEligible ? undefined : r.resendBlockedReason ?? undefined}
                      aria-label={`Select message to ${name}`}
                    />
                  </td>
                  <td>
                    <Link href={`/contacts/${r.contactId}`}>
                      <strong>{name}</strong>
                    </Link>
                    <div className="faint small mono">{r.phoneNumber}</div>
                  </td>
                  <td>
                    {r.campaignName ? (
                      <>
                        <Link href={`/campaigns/${r.campaignId}`} className="small">
                          {r.campaignName}
                        </Link>
                        {r.attemptKey && r.attemptKey > 1 && (
                          <div>
                            <span className="badge badge-info">attempt {r.attemptKey}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="faint small">{r.direction === "inbound" ? "Reply" : "Direct message"}</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[r.status] ?? "badge-muted"}`}>{r.status}</span>
                  </td>
                  <td>
                    {r.failure ? (
                      <>
                        <button
                          type="button"
                          className="btn-link-plain"
                          onClick={() => setExpanded(isOpen ? null : r.rowId)}
                        >
                          {r.failure.title}
                        </button>
                        <div className="faint small mono">
                          {r.errorCode} · {r.failure.errorClass.toLowerCase().replace(/_/g, " ")}
                        </div>
                        {isOpen && r.failure.explanation && (
                          <div className="notice notice-info small mt-8 mb-0">{r.failure.explanation}</div>
                        )}
                        {isOpen && !r.resendEligible && r.resendBlockedReason && (
                          <div className="faint small mt-8">Cannot resend: {r.resendBlockedReason}</div>
                        )}
                      </>
                    ) : r.skipReason ? (
                      <span className="muted small">{r.skipReason.replace(/_/g, " ")}</span>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td className="faint small nowrap">{formatDateTime(r.occurredAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
