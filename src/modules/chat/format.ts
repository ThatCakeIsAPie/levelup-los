import { differenceInCalendarDays, format } from "date-fns";

/** "5:30 PM" */
export const clockTime = (iso: string) => format(new Date(iso), "h:mm a");

/** Chat list time: "6:41 PM" today, "Yesterday", "Mon" this week, else "Oct 3". */
export function listTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = differenceInCalendarDays(now, d);
  if (days <= 0) return format(d, "h:mm a");
  if (days === 1) return "Yesterday";
  if (days < 7) return format(d, "EEE");
  return format(d, "MMM d");
}

/** Day separator: "Today", "Yesterday", "Monday, Oct 6", or "Oct 6, 2025" in another year. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = differenceInCalendarDays(now, d);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (d.getFullYear() !== now.getFullYear()) return format(d, "MMM d, yyyy");
  return format(d, days < 7 ? "EEEE" : "EEEE, MMM d");
}

/** Local calendar day key for grouping. */
export const dayKey = (iso: string) => format(new Date(iso), "yyyy-MM-dd");

/** Inbox age: "now", "5m", "2h", "1d", then "Oct 3". */
export function shortAgo(iso: string, now = Date.now()): string {
  const mins = Math.floor((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return format(new Date(iso), "MMM d");
}

/** "0:42" */
export function duration(ms: number | null | undefined): string {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const firstName = (n: string) => n.split(" ")[0];

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Absolute link to a message (for "Link to message"). */
export function messageUrl(conversationId: string, messageId: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`;
  return `${base}chats/${encodeURIComponent(conversationId)}?m=${encodeURIComponent(messageId)}`;
}
