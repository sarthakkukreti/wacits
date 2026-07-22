"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createContactAction } from "../app/contacts/actions";

/** Adds one contact by hand — the "saving the name of a user via web UI"
 *  counterpart to the CSV import. */
export function AddContactDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createContactAction, undefined);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  if (!open) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Add contact
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.42)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "6vh 16px",
        zIndex: 100,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 520, maxHeight: "88vh", overflowY: "auto" }}>
        <div className="card-head">
          <h2>Add a contact</h2>
          <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>

        <form action={formAction} className="card-pad">
          {state && !state.ok && (
            <div className="notice notice-danger">
              <strong>Could not save</strong>
              {state.error}
            </div>
          )}

          <div className="field">
            <label htmlFor="phoneNumber">Phone number *</label>
            <input id="phoneNumber" name="phoneNumber" type="tel" placeholder="+91 98765 43210" required autoFocus />
            <div className="hint">Include the country code. Without one, +91 (India) is assumed.</div>
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="firstName">First name</label>
              <input id="firstName" name="firstName" type="text" />
            </div>
            <div className="field">
              <label htmlFor="lastName">Last name</label>
              <input id="lastName" name="lastName" type="text" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" />
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="organization">Organisation</label>
              <input id="organization" name="organization" type="text" />
            </div>
            <div className="field">
              <label htmlFor="designation">Designation</label>
              <input id="designation" name="designation" type="text" />
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="city">City</label>
              <input id="city" name="city" type="text" />
            </div>
            <div className="field">
              <label htmlFor="memberId">Member / reference ID</label>
              <input id="memberId" name="memberId" type="text" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" rows={2} />
          </div>

          <div className="flex gap-6">
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? <span className="spinner" /> : "Save contact"}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
