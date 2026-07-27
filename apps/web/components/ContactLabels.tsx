"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addContactToGroupAction,
  removeContactFromGroupAction,
  tagContactAction,
  untagContactAction,
  type ActionResult,
} from "../app/contacts/actions";

type LabelRef = { id: string; name: string; color?: string | null };

/** The per-contact view of the same groups and labels the contacts list
 *  assigns in bulk. Only existing groups/labels can be attached here —
 *  creating one is a workspace-wide act and belongs on /contacts/labels. */
export function ContactLabels({
  contactId,
  groups,
  tags,
  allGroups,
  allTags,
}: {
  contactId: string;
  groups: LabelRef[];
  tags: LabelRef[];
  allGroups: LabelRef[];
  allTags: LabelRef[];
}) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (fn: () => Promise<ActionResult>) => {
    startTransition(async () => {
      setResult(await fn());
      router.refresh();
    });
  };

  const availableGroups = allGroups.filter((g) => !groups.some((x) => x.id === g.id));
  const availableTags = allTags.filter((t) => !tags.some((x) => x.id === t.id));

  return (
    <div className="card mb-16">
      <div className="card-head">
        <h2>Groups &amp; labels</h2>
        <Link href="/contacts/labels" className="sub">
          Manage
        </Link>
      </div>

      <div className="card-pad">
        {result && (
          <div className={`notice ${result.ok ? "notice-ok" : "notice-danger"}`}>
            {result.ok ? (result.message ?? "Done.") : result.error}
          </div>
        )}

        {groups.length === 0 && tags.length === 0 ? (
          <p className="muted small">Not in any group and carrying no labels.</p>
        ) : (
          <div className="chips mb-8">
            {groups.map((g) => (
              <span key={g.id} className="chip chip-group" title={`Group: ${g.name}`}>
                <span>{g.name}</span>
                <button
                  type="button"
                  className="chip-x"
                  disabled={pending}
                  aria-label={`Remove from ${g.name}`}
                  onClick={() => run(() => removeContactFromGroupAction(contactId, g.id))}
                >
                  ×
                </button>
              </span>
            ))}
            {tags.map((t) => (
              <span key={t.id} className="chip chip-tag" title={`Label: ${t.name}`}>
                {t.color && <span className="chip-dot" style={{ background: t.color }} />}
                <span>{t.name}</span>
                <button
                  type="button"
                  className="chip-x"
                  disabled={pending}
                  aria-label={`Remove label ${t.name}`}
                  onClick={() => run(() => untagContactAction(contactId, t.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-6 mt-8" style={{ flexWrap: "wrap" }}>
          <select
            value=""
            disabled={pending || availableGroups.length === 0}
            onChange={(e) => e.target.value && run(() => addContactToGroupAction(contactId, e.target.value))}
          >
            <option value="">{availableGroups.length === 0 ? "In every group" : "Add to a group…"}</option>
            {availableGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          <select
            value=""
            disabled={pending || availableTags.length === 0}
            onChange={(e) => e.target.value && run(() => tagContactAction(contactId, e.target.value))}
          >
            <option value="">{availableTags.length === 0 ? "All labels applied" : "Apply a label…"}</option>
            {availableTags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
