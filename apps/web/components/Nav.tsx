"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { section: "Messaging" },
  { href: "/", label: "Dashboard", icon: "▪" },
  { href: "/inbox", label: "Inbox", icon: "✉" },
  { href: "/campaigns", label: "Campaigns", icon: "◈" },
  { section: "Audience" },
  { href: "/contacts", label: "Contacts", icon: "☰" },
  { href: "/contacts/import", label: "Import CSV", icon: "↑" },
  { section: "Configuration" },
  { href: "/templates", label: "Templates", icon: "▤" },
  { href: "/settings", label: "Settings", icon: "⚙" },
] as const;

export function Nav({ unreadCount }: { unreadCount?: number }) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    // /contacts/import must not also light up /contacts.
    if (href === "/contacts") return pathname === "/contacts" || /^\/contacts\/[^/]+$/.test(pathname);
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <strong>CITS WhatsApp</strong>
        <span>Communication Manager</span>
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

      <div className="sidebar-foot">Cyberlative IT Solutions</div>
    </aside>
  );
}
