import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Nav } from "../components/Nav";
import { ToastProvider } from "../components/Toast";
import { apiSafe } from "../lib/api";
import { requireSession } from "../lib/session";

export const metadata: Metadata = {
  title: "CITS WhatsApp Communication Manager",
  description: "Internal multi-client WhatsApp campaign and inbox platform (see docs/PRD.md)",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // middleware.ts threads the current pathname through so this Server
  // Component (no usePathname() available) can tell it's rendering /login
  // without a request of its own.
  const pathname = (await headers()).get("x-wacits-path") ?? "";
  const isLoginPage = pathname === "/login";

  // requireSession() is the REAL check — middleware only confirms a cookie
  // is present, not that it's still valid. Skipped on /login itself:
  // middleware already redirects an already-logged-in visitor away from
  // /login before this layout ever renders, so there is nothing to check
  // here, and Nav (the only thing that needs `session`) isn't rendered on
  // this branch anyway.
  const session = isLoginPage ? null : await requireSession();

  // The unread badge (and this whole fetch) must not run before login: it's
  // real workspace data, authenticated only by the service-to-service
  // secret, which said nothing about who's actually looking at the page.
  const dash = isLoginPage
    ? null
    : await apiSafe<{ conversations: { unread: number } }>("/workspace/dashboard?days=1");
  const unread = dash?.ok ? dash.data.conversations.unread : 0;

  return (
    <html lang="en">
      <body>
        {session ? (
          <ToastProvider>
            <div className="app">
              <Nav unreadCount={unread} superAdmin={session.user.superAdmin} email={session.user.email} />
              <main className="main">{children}</main>
            </div>
          </ToastProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
