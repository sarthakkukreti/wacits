"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "../app/login/actions";

const LINKS = [
  { section: "Messaging" },
  { href: "/", label: "Dashboard", icon: "▪" },
  { href: "/inbox", label: "Inbox", icon: "✉" },
  { href: "/campaigns", label: "Campaigns", icon: "◈" },
  { href: "/messages", label: "Message log", icon: "⇄" },
  { section: "Audience" },
  { href: "/contacts", label: "Contacts", icon: "☰" },
  { href: "/contacts/import", label: "Import CSV", icon: "↑" },
  { section: "Configuration" },
  { href: "/templates", label: "Templates", icon: "▤" },
  { href: "/settings", label: "Settings", icon: "⚙" },
] as const;

export function Nav({
  unreadCount,
  superAdmin,
  email,
}: {
  unreadCount?: number;
  superAdmin?: boolean;
  email?: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // A route change means the user just navigated via the drawer (or
  // otherwise) — close it rather than leaving it open over the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Belt-and-suspenders: layout.tsx already doesn't render Nav on /login,
  // this just guards against Nav ever being rendered from somewhere else.
  if (pathname === "/login") return null;

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    // /contacts/import must not also light up /contacts.
    if (href === "/contacts") return pathname === "/contacts" || /^\/contacts\/[^/]+$/.test(pathname);
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      {/* Below 820px .sidebar is hidden entirely (globals.css) — this is
       *  the only way to reach navigation on mobile. */}
      <div className="mobile-topbar">
        <button
          type="button"
          className="mobile-nav-btn"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={mobileOpen}
        >
          <span aria-hidden>☰</span>
        </button>
        <strong>CITS WhatsApp</strong>
        <span style={{ width: 34 }} aria-hidden />
      </div>

      {mobileOpen && <div className="mobile-nav-backdrop" onClick={() => setMobileOpen(false)} />}

      <aside className={mobileOpen ? "sidebar mobile-open" : "sidebar"}>
        <div className="sidebar-brand flex-between">
          <div>
            <strong>CITS WhatsApp</strong>
            <span>Communication Manager</span>
          </div>
          {mobileOpen && (
            <button type="button" className="mobile-nav-btn" onClick={() => setMobileOpen(false)} aria-label="Close navigation menu">
              <span aria-hidden>✕</span>
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          {LINKS.map((link, i) =>
            "section" in link ? (
              <div key={`s-${i}`} className="nav-section">
                {link.section}
              </div>
            ) : (
              <Link key={link.href} href={link.href} className={isActive(link.href) ? "active" : ""}>
                <span className="nav-icon" aria-hidden>
                  {link.icon}
                </span>
                <span>{link.label}</span>
                {link.href === "/inbox" && !!unreadCount && <span className="nav-badge">{unreadCount}</span>}
              </Link>
            ),
          )}
        </nav>

        <div className="sidebar-foot">
          {email && (
            <div className="sidebar-account">
              <div className="sidebar-account-email" title={email}>
                {email}
              </div>
              {superAdmin && (
                <span className="badge badge-ok mt-8" style={{ display: "inline-flex" }}>
                  Super Admin
                </span>
              )}
              <form action={logoutAction}>
                <button type="submit" className="btn btn-sm w-auto mt-8">
                  Sign out
                </button>
              </form>
            </div>
          )}
          <div className="faint small mt-8">Cyberlative IT Solutions</div>
        </div>
      </aside>
    </>
  );
}
