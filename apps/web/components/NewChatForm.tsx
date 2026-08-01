"use client";

import { useActionState, useMemo, useState } from "react";
import { startChatAction } from "../app/inbox/actions";
import { readTemplateBody } from "../lib/template-params";

type Template = { id: string; name: string; language: string; status: string; components: any };

export function NewChatForm({ templates }: { templates: Template[] }) {
  const [state, formAction, pending] = useActionState(startChatAction, undefined);
  const [mode, setMode] = useState<"template" | "text">(templates.length ? "template" : "text");
  const [templateName, setTemplateName] = useState(templates[0]?.name ?? "");

  const template = templates.find((t) => t.name === templateName);
  const { body, placeholders } = useMemo(() => readTemplateBody(template?.components), [template]);

  return (
    <form action={formAction}>
      {state && !state.ok && (
        <div className="notice notice-danger">
          <strong>Could not start this chat</strong>
          {state.error}
        </div>
      )}

      <div className="field">
        <label htmlFor="phoneNumber">Phone number *</label>
        <input
          id="phoneNumber"
          name="phoneNumber"
          type="tel"
          placeholder="+91 98765 43210"
          required
          autoFocus
          autoComplete="off"
        />
        <div className="hint">
          Include the country code. A number without one is assumed to be Indian (+91). Spaces, dashes and brackets are
          fine — the number is normalised automatically.
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="firstName">First name</label>
          <input id="firstName" name="firstName" type="text" placeholder="Priya" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="lastName">Last name</label>
          <input id="lastName" name="lastName" type="text" placeholder="Sharma" autoComplete="off" />
        </div>
      </div>

      <div className="notice notice-info">
        <strong>WhatsApp rule: you cannot free-text someone first</strong>
        A business may only send free text inside the 24 hours after the contact&apos;s own last message. To start a
        conversation you must use a template Meta has approved. If they reply, the window opens and you can chat
        normally.
      </div>

      <div className="tabs">
        <button type="button" className={mode === "template" ? "active" : ""} onClick={() => setMode("template")}>
          Send a template
        </button>
        <button type="button" className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>
          Free text
        </button>
      </div>

      {mode === "template" ? (
        templates.length === 0 ? (
          <div className="notice notice-warn">
            <strong>No approved templates yet</strong>
            Create and get a template approved in Meta&apos;s WhatsApp Manager, then press “Sync from Meta” on the
            Templates page.
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="templateName">Template</label>
              <select
                id="templateName"
                name="templateName"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name} ({t.language})
                  </option>
                ))}
              </select>
              <input type="hidden" name="templateLanguage" value={template?.language ?? "en"} />
            </div>

            {body && (
              <div className="card card-pad mb-8" style={{ background: "var(--bubble-out)", border: "none" }}>
                <div className="small muted mb-8">Preview</div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5 }}>{body}</div>
              </div>
            )}

            {placeholders.length > 0 && (
              <div className="field">
                <div className="hint mb-8">
                  This template has {placeholders.length} variable{placeholders.length === 1 ? "" : "s"}. Type the text
                  each one should be replaced with — WhatsApp rejects the message if any is left blank.
                </div>
                {placeholders.map((index) => (
                  <div key={index} className="field">
                    <label htmlFor={`param_${index}`}>Variable {`{{${index}}}`}</label>
                    <input
                      id={`param_${index}`}
                      name={`param_${index}`}
                      type="text"
                      placeholder="e.g. 30 September 2026"
                      autoComplete="off"
                      required
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )
      ) : (
        <div className="field">
          <label htmlFor="text">Message</label>
          <textarea id="text" name="text" placeholder="Type your message…" rows={4} />
          <div className="hint">
            This only delivers if the contact has messaged you in the last 24 hours. Otherwise WhatsApp rejects it and
            you will see the reason on the next screen.
          </div>
        </div>
      )}

      <button type="submit" className="btn btn-primary mt-8" disabled={pending}>
        {pending ? <span className="spinner" /> : "Start chat"}
      </button>
    </form>
  );
}
