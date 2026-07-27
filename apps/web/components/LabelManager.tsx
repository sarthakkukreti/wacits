"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createGroupAction,
  createTagAction,
  deleteGroupAction,
  deleteTagAction,
  renameGroupAction,
  renameTagAction,
  type ActionResult,
} from "../app/contacts/actions";
import { formatNumber } from "../lib/format";

type Group = { id: string; name: string; description: string | null; memberCount: number };
type Tag = { id: string; name: string; color: string | null; contactCount: number };

/**
 * Housekeeping for the two labelling systems. Renaming and deleting live
 * here rather than on the contacts list because they are workspace-wide
 * edits, not per-contact ones — deleting a group removes the labelling from
 * every member at once, and that should not sit one mis-click away from a
 * row action.
 */
export function LabelManager({ groups, tags }: { groups: Group[]; tags: Tag[] }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [newGroup, setNewGroup] = useState("");
  const [newTag, setNewTag] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editExtra, setEditExtra] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const router = useRouter();

  const startEdit = (id: string, name: string, extra: string) => {
    setEditing(id);
    setEditName(name);
    setEditExtra(extra);
    setConfirmDelete(null);
  };

  /** The rename actions take a FormData so they can also be used as plain
   *  form actions; here it is built by hand so the result is captured and
   *  shown rather than swallowed by a form submit. */
  const formDataOf = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  const run = (fn: () => Promise<ActionResult>) => {
    startTransition(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) {
        setEditing(null);
        setConfirmDelete(null);
      }
      router.refresh();
    });
  };

  return (
    <>
      {result && (
        <div className={`notice ${result.ok ? "notice-ok" : "notice-danger"}`}>
          {result.ok ? (result.message ?? "Done.") : result.error}
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Groups</h2>
            <span className="sub">{groups.length} total</span>
          </div>

          <div className="card-pad">
            <p className="muted small">
              A group is a fixed list — someone is in it until they are taken out. This is what to use for “these
              contacts belong to client X”. Campaigns target groups directly.
            </p>
            <div className="flex gap-6">
              <input
                type="text"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                placeholder="New group name"
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending || !newGroup.trim()}
                onClick={() =>
                  run(async () => {
                    const res = await createGroupAction(newGroup);
                    if (res.ok) setNewGroup("");
                    return res;
                  })
                }
              >
                Create
              </button>
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="card-pad">
              <p className="muted small mb-0">No groups yet.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id}>
                      <td>
                        {editing === g.id ? (
                          <div className="flex gap-6">
                            <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                            <input
                              value={editExtra}
                              onChange={(e) => setEditExtra(e.target.value)}
                              placeholder="Description"
                            />
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={pending}
                              onClick={() =>
                                run(() =>
                                  renameGroupAction(
                                    g.id,
                                    null,
                                    formDataOf({ name: editName, description: editExtra }),
                                  ),
                                )
                              }
                            >
                              Save
                            </button>
                            <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <Link href={`/contacts?groupId=${g.id}`}>
                              <strong>{g.name}</strong>
                            </Link>
                            <div className="faint small">
                              {formatNumber(g.memberCount)} contact(s)
                              {g.description ? ` — ${g.description}` : ""}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="text-right nowrap">
                        {confirmDelete === g.id ? (
                          <span className="flex gap-6" style={{ justifyContent: "flex-end" }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              disabled={pending}
                              onClick={() => run(() => deleteGroupAction(g.id))}
                            >
                              Delete group
                            </button>
                            <button type="button" className="btn btn-sm" onClick={() => setConfirmDelete(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          editing !== g.id && (
                            <span className="flex gap-6" style={{ justifyContent: "flex-end" }}>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => startEdit(g.id, g.name, g.description ?? "")}
                              >
                                Rename
                              </button>
                              <button type="button" className="btn btn-sm" onClick={() => setConfirmDelete(g.id)}>
                                Delete
                              </button>
                            </span>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Labels</h2>
            <span className="sub">{tags.length} total</span>
          </div>

          <div className="card-pad">
            <p className="muted small">
              A label is a free-form marker a contact can carry any number of — “VIP”, “renewal due”, “Hindi”. Filter
              by one on the contacts list, or target it in a campaign audience.
            </p>
            <div className="flex gap-6">
              <input type="text" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="New label name" />
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending || !newTag.trim()}
                onClick={() =>
                  run(async () => {
                    const res = await createTagAction(newTag);
                    if (res.ok) setNewTag("");
                    return res;
                  })
                }
              >
                Create
              </button>
            </div>
          </div>

          {tags.length === 0 ? (
            <div className="card-pad">
              <p className="muted small mb-0">No labels yet.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {tags.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {editing === t.id ? (
                          <div className="flex gap-6">
                            <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                            <input
                              type="color"
                              value={editExtra || "#128c7e"}
                              onChange={(e) => setEditExtra(e.target.value)}
                              className="w-auto"
                              style={{ width: 44, padding: 2 }}
                              aria-label="Label colour"
                            />
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={pending}
                              onClick={() =>
                                run(() => renameTagAction(t.id, null, formDataOf({ name: editName, color: editExtra })))
                              }
                            >
                              Save
                            </button>
                            <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <Link href={`/contacts?tagId=${t.id}`}>
                              <span className="chip chip-tag">
                                {t.color && <span className="chip-dot" style={{ background: t.color }} />}
                                <span>{t.name}</span>
                              </span>
                            </Link>
                            <div className="faint small">{formatNumber(t.contactCount)} contact(s)</div>
                          </>
                        )}
                      </td>
                      <td className="text-right nowrap">
                        {confirmDelete === t.id ? (
                          <span className="flex gap-6" style={{ justifyContent: "flex-end" }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              disabled={pending}
                              onClick={() => run(() => deleteTagAction(t.id))}
                            >
                              Delete label
                            </button>
                            <button type="button" className="btn btn-sm" onClick={() => setConfirmDelete(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          editing !== t.id && (
                            <span className="flex gap-6" style={{ justifyContent: "flex-end" }}>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => startEdit(t.id, t.name, t.color ?? "#128c7e")}
                              >
                                Rename
                              </button>
                              <button type="button" className="btn btn-sm" onClick={() => setConfirmDelete(t.id)}>
                                Delete
                              </button>
                            </span>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
