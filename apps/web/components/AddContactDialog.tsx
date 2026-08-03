"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createContactAction } from "../app/contacts/actions";
import { Modal } from "./Modal";
import { Notice } from "./Notice";

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
    <Modal title="Add a contact" onClose={() => setOpen(false)}>
      <form action={formAction}>
        {state && !state.ok && <Notice title="Could not save">{state.error}</Notice>}

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
    </Modal>
  );
}
