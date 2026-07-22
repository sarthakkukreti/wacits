import { NextResponse } from "next/server";
import { apiSafe } from "../../../../lib/api";

/**
 * Polling endpoint for the open chat thread.
 *
 * This exists so the browser can refresh a conversation without the API
 * shared secret ever reaching client-side JavaScript: the browser calls
 * this same-origin route, and the Next.js server adds the credential (see
 * lib/api.ts). It is a thin read-only proxy and deliberately exposes
 * nothing the thread page itself does not already render.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const result = await apiSafe(`/workspace/inbox/conversations/${id}`);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 });
  }
  return NextResponse.json(result.data);
}
