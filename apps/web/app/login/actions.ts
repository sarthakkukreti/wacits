"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { api, apiSafe, ApiError } from "../../lib/api";
import { SESSION_COOKIE } from "../../lib/session-cookie";

export type LoginResult = { ok: false; error: string } | undefined;

export async function loginAction(_prev: LoginResult, formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const from = String(formData.get("from") ?? "/");

  if (!email || !password) return { ok: false, error: "Email and password are required." };

  const hdrs = await headers();
  // Best-effort audit metadata for the session row — see the note in
  // apps/api/src/routes/auth.ts on why this is trusted the same way every
  // other field already is inside the API_SHARED_SECRET boundary.
  const ipAddress = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || undefined;
  const userAgent = hdrs.get("user-agent") || undefined;

  let sessionToken: string;
  let expiresAt: string;
  try {
    const result = await api<{ sessionToken: string; expiresAt: string }>("/auth/login", {
      method: "POST",
      tenant: false,
      body: { email, password, ipAddress, userAgent },
    });
    sessionToken = result.sessionToken;
    expiresAt = result.expiresAt;
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        ok: false,
        error: err.status === 429 ? "Too many attempts. Try again shortly." : "Invalid email or password.",
      };
    }
    return { ok: false, error: "Could not sign in. Try again." };
  }

  (await cookies()).set({
    name: SESSION_COOKIE,
    value: sessionToken,
    httpOnly: true,
    // false in dev so testing over plain http://localhost still works.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });

  // Outside the try/catch above on purpose: redirect() throws internally to
  // unwind the render, and catching that here would turn a successful login
  // into a reported error.
  redirect(from.startsWith("/") && !from.startsWith("//") ? from : "/");
}

export async function logoutAction(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await apiSafe("/auth/logout", { method: "POST", tenant: false, sessionToken: token });
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
