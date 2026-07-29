import { NextResponse } from "next/server";
import { apiSafe } from "../../../../lib/api";
import { getSession } from "../../../../lib/session";

/**
 * Polling endpoint for the open chat thread.
 *
 * This exists so the browser can refresh a conversation without the API
 * shared secret ever reaching client-side JavaScript: the browser calls
 * this same-origin route, and the Next.js server adds the credential (see
 * lib/api.ts). It is a thin read-only proxy and deliberately exposes
 * nothing the thread page itself does not already render.
 *
 * middleware.ts already blocks a request with no session cookie at all
 * (Route Handlers are inside its matcher). This is the same defense-in-depth
 * check the root layout applies to every rendered page — a cookie that's
 * present but expired or revoked still gets refused here, since Route
 * Handlers bypass the React tree entirely and never see layout.tsx.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const result = await apiSafe(`/workspace/inbox/conversations/${id}`);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 });
  }
  return NextResponse.json(result.data);
}
