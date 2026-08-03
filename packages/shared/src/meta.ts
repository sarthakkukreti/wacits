/**
 * PRD §13 / Appendix B — the Meta WhatsApp Cloud API client.
 *
 * This is the only place in the codebase that talks to Meta over HTTP.
 * Everything else goes through these functions so that error shape,
 * timeouts and the `api_surface` label used by the error-classification
 * table (DM-27) are defined exactly once.
 *
 * Tokens are passed in per call rather than read from the environment here:
 * per-client sender numbers each have their own token in the `access_token`
 * table (encrypted at rest), and the system user token is only a fallback
 * for portfolio-level operations. Never log a token value.
 */

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION ?? "v25.0";
const GRAPH_BASE = "https://graph.facebook.com";

/** Default per-request timeout. Meta is normally fast; a hung socket must
 *  never wedge a worker, so every call is bounded. */
const DEFAULT_TIMEOUT_MS = 20_000;

export type MetaErrorDetail = {
  /** Top-level Graph error code, e.g. 131026. Stringified — the
   *  classification table is keyed on strings (see error-codes.ts). */
  code: string;
  subcode?: string;
  title?: string;
  message?: string;
  /** Meta nests the useful human text here on messaging errors. */
  details?: string;
  /** Which endpoint produced it — the (api_surface, code) pair is the key
   *  into error_code_classification; code alone is ambiguous (DM-27). */
  apiSurface: string;
  httpStatus: number;
  raw: unknown;
};

export class MetaApiError extends Error {
  readonly detail: MetaErrorDetail;
  constructor(detail: MetaErrorDetail) {
    super(`[${detail.apiSurface}] Meta error ${detail.code}: ${detail.title ?? detail.message ?? "unknown"}`);
    this.name = "MetaApiError";
    this.detail = detail;
  }
}

/** Thrown for transport-level failures (DNS, TLS, timeout) — distinct from
 *  a structured Meta error, and always worth retrying. */
export class MetaTransportError extends Error {
  readonly apiSurface: string;
  constructor(apiSurface: string, cause: unknown) {
    super(`[${apiSurface}] transport failure: ${String(cause)}`);
    this.name = "MetaTransportError";
    this.apiSurface = apiSurface;
  }
}

/**
 * Removes an access token from any string before it is shown or logged.
 * Redacts both the exact token we sent and anything else shaped like a Meta
 * token, since the error body is attacker-influenced text we do not control.
 */
function redactToken(text: string, token: string): string {
  let out = token ? text.split(token).join("[redacted token]") : text;
  // Meta tokens start EAA and run for dozens of base64-ish characters.
  out = out.replace(/EAA[A-Za-z0-9_\-]{10,}/g, "[redacted token]");
  return out;
}

async function graphFetch<T>(opts: {
  method: "GET" | "POST" | "DELETE";
  path: string;
  /** The label used for error classification, e.g. "/messages". Not the
   *  full path — the phone-number id must not become part of the key. */
  apiSurface: string;
  token: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
  timeoutMs?: number;
}): Promise<T> {
  const { method, path, apiSurface, token, body, query, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

  const url = new URL(`${GRAPH_BASE}/${GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (cause) {
    throw new MetaTransportError(apiSurface, cause);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body from Meta is itself an error condition.
  }

  if (!res.ok || parsed?.error) {
    const err = parsed?.error ?? {};
    // Meta echoes the offending access token back inside the error text on
    // auth failures ("Malformed access token EAAG…"). That message is shown
    // to operators and written to logs, so the credential must be scrubbed
    // out of everything that leaves this function (§19 — never log a token).
    const scrub = (value: unknown) => (typeof value === "string" ? redactToken(value, token) : value);

    throw new MetaApiError({
      code: String(err.code ?? res.status),
      subcode: err.error_subcode !== undefined ? String(err.error_subcode) : undefined,
      title: scrub(err.error_user_title ?? err.type) as string | undefined,
      message: scrub(err.message) as string | undefined,
      details: scrub(err.error_data?.details ?? err.error_user_msg) as string | undefined,
      apiSurface,
      httpStatus: res.status,
      raw: scrub(text),
    });
  }

  return parsed as T;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type SendResult = {
  /** Meta's message id. Recorded on `message.wamid` (AR-15). */
  wamid: string;
  /** The number Meta actually resolved the recipient to; can differ from
   *  what was sent (Meta rewrites some legacy formats, notably older
   *  Mexican and Argentinian numbers). */
  resolvedWaId?: string;
};

function extractSendResult(payload: any): SendResult {
  const wamid = payload?.messages?.[0]?.id;
  if (!wamid) {
    throw new Error(`Meta accepted the send but returned no message id: ${JSON.stringify(payload)}`);
  }
  return { wamid, resolvedWaId: payload?.contacts?.[0]?.wa_id };
}

/**
 * Free-form text. Only legal inside an open 24-hour customer service window
 * (PRD §14) — outside it Meta returns 131047 and the message is not
 * delivered. The caller is responsible for checking the window first; this
 * function deliberately does not, so that the window rule lives in one
 * place (the API layer) rather than being duplicated here.
 */
export async function sendTextMessage(args: {
  phoneNumberId: string;
  token: string;
  toWaId: string;
  body: string;
  /** Echoed back on every status webhook — how a status is correlated to
   *  the outbox row without depending on wamid arriving first (AR-14). */
  bizOpaqueCallbackData?: string;
  previewUrl?: boolean;
}): Promise<SendResult> {
  const payload = await graphFetch<any>({
    method: "POST",
    path: `${args.phoneNumberId}/messages`,
    apiSurface: "/messages",
    token: args.token,
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: args.toWaId,
      type: "text",
      text: { body: args.body, preview_url: args.previewUrl ?? false },
      ...(args.bizOpaqueCallbackData ? { biz_opaque_callback_data: args.bizOpaqueCallbackData } : {}),
    },
  });
  return extractSendResult(payload);
}

export type TemplateComponentParam =
  | { type: "text"; text: string }
  | { type: "currency"; currency: { fallback_value: string; code: string; amount_1000: number } }
  | { type: "date_time"; date_time: { fallback_value: string } }
  | { type: "image"; image: { link: string } }
  | { type: "document"; document: { link: string; filename?: string } }
  | { type: "video"; video: { link: string } };

export type TemplateComponent = {
  type: "header" | "body" | "button";
  sub_type?: "quick_reply" | "url";
  index?: string;
  parameters: TemplateComponentParam[];
};

/**
 * Template send — the only way to start a conversation outside the 24-hour
 * window, and therefore what every campaign uses (PRD §12/§13).
 */
export async function sendTemplateMessage(args: {
  phoneNumberId: string;
  token: string;
  toWaId: string;
  templateName: string;
  languageCode: string;
  components?: TemplateComponent[];
  bizOpaqueCallbackData?: string;
}): Promise<SendResult> {
  const payload = await graphFetch<any>({
    method: "POST",
    path: `${args.phoneNumberId}/messages`,
    apiSurface: "/messages",
    token: args.token,
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: args.toWaId,
      type: "template",
      template: {
        name: args.templateName,
        language: { code: args.languageCode },
        ...(args.components?.length ? { components: args.components } : {}),
      },
      ...(args.bizOpaqueCallbackData ? { biz_opaque_callback_data: args.bizOpaqueCallbackData } : {}),
    },
  });
  return extractSendResult(payload);
}

/** Marks an inbound message read — the blue ticks the contact sees. */
export async function markMessageRead(args: {
  phoneNumberId: string;
  token: string;
  wamid: string;
}): Promise<void> {
  await graphFetch({
    method: "POST",
    path: `${args.phoneNumberId}/messages`,
    apiSurface: "/messages",
    token: args.token,
    body: { messaging_product: "whatsapp", status: "read", message_id: args.wamid },
  });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export type MetaTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components: unknown[];
  quality_score?: { score?: string };
};

/** Lists templates on a WABA. Templates belong to the WABA, never to a
 *  phone number (PRD §11) — passing a phone-number id here is a bug. */
export async function listTemplates(args: {
  wabaId: string;
  token: string;
  limit?: number;
}): Promise<MetaTemplate[]> {
  const out: MetaTemplate[] = [];
  let after: string | undefined;

  // Paginate to completion: a WABA can hold hundreds of templates and the
  // default page is 25, so a single call would silently truncate the list.
  do {
    const page = await graphFetch<any>({
      method: "GET",
      path: `${args.wabaId}/message_templates`,
      apiSurface: "/message_templates",
      token: args.token,
      query: {
        limit: String(args.limit ?? 100),
        after,
        fields: "id,name,language,status,category,components,quality_score",
      },
    });
    out.push(...(page?.data ?? []));
    after = page?.paging?.cursors?.after && page?.paging?.next ? page.paging.cursors.after : undefined;
  } while (after);

  return out;
}

// ---------------------------------------------------------------------------
// Token health (SN-17/SN-18)
// ---------------------------------------------------------------------------

/**
 * Self-inspects a stored token via Meta's /debug_token — works for both
 * WABA- and phone-number-scoped tokens without needing to know which Meta
 * object it belongs to, since a token can always inspect itself. Used by
 * the scheduler's periodic health check (apps/workers/src/scheduler-worker.ts).
 */
export async function checkTokenHealth(args: { token: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await graphFetch<{ data?: { is_valid?: boolean } }>({
      method: "GET",
      path: "debug_token",
      apiSurface: "/debug_token",
      token: args.token,
      query: { input_token: args.token },
    });
    if (result.data?.is_valid === false) {
      return { ok: false, error: "Token reported as invalid by Meta" };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof MetaApiError) return { ok: false, error: err.message };
    throw err; // transport failure — let the caller decide whether to retry
  }
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** Resolves an inbound media id to a temporary download URL. The URL is
 *  short-lived and still requires the bearer token to fetch. */
export async function getMediaUrl(args: { mediaId: string; token: string }): Promise<{ url: string; mimeType: string }> {
  const payload = await graphFetch<any>({
    method: "GET",
    path: args.mediaId,
    apiSurface: "/media",
    token: args.token,
  });
  return { url: payload.url, mimeType: payload.mime_type };
}

export async function downloadMedia(args: { url: string; token: string }): Promise<ArrayBuffer> {
  const res = await fetch(args.url, { headers: { Authorization: `Bearer ${args.token}` } });
  if (!res.ok) throw new Error(`Media download failed with HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** Uploads media for outbound use and returns the id to reference in a
 *  send. Note Meta expires uploaded media after 30 days. */
export async function uploadMedia(args: {
  phoneNumberId: string;
  token: string;
  file: Blob;
  filename: string;
}): Promise<{ id: string }> {
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("file", args.file, args.filename);

  const res = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/${args.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.token}` },
    body: form,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || (payload as any)?.error) {
    const err = (payload as any)?.error ?? {};
    throw new MetaApiError({
      code: String(err.code ?? res.status),
      title: err.error_user_title ?? err.type,
      message: err.message,
      apiSurface: "/media",
      httpStatus: res.status,
      raw: payload,
    });
  }
  return payload as { id: string };
}

export { GRAPH_VERSION };
