"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePasswordAction } from "../app/settings/actions";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div className="card mt-16">
      <div className="card-head">
        <h2>Change password</h2>
      </div>
      <form action={formAction} ref={formRef} className="card-pad">
        {state && (
          <div className={`notice ${state.ok ? "notice-ok" : "notice-danger"}`}>
            {state.ok ? (state.message ?? "Saved.") : state.error}
          </div>
        )}

        <div className="field">
          <label htmlFor="currentPassword">Current password</label>
          <input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" />
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="newPassword">New password</label>
            <input id="newPassword" name="newPassword" type="password" required minLength={12} autoComplete="new-password" />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">Confirm new password</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
            />
          </div>
        </div>
        <div className="hint mb-8">At least 12 characters.</div>

        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? <span className="spinner" /> : "Change password"}
        </button>
      </form>
    </div>
  );
}
