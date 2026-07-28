import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "../components/Nav";
import { apiSafe } from "../lib/api";

export const metadata: Metadata = {
  title: "CITS WhatsApp Communication Manager",
  description: "Internal multi-client WhatsApp campaign and inbox platform (see docs/PRD.md)",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The unread badge is a nice-to-have: if the API is unreachable the shell
  // must still render, so the error is visible inside the page rather than
  // as a blank screen.
  const dash = await apiSafe<{ conversations: { unread: number } }>("/workspace/dashboard?days=1");
  const unread = dash.ok ? dash.data.conversations.unread : 0;

  return (
    <html lang="en">
      <body>
        <div className="app">
          <Nav unreadCount={unread} />
          <div className="main">{children}</div>
        </div>
      </body>
    </html>
  );
}
