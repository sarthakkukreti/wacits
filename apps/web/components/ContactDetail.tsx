"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveContactAction, optInAction, optOutAction, updateContactAction } from "../app/contacts/actions";

type Contact = {
  id: string;
  phoneNumber: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  organization: string | null;
  designation: string | null;
  memberId: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  marketingConsentState: string;
};

export function ContactDetail({ contact }: { contact: Contact }) {
  const [state, formAction, pending] = useActionState(updateContactAction.bind(null, contact.id), undefined);
  const [consentPending, startConsent] = useTransition();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const router = useRouter();

  const toggleConsent = () => {
    startConsent(async () => {
      if (contact.marketingConsentState === "opted_out") await optInAction(contact.id);
      else await optOutAction(contact.id);
      router.refresh();
    });
  };

  const archive = () => {
    startConsent(async () => {
      await archiveContactAction(contact.id);
      router.push("/contacts");
    });
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Details</h2>
        <span className="sub mono">{contact.phoneNumber}</span>
      </div>

      <form action={formAction} className="card-pad">
        {state && (
          <div className={`notice ${state.ok ? "notice-ok" : "notice-danger"}`}>
            {state.ok ? (state.message ?? "Saved.") : state.error}
          </div>
        )}

        <div className="row">
          <div className="field">
            <label htmlFor="firstName">First name</label>
            <input id="firstName" name="firstName" defaultValue={contact.firstName ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="lastName">Last name</label>
            <input id="lastName" name="lastName" defaultValue={contact.lastName ?? ""} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" defaultValue={contact.email ?? ""} />
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="organization">Organisation</label>
            <input id="organization" name="organization" defaultValue={contact.organization ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="designation">Designation</label>
            <input id="designation" name="designation" defaultValue={contact.designation ?? ""} />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="city">City</label>
            <input id="city" name="city" defaultValue={contact.city ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="memberId">Member ID</label>
            <input id="memberId" name="memberId" defaultValue={contact.memberId ?? ""} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={3} defaultValue={contact.notes ?? ""} />
        </div>

        <div className="flex gap-6" style={{ flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? <span className="spinner" /> : "Save changes"}
          </button>

          <button type="button" className="btn" onClick={toggleConsent} disabled={consentPending}>
            {contact.marketingConsentState === "opted_out" ? "Record opt-in" : "Record opt-out"}
          </button>

          {confirmArchive ? (
            <>
              <button type="button" className="btn btn-danger" onClick={archive} disabled={consentPending}>
                Confirm archive
              </button>
              <button type="button" className="btn" onClick={() => setConfirmArchive(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirmArchive(true)}>
              Archive
            </button>
          )}
        </div>

        <p className="hint mt-8">
          Archiving hides the contact from lists and campaigns but keeps their message history, which §20 requires to
          stay explainable. Recording an opt-out also adds the number to the global suppression list.
        </p>
      </form>
    </div>
  );
}
