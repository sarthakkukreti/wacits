/**
 * DM-1: everything is stored UTC and rendered in Asia/Kolkata at the
 * presentation layer only. These helpers are that layer — no component
 * should call toLocaleString directly with its own timezone guess.
 */

const TZ = process.env.NEXT_PUBLIC_DISPLAY_TIMEZONE ?? "Asia/Kolkata";

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

export function formatDay(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";

  const today = new Date();
  const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (isSameDay(d, today)) return "Today";

  const yesterday = new Date(today.getTime() - 86_400_000);
  if (isSameDay(d, yesterday)) return "Yesterday";

  return d.toLocaleDateString("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });
}

/** Compact relative time for conversation lists: "3m", "2h", "5d". */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";

  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return formatDay(d);
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-IN");
}

export function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

/** Time left before a 24-hour service window closes. */
export function formatWindowRemaining(expiresAt: string | Date | null | undefined): string | null {
  if (!expiresAt) return null;
  const d = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
}

export function contactName(c: {
  firstName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
}): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.phoneNumber || "Unknown";
}
