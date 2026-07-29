import "server-only";

/**
 * Server-side API client. This module must never be imported into a client
 * component: it holds the API shared secret, and the whole point of routing
 * every call through the Next.js server is that the browser never sees it.
 *
 * The `server-only` import above turns a mistake here into a build error
 * rather than a silently leaked credential.
 */

const API_URL = process.env.API_BASE_URL ?? "http://localhost:8787";
const API_SHARED_SECRET = process.env.API_SHARED_SECRET;

/** The workspace this deployment operates on. Multi-workspace switching is
 *  §5 work; today CITS runs one, resolved by slug at startup. */
const WORKSPACE_SLUG = process.env.WORKSPACE_SLUG ?? "cits-internal";

export class ApiError extends Error {
  readonly status: number;
  readonly payload: any;
  constructor(status: number, payload: any) {
    super(payload?.error ?? `API request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

let cachedClientId: string | null = null;

async function resolveClientId(): Promise<string> {
  if (cachedClientId) return cachedClientId;

  const res = await fetch(`${API_URL}/clients/by-slug/${WORKSPACE_SLUG}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.json().catch(() => ({ error: "Could not resolve workspace" })));
  }
  const body = await res.json();
  cachedClientId = body.id;
  return body.id;
}

function authHeaders(): Record<string, string> {
  if (!API_SHARED_SECRET) {
    throw new Error("API_SHARED_SECRET is not set — the web app cannot authenticate to the API.");
  }
  return { Authorization: `Bearer ${API_SHARED_SECRET}` };
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Workspace routes need the tenant header; platform routes do not. */
  tenant?: boolean;
  /** The end-user's session token (from the wacits_session cookie), sent as
   *  x-session-token — a separate header from Authorization, which stays
   *  the service-to-service secret. Only /auth/* routes need this. */
  sessionToken?: string;
};

export async function api<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, tenant = true, sessionToken } = opts;

  const headers: Record<string, string> = { ...authHeaders() };
  if (body) headers["Content-Type"] = "application/json";
  if (tenant) headers["x-client-id"] = await resolveClientId();
  if (sessionToken) headers["x-session-token"] = sessionToken;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload as T;
}

/** For UI that wants to render an error rather than crash the page. */
export async function apiSafe<T = any>(
  path: string,
  opts: RequestOptions = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    return { ok: true, data: await api<T>(path, opts) };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message, status: err.status };
    return { ok: false, error: String(err), status: 0 };
  }
}

export { API_URL, WORKSPACE_SLUG };
