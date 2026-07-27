"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addToGroupAction,
  applyTagAction,
  createGroupAction,
  createTagAction,
  removeContactFromGroupAction,
  removeFromGroupAction,
  removeTagAction,
  untagContactAction,
  type ActionResult,
  type BulkTarget,
  type ContactFilter,
} from "../app/contacts/actions";
import { formatDateTime, formatNumber } from "../lib/format";

export type LabelRef = { id: string; name: string; color?: string | null };

export type ContactRow = {
  id: string;
  phoneNumber: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  organization: string | null;
  deliverabilityState: string;
  marketingConsentState: string;
  createdAt: string;
  tags: LabelRef[];
  groups: LabelRef[];
};

const DELIVERABILITY_BADGE: Record<string, string> = {
  deliverable: "badge-ok",
  suspect: "badge-warn",
  invalid: "badge-danger",
  unknown: "badge-muted",
};

type BulkAction = "add-group" | "remove-group" | "add-tag" | "remove-tag";

const ACTION_LABEL: Record<BulkAction, string> = {
  "add-group": "Add to group",
  "remove-group": "Remove from group",
  "add-tag": "Apply label",
  "remove-tag": "Remove label",
};

const NEW = "__new__";

/**
 * The contacts list with bulk group/label assignment.
 *
 * The important subtlety is the two selection modes. Ticking rows selects
 * those contacts; "select all N matching" instead sends the *filter* the
 * operator is looking at and lets the API resolve it, so a bulk action is
 * never silently capped at one page of results.
 */
export function ContactsTable({
  rows,
  total,
  groups,
  tags,
  filter,
}: {
  rows: ContactRow[];
  total: number;
  groups: LabelRef[];
  tags: LabelRef[];
  filter: ContactFilter;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [action, setAction] = useState<BulkAction>("add-group");
  const [targetId, setTargetId] = useState("");
  const [newName, setNewName] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const pageIds = rows.map((r) => r.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedCount = allMatching ? total : selected.size;

  const isAdd = action === "add-group" || action === "add-tag";
  const options = useMemo(
    () => (action === "add-group" || action === "remove-group" ? groups : tags),
    [action, groups, tags],
  );

  const clear = () => {
    setSelected(new Set());
    setAllMatching(false);
  };

  const toggleRow = (id: string) => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const run = (fn: () => Promise<ActionResult>, keepSelection = false) => {
    startTransition(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok && !keepSelection) clear();
      router.refresh();
    });
  };

  const applyBulk = () => {
    const target: BulkTarget = allMatching ? { filter } : { contactIds: [...selected] };
    const creating = isAdd && targetId === NEW;

    if (!targetId) {
      setResult({ ok: false, error: `Choose which ${action.endsWith("group") ? "group" : "label"} to use.` });
      return;
    }
    if (creating && !newName.trim()) {
      setResult({ ok: false, error: "Type a name for the new group or label." });
      return;
    }

    run(() => {
      if (action === "add-group") return creating ? createGroupAction(newName, target) : addToGroupAction(targetId, target);
      if (action === "remove-group") return removeFromGroupAction(targetId, target);
      if (action === "add-tag") return creating ? createTagAction(newName, target) : applyTagAction(targetId, target);
      return removeTagAction(targetId, target);
    });
    setNewName("");
  };

  return (
    <>
      {result && (
        <div className={`notice ${result.ok ? "notice-ok" : "notice-danger"} mb-0`} style={{ borderRadius: 0 }}>
          {result.ok ? (result.message ?? "Done.") : result.error}
        </div>
      )}

      {selectedCount > 0 && (
        <div className="bulkbar">
          <span className="bulkbar-count">{formatNumber(selectedCount)} selected</span>

          <select value={action} onChange={(e) => { setAction(e.target.value as BulkAction); setTargetId(""); }}>
            {(Object.keys(ACTION_LABEL) as BulkAction[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>

          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">
              {options.length === 0
                ? action.endsWith("group")
                  ? "No groups yet"
                  : "No labels yet"
                : `Choose a ${action.endsWith("group") ? "group" : "label"}…`}
            </option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
            {isAdd && <option value={NEW}>＋ Create new…</option>}
          </select>

          {isAdd && targetId === NEW && (
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={action === "add-group" ? "New group name" : "New label name"}
              autoFocus
            />
          )}

          <button type="button" className="btn btn-primary btn-sm" onClick={applyBulk} disabled={pending}>
            {pending ? <span className="spinner" /> : "Apply"}
          </button>
          <button type="button" className="btn btn-sm" onClick={clear} disabled={pending}>
            Clear
          </button>
        </div>
      )}

      {allOnPageSelected && total > rows.length && (
        <div className="select-all-note">
          {allMatching ? (
            <>
              All <strong>{formatNumber(total)}</strong> contacts matching this filter are selected.{" "}
              <button type="button" onClick={() => setAllMatching(false)}>
                Select only these {rows.length}
              </button>
            </>
          ) : (
            <>
              All {rows.length} contacts on this page are selected.{" "}
              <button type="button" onClick={() => setAllMatching(true)}>
                Select all {formatNumber(total)} matching this filter
              </button>
            </>
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
                  checked={allOnPageSelected}
                  onChange={togglePage}
                  aria-label="Select every contact on this page"
                />
              </th>
              <th>Name</th>
              <th>Number</th>
              <th>Groups &amp; labels</th>
              <th>Reachability</th>
              <th>Consent</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="check-cell">
                  <input
                    type="checkbox"
                    checked={allMatching || selected.has(c.id)}
                    onChange={() => toggleRow(c.id)}
                    aria-label={`Select ${[c.firstName, c.lastName].filter(Boolean).join(" ") || c.phoneNumber}`}
                  />
                </td>
                <td>
                  <Link href={`/contacts/${c.id}`}>
                    <strong>{[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}</strong>
                  </Link>
                  {c.organization && <div className="faint small">{c.organization}</div>}
                </td>
                <td className="mono nowrap">{c.phoneNumber}</td>
                <td>
                  {c.groups.length === 0 && c.tags.length === 0 ? (
                    <span className="faint">—</span>
                  ) : (
                    <div className="chips">
                      {c.groups.map((g) => (
                        <span key={g.id} className="chip chip-group" title={`Group: ${g.name}`}>
                          <span>{g.name}</span>
                          <button
                            type="button"
                            className="chip-x"
                            disabled={pending}
                            aria-label={`Remove from ${g.name}`}
                            onClick={() => run(() => removeContactFromGroupAction(c.id, g.id), true)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {c.tags.map((t) => (
                        <span key={t.id} className="chip chip-tag" title={`Label: ${t.name}`}>
                          {t.color && <span className="chip-dot" style={{ background: t.color }} />}
                          <span>{t.name}</span>
                          <button
                            type="button"
                            className="chip-x"
                            disabled={pending}
                            aria-label={`Remove label ${t.name}`}
                            onClick={() => run(() => untagContactAction(c.id, t.id), true)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`badge ${DELIVERABILITY_BADGE[c.deliverabilityState] ?? "badge-muted"}`}>
                    {c.deliverabilityState === "unknown" ? "not contacted" : c.deliverabilityState}
                  </span>
                </td>
                <td>
                  {c.marketingConsentState === "opted_out" ? (
                    <span className="badge badge-danger">opted out</span>
                  ) : c.marketingConsentState === "opted_in" ? (
                    <span className="badge badge-ok">opted in</span>
                  ) : (
                    <span className="badge badge-muted">unknown</span>
                  )}
                </td>
                <td className="faint small nowrap">{formatDateTime(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
