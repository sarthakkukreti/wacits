import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "./lib/session-cookie";

/**
 * The primary, fail-closed gate: every request needs the session cookie
 * present, or it never reaches a page/Route Handler at all. This is a
 * CHEAP check (cookie present, not "still valid") — the real verification
 * against the API happens once per render in requireSession()
 * (apps/web/lib/session.ts), called from the root layout. Both checks
 * exist for a reason: this one is what actually stops an unauthenticated
 * request from reaching anything; that one catches a cookie that's present
 * but expired or revoked, which this layer has no cheap way to know.
 *
 * The matcher deliberately does NOT exclude /api/* — that's exactly the
 * same-origin surface (e.g. app/api/conversations/[id]/route.ts) this
 * whole feature exists to stop being reachable with no login at all.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js|map)$).*)"],
};

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasCookie = !!req.cookies.get(SESSION_COOKIE)?.value;

  // Threaded through so the root layout (a Server Component — no
  // usePathname() available) can tell it's rendering /login without
  // making its own request to find out.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-wacits-path", pathname);
  const withPathname = { request: { headers: requestHeaders } };

  if (pathname === "/login") {
    if (hasCookie) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next(withPathname);
  }

  if (!hasCookie) {
    const from = encodeURIComponent(pathname + req.nextUrl.search);
    return NextResponse.redirect(new URL(`/login?from=${from}`, req.url));
  }

  return NextResponse.next(withPathname);
}
