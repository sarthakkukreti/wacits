"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm({ from }: { from: string }) {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <form action={formAction} className="card-pad">
      {state && !state.ok && (
        <div className="notice notice-danger">
          <strong>Could not sign in</strong>
          {state.error}
        </div>
      )}

      <input type="hidden" name="from" value={from} />

      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoFocus autoComplete="username" />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" />
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? <span className="spinner" /> : "Sign in"}
      </button>
    </form>
  );
}
