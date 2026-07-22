"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addSenderNumberAction } from "../app/settings/actions";

export function SenderNumberForm({ hasExisting }: { hasExisting: boolean }) {
  const [state, formAction, pending] = useActionState(addSenderNumberAction, undefined);
  const [open, setOpen] = useState(!hasExisting);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Add another number
      </button>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Connect a sender number</h2>
        {hasExisting && (
          <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
            Close
          </button>
        )}
      </div>

      <form action={formAction} className="card-pad">
        {state && (
          <div className={`notice ${state.ok ? "notice-ok" : "notice-danger"}`}>
            {state.ok ? state.message : state.error}
          </div>
        )}

        <p className="muted small">
          Find these in the Meta app dashboard under <strong>WhatsApp → API Setup</strong>, after registering your
          number.
        </p>

        <div className="field">
          <label htmlFor="metaPhoneNumberId">Phone number ID *</label>
          <input id="metaPhoneNumberId" name="metaPhoneNumberId" className="mono" placeholder="123456789012345" required />
          <div className="hint">A long numeric ID — not the phone number itself.</div>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="displayPhoneNumber">Display phone number *</label>
            <input id="displayPhoneNumber" name="displayPhoneNumber" type="tel" placeholder="+91 98765 43210" required />
          </div>
          <div className="field">
            <label htmlFor="displayName">Display name *</label>
            <input id="displayName" name="displayName" placeholder="Cyberlative IT Solutions" required />
          </div>
        </div>

        <div className="field">
          <label htmlFor="metaWabaId">WhatsApp Business Account ID *</label>
          <input id="metaWabaId" name="metaWabaId" className="mono" placeholder="987654321098765" required />
        </div>

        <div className="field">
          <label htmlFor="token">Access token</label>
          <input id="token" name="token" type="password" placeholder="EAAG…" autoComplete="off" />
          <div className="hint">
            Optional if <code>META_SYSTEM_USER_TOKEN</code> is already set on the server. Stored encrypted and never
            shown again — use a permanent System User token, not the temporary 24-hour one from the dashboard.
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? <span className="spinner" /> : "Connect number"}
        </button>
      </form>
    </div>
  );
}
