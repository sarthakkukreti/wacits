"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { commitImportAction, previewImportAction, type PreviewResult } from "../app/contacts/actions";

/**
 * PRD §9 — the three-step import: choose a file, confirm what will happen,
 * then commit. The middle step is the point of the whole screen: an
 * operator about to touch thousands of contacts should see the created /
 * updated / rejected split BEFORE anything is written, not after.
 */

const FIELD_LABELS: Record<string, string> = {
  phoneNumber: "Phone number *",
  firstName: "First name",
  lastName: "Last name",
  fullName: "Full name (split automatically)",
  email: "Email",
  organization: "Organisation",
  designation: "Designation",
  memberId: "Member / reference ID",
  city: "City",
  state: "State",
  language: "Language",
  notes: "Notes",
  labels: "Labels",
};

/** Only shown for fields whose behaviour is not obvious from the name. */
const FIELD_HINTS: Record<string, string> = {
  labels: "One label per cell, or several separated by commas. New labels are created automatically.",
};

export function ImportWizard() {
  const [preview, previewAction, previewPending] = useActionState(previewImportAction, undefined);
  const [commit, commitAction, commitPending] = useActionState(commitImportAction, undefined);
  const [mapping, setMapping] = useState<Record<string, string | null> | null>(null);
  const [mappingChanged, setMappingChanged] = useState(false);
  const [fileName, setFileName] = useState("upload.csv");

  const currentMapping = mapping ?? (preview?.ok ? preview.mapping : null);
  const step = commit?.ok ? 3 : preview?.ok ? 2 : 1;

  // A fresh preview is authoritative: drop the local override so the figures
  // and the mapping on screen describe the same thing again.
  useEffect(() => {
    if (preview?.ok) {
      setMapping(null);
      setMappingChanged(false);
    }
  }, [preview]);

  if (commit?.ok) {
    return (
      <div className="card card-pad">
        <div className="notice notice-ok">
          <strong>Import finished</strong>
          {commit.created} contact{commit.created === 1 ? "" : "s"} created, {commit.updated} updated
          {commit.errored > 0 ? `, ${commit.errored} row${commit.errored === 1 ? "" : "s"} rejected` : ""}.
          {commit.labelsApplied > 0 &&
            ` ${commit.labelsApplied} label${commit.labelsApplied === 1 ? "" : "s"} applied${
              commit.labelsCreated > 0 ? ` (${commit.labelsCreated} newly created)` : ""
            }.`}
        </div>
        <p className="muted small">
          You have 24 hours to undo this import. Undo removes only the contacts it created — never ones that already
          existed and were updated.
        </p>
        <div className="flex gap-6">
          <Link href="/contacts" className="btn btn-primary">
            View contacts
          </Link>
          <Link href="/campaigns/new" className="btn">
            Send a campaign to them
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="steps">
        <div className={`step ${step === 1 ? "active" : "done"}`}>
          <span className="step-num">1</span> Choose file
        </div>
        <div className="step-line" />
        <div className={`step ${step === 2 ? "active" : step > 2 ? "done" : ""}`}>
          <span className="step-num">2</span> Check the mapping
        </div>
        <div className="step-line" />
        <div className={`step ${step === 3 ? "active" : ""}`}>
          <span className="step-num">3</span> Import
        </div>
      </div>

      {step === 1 && (
        <div className="card">
          <div className="card-head">
            <h2>Upload a CSV</h2>
          </div>
          <form action={previewAction} className="card-pad">
            {preview && !preview.ok && (
              <div className="notice notice-danger">
                <strong>Could not read that file</strong>
                {preview.error}
              </div>
            )}

            <div className="field">
              <label htmlFor="file">CSV file</label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "upload.csv")}
              />
              <div className="hint">
                The first row must be column headers. Common names (Phone, Mobile, Name, Email, Company…) are detected
                automatically — you can correct the mapping on the next step.
              </div>
            </div>

            <details>
              <summary className="muted small" style={{ cursor: "pointer", marginBottom: 8 }}>
                Or paste CSV text instead
              </summary>
              <textarea name="csv" rows={6} placeholder="Name,Phone,Email&#10;Priya Sharma,+91 98765 43210,priya@example.com" />
            </details>

            <button type="submit" className="btn btn-primary mt-8" disabled={previewPending}>
              {previewPending ? <span className="spinner" /> : "Continue"}
            </button>
          </form>
        </div>
      )}

      {step === 2 && preview?.ok && currentMapping && (
        <>
          <div className="grid grid-4 mb-16">
            <div className="card stat">
              <div className="stat-label">Rows in file</div>
              <div className="stat-value">{preview.totalRows}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">Will be created</div>
              <div className="stat-value" style={{ color: "var(--ok)" }}>
                {preview.willCreateCount}
              </div>
            </div>
            <div className="card stat">
              <div className="stat-label">Will be updated</div>
              <div className="stat-value" style={{ color: "var(--info)" }}>
                {preview.willUpdateCount}
              </div>
            </div>
            <div className="card stat">
              <div className="stat-label">Rejected</div>
              <div className="stat-value" style={{ color: preview.invalidCount ? "var(--danger)" : undefined }}>
                {preview.invalidCount}
              </div>
              <div className="stat-hint">Invalid phone numbers</div>
            </div>
          </div>

          {preview.suppressedCount > 0 && (
            <div className="notice notice-warn">
              <strong>
                {preview.suppressedCount} number{preview.suppressedCount === 1 ? " is" : "s are"} on the opt-out list
              </strong>
              They will still be imported, but campaigns will automatically skip them. That is deliberate: an opt-out
              must survive a re-import of the same list.
            </div>
          )}

          {preview.duplicateInFileCount > 0 && (
            <div className="notice notice-info">
              {preview.duplicateInFileCount} duplicate number
              {preview.duplicateInFileCount === 1 ? " was" : "s were"} found inside the file itself. Each person will
              only be imported once.
            </div>
          )}

          <div className="card mb-16">
            <div className="card-head">
              <h2>Column mapping</h2>
              <span className="sub">Check these before importing</span>
            </div>
            <div className="card-pad">
              <div className="grid grid-2">
                {Object.keys(FIELD_LABELS).map((field) => (
                  <div className="field" key={field}>
                    <label>{FIELD_LABELS[field]}</label>
                    <select
                      value={currentMapping[field] ?? ""}
                      onChange={(e) => {
                        setMapping({ ...currentMapping, [field]: e.target.value || null });
                        setMappingChanged(true);
                      }}
                    >
                      <option value="">— not imported —</option>
                      {preview.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    {FIELD_HINTS[field] && <div className="hint">{FIELD_HINTS[field]}</div>}
                  </div>
                ))}
              </div>

              {!currentMapping.phoneNumber && (
                <div className="notice notice-danger">
                  <strong>Choose the phone number column</strong>
                  Nothing can be imported without it.
                </div>
              )}

              {/* The figures above were computed for the mapping the server
                  guessed. Changing a column here makes them stale, so the
                  operator is offered a re-check rather than left guessing. */}
              {mappingChanged && (
                <form action={previewAction}>
                  <input type="hidden" name="csv" value={preview.csv} />
                  <input type="hidden" name="mapping" value={JSON.stringify(currentMapping)} />
                  <div className="notice notice-warn">
                    <strong>You changed the mapping</strong>
                    The counts and previews on this page still describe the previous mapping.
                    <div className="mt-8">
                      <button type="submit" className="btn btn-sm" disabled={previewPending}>
                        {previewPending ? <span className="spinner" /> : "Re-check with this mapping"}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>

          {preview.labelDistinctCount > 0 && (
            <div className="card mb-16">
              <div className="card-head">
                <h2>Labels in this file</h2>
                <span className="sub">
                  {preview.labelDistinctCount} distinct, {preview.labelNewCount} new
                </span>
              </div>

              {preview.labelOverLimit ? (
                <div className="card-pad">
                  <div className="notice notice-danger mb-0">
                    <strong>Too many distinct labels ({preview.labelDistinctCount})</strong>
                    The limit is {preview.labelMaxDistinct}. This almost always means the label column is pointed at
                    free text — a notes or address column — rather than a category. Correct the mapping above.
                  </div>
                </div>
              ) : (
                <>
                  {preview.labelTooLongCount > 0 && (
                    <div className="card-pad">
                      <div className="notice notice-danger mb-0">
                        <strong>
                          {preview.labelTooLongCount} value{preview.labelTooLongCount === 1 ? " is" : "s are"} too long
                          to be a label
                        </strong>
                        The import will be refused. Check that the label column is the right one.
                      </div>
                    </div>
                  )}
                  <div className="card-pad">
                    <div className="chips">
                      {preview.labelPreview.map((l) => (
                        <span key={l.name} className={`chip chip-tag${l.tooLong ? " chip-bad" : ""}`}>
                          <span>{l.name}</span>
                          <span className="faint">{l.contactCount}</span>
                          {l.isNew && <span className="badge badge-info">new</span>}
                        </span>
                      ))}
                      {preview.labelDistinctCount > preview.labelPreview.length && (
                        <span className="muted small">
                          + {preview.labelDistinctCount - preview.labelPreview.length} more
                        </span>
                      )}
                    </div>
                    <p className="hint mt-8 mb-0">
                      Labels are additive: re-importing a list adds what the file says and never strips a label someone
                      already carries.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {preview.invalidSamples.length > 0 && (
            <div className="card mb-16">
              <div className="card-head">
                <h2>Rejected rows</h2>
                <span className="sub">
                  Showing {preview.invalidSamples.length} of {preview.invalidCount}
                </span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Value</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.invalidSamples.map((s) => (
                      <tr key={s.rowNumber}>
                        <td className="faint">{s.rowNumber}</td>
                        <td className="mono">{s.value || <em className="faint">(empty)</em>}</td>
                        <td className="muted">{s.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.sampleRows.length > 0 && (
            <div className="card mb-16">
              <div className="card-head">
                <h2>Preview</h2>
                <span className="sub">First {preview.sampleRows.length} valid rows</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Phone</th>
                      <th>First name</th>
                      <th>Last name</th>
                      <th>Organisation</th>
                      <th>Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((r: any) => (
                      <tr key={r.rowNumber}>
                        <td className="mono nowrap">{r.phoneNumber}</td>
                        <td>{r.firstName ?? <span className="faint">—</span>}</td>
                        <td>{r.lastName ?? <span className="faint">—</span>}</td>
                        <td>{r.organization ?? <span className="faint">—</span>}</td>
                        <td>{r.email ?? <span className="faint">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h2>Import</h2>
            </div>
            <form action={commitAction} className="card-pad">
              {commit && !commit.ok && (
                <div className="notice notice-danger">
                  <strong>Import failed</strong>
                  {commit.error}
                </div>
              )}

              <input type="hidden" name="csv" value={preview.csv} />
              <input type="hidden" name="mapping" value={JSON.stringify(currentMapping)} />
              <input type="hidden" name="fileName" value={fileName} />

              <div className="field">
                <label htmlFor="groupName">Add everyone to a group (optional)</label>
                <input id="groupName" name="groupName" type="text" placeholder="e.g. Annual Meet 2026 invitees" />
                <div className="hint">
                  A group makes this list selectable as a campaign audience in one click. If the group already exists,
                  these contacts are added to it.
                </div>
              </div>

              <div className="field">
                <label htmlFor="labelNames">Label everyone (optional)</label>
                <input id="labelNames" name="labelNames" type="text" placeholder="e.g. Acme Industries, 2026 intake" />
                <div className="hint">
                  Comma-separated. Applied to every contact in the file, on top of anything the mapped Labels column
                  produces per row. Labels that do not exist yet are created.
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  commitPending ||
                  !currentMapping.phoneNumber ||
                  preview.validCount === 0 ||
                  preview.labelOverLimit ||
                  preview.labelTooLongCount > 0
                }
              >
                {commitPending ? (
                  <>
                    <span className="spinner" /> Importing…
                  </>
                ) : (
                  `Import ${preview.willCreateCount + preview.willUpdateCount} contacts`
                )}
              </button>
            </form>
          </div>
        </>
      )}
    </>
  );
}
