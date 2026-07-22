"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { createCampaignAction, previewAudienceAction, type PreviewResult } from "../app/campaigns/actions";

type Template = {
  id: string;
  name: string;
  language: string;
  status: string;
  latestVersionId: string | null;
  components: any;
};

type Group = { id: string; name: string; memberCount: number };

/** Pulls the body text and its {{n}} placeholders out of a template's
 *  component array, so the builder can show a real preview and ask for the
 *  right number of variables instead of guessing. */
function readTemplateBody(components: any): { body: string; placeholders: string[] } {
  const list = Array.isArray(components) ? components : [];
  const bodyComponent = list.find((c: any) => (c?.type ?? "").toUpperCase() === "BODY");
  const body: string = bodyComponent?.text ?? "";
  const placeholders = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]).filter((x): x is string => !!x);
  return { body, placeholders: [...new Set(placeholders)].sort((a, b) => Number(a) - Number(b)) };
}

const FIELD_TOKENS = [
  { token: "{{firstName}}", label: "First name" },
  { token: "{{lastName}}", label: "Last name" },
  { token: "{{fullName}}", label: "Full name" },
  { token: "{{organization}}", label: "Organisation" },
  { token: "{{city}}", label: "City" },
];

export function CampaignBuilder({
  templates,
  groups,
  totalContacts,
}: {
  templates: Template[];
  groups: Group[];
  totalContacts: number;
}) {
  const [state, formAction, pending] = useActionState(createCampaignAction, undefined);

  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [audienceMode, setAudienceMode] = useState<"all" | "groups">(groups.length ? "groups" : "all");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [excludeUndeliverable, setExcludeUndeliverable] = useState(true);
  const [params, setParams] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const template = templates.find((t) => t.id === templateId);
  const { body, placeholders } = useMemo(() => readTemplateBody(template?.components), [template]);

  // Re-count the audience whenever the selection changes, so the number on
  // the button is always the number that will actually be messaged.
  useEffect(() => {
    let cancelled = false;
    const spec =
      audienceMode === "groups"
        ? { groupIds: selectedGroups, excludeUndeliverable }
        : { allContacts: true, excludeUndeliverable };

    if (audienceMode === "groups" && selectedGroups.length === 0) {
      setPreview(null);
      return;
    }

    setPreviewing(true);
    previewAudienceAction(spec).then((result) => {
      if (!cancelled) {
        setPreview(result);
        setPreviewing(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [audienceMode, selectedGroups, excludeUndeliverable]);

  const renderedPreview = useMemo(() => {
    let out = body;
    for (const index of placeholders) {
      const spec = params[index] ?? "";
      const sample = spec
        .replace("{{firstName}}", "Priya")
        .replace("{{lastName}}", "Sharma")
        .replace("{{fullName}}", "Priya Sharma")
        .replace("{{organization}}", "Acme Ltd")
        .replace("{{city}}", "Pune");
      out = out.replace(`{{${index}}}`, sample || `⟨${index}⟩`);
    }
    return out;
  }, [body, placeholders, params]);

  const sendable = preview?.ok ? preview.sendableCount : null;

  return (
    <form action={formAction}>
      {state && !state.ok && (
        <div className="notice notice-danger">
          <strong>Could not create the campaign</strong>
          {state.error}
        </div>
      )}

      <div className="card mb-16">
        <div className="card-head">
          <h2>1 · Name</h2>
        </div>
        <div className="card-pad">
          <div className="field mb-0">
            <label htmlFor="name">Campaign name</label>
            <input id="name" name="name" placeholder="e.g. Annual Meet 2026 — invitation" required autoFocus />
            <div className="hint">Internal only. Recipients never see this.</div>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-head">
          <h2>2 · Template</h2>
          <span className="sub">Only approved templates can be sent</span>
        </div>
        <div className="card-pad">
          <div className="field">
            <label htmlFor="template">Template</label>
            <select id="template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
          </div>
          <input type="hidden" name="templateVersionId" value={template?.latestVersionId ?? ""} />

          {body && (
            <div className="card card-pad" style={{ background: "var(--bubble-out)", border: "none" }}>
              <div className="small muted mb-8">Preview (with sample values)</div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5 }}>{renderedPreview}</div>
            </div>
          )}

          {placeholders.length > 0 && (
            <div className="mt-16">
              <div className="small muted mb-8">
                This template has {placeholders.length} variable{placeholders.length === 1 ? "" : "s"}. Choose what
                fills each one — pick a contact field or type fixed text.
              </div>
              {placeholders.map((index) => (
                <div className="field" key={index}>
                  <label htmlFor={`param_${index}`}>Variable {`{{${index}}}`}</label>
                  <input
                    id={`param_${index}`}
                    name={`param_${index}`}
                    value={params[index] ?? ""}
                    onChange={(e) => setParams({ ...params, [index]: e.target.value })}
                    placeholder="e.g. {{firstName}} or fixed text"
                  />
                  <div className="flex gap-6 mt-8" style={{ flexWrap: "wrap" }}>
                    {FIELD_TOKENS.map((f) => (
                      <button
                        key={f.token}
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setParams({ ...params, [index]: f.token })}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="hint">
                If a contact has no value for the chosen field, that variable is sent empty rather than showing raw
                placeholder text.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-head">
          <h2>3 · Audience</h2>
        </div>
        <div className="card-pad">
          <div className="tabs">
            <button
              type="button"
              className={audienceMode === "groups" ? "active" : ""}
              onClick={() => setAudienceMode("groups")}
            >
              Choose groups
            </button>
            <button type="button" className={audienceMode === "all" ? "active" : ""} onClick={() => setAudienceMode("all")}>
              Everyone ({totalContacts})
            </button>
          </div>
          <input type="hidden" name="audienceMode" value={audienceMode} />

          {audienceMode === "groups" &&
            (groups.length === 0 ? (
              <div className="notice notice-info mb-0">
                No groups yet. Create one by naming a group when you import a CSV, or send to everyone.
              </div>
            ) : (
              <div>
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className="flex-between"
                    style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                  >
                    <span className="flex gap-10" style={{ alignItems: "center" }}>
                      <input
                        type="checkbox"
                        name="groupIds"
                        value={g.id}
                        checked={selectedGroups.includes(g.id)}
                        onChange={(e) =>
                          setSelectedGroups(
                            e.target.checked ? [...selectedGroups, g.id] : selectedGroups.filter((x) => x !== g.id),
                          )
                        }
                        style={{ width: "auto" }}
                      />
                      <span>{g.name}</span>
                    </span>
                    <span className="muted small">{g.memberCount} contacts</span>
                  </label>
                ))}
              </div>
            ))}

          <label className="flex gap-10 mt-16" style={{ alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="checkbox"
              name="excludeUndeliverable"
              checked={excludeUndeliverable}
              onChange={(e) => setExcludeUndeliverable(e.target.checked)}
              style={{ width: "auto", marginTop: 3 }}
            />
            <span>
              <strong style={{ fontSize: 13 }}>Skip numbers that repeatedly failed</strong>
              <div className="hint" style={{ marginTop: 2 }}>
                Recommended. Sending to numbers WhatsApp already refused damages your quality rating for no benefit.
              </div>
            </span>
          </label>

          <div className="card card-pad mt-16" style={{ background: "var(--surface-2)", border: "none" }}>
            {previewing ? (
              <span className="muted small">
                <span className="spinner" /> Counting the audience…
              </span>
            ) : !preview ? (
              <span className="muted small">Select at least one group to see the audience size.</span>
            ) : !preview.ok ? (
              <span className="small" style={{ color: "var(--danger)" }}>
                {preview.error}
              </span>
            ) : (
              <>
                <div style={{ fontSize: 20, fontWeight: 680 }}>
                  {preview.sendableCount.toLocaleString("en-IN")} recipients
                </div>
                <div className="muted small mt-8">
                  {preview.resolvedCount.toLocaleString("en-IN")} matched
                  {preview.suppressedCount > 0 && (
                    <>
                      {" · "}
                      <strong>{preview.suppressedCount.toLocaleString("en-IN")} skipped</strong> because they have
                      opted out
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-pad">
          <p className="muted small">
            The campaign is created as a <strong>draft</strong>. Nothing is sent until you review it and press Launch on
            the next screen.
          </p>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={pending || !template?.latestVersionId || sendable === null || sendable === 0}
          >
            {pending ? (
              <>
                <span className="spinner" /> Creating…
              </>
            ) : sendable ? (
              `Create draft for ${sendable.toLocaleString("en-IN")} recipients`
            ) : (
              "Create draft"
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
