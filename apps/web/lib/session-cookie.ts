// Deliberately zero imports, including `server-only`: middleware.ts runs in
// the Edge runtime and needs this exact same name, while lib/session.ts
// needs it in the normal server runtime — a shared constant is the only
// thing both contexts can safely import without a runtime mismatch.
export const SESSION_COOKIE = "wacits_session";
