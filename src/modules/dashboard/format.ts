import { addDays, differenceInCalendarDays, format } from "date-fns";
import type { Tone } from "@/components/brand";
import { localDate, needsTicket, parseDate, type Attendance, type CrmEvent } from "@/data";

/** "Oct 10" */
export const shortDate = (d: string) => format(parseDate(d), "MMM d");

/** "Nov 7–8", "Oct 31 – Nov 1" or "Nov 7". */
export function dateRange(e: CrmEvent): string {
  const start = parseDate(e.date);
  if (!e.endDate || e.endDate === e.date) return format(start, "MMM d");
  const end = parseDate(e.endDate);
  return start.getMonth() === end.getMonth()
    ? `${format(start, "MMM d")}–${format(end, "d")}`
    : `${format(start, "MMM d")} – ${format(end, "MMM d")}`;
}

/** Calendar days from today until the date (negative when past). */
export const daysUntil = (d: string, today = localDate()) =>
  differenceInCalendarDays(parseDate(d), parseDate(today));

/** "today", "tomorrow", "yesterday", "in 3 days", "3 days ago". */
export function relativeDay(d: string): string {
  const n = daysUntil(d);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Ticket numbers for one event, from the viewer's visible attendance rows. */
export function ticketStats(rows: Attendance[], today = localDate()) {
  const weekEnd = localDate(addDays(parseDate(today), 6));
  const invited = rows.length;
  const bought = rows.filter((a) => a.hasTicket).length;
  const plannedThisWeek = rows.filter(
    (a) =>
      !a.hasTicket &&
      !!a.plannedPurchaseDate &&
      a.plannedPurchaseDate >= today &&
      a.plannedPurchaseDate <= weekEnd,
  ).length;
  const needTicket = rows.filter(needsTicket).length;
  return { invited, bought, plannedThisWeek, needTicket };
}

/** The event the dashboard features: the next conference, else the next event. */
export function pickFeaturedEvent(
  upcoming: CrmEvent[],
  mine: Attendance[],
  candidate: boolean,
): CrmEvent | undefined {
  if (candidate) {
    const onList = new Set(mine.map((a) => a.eventId));
    const own = upcoming.find((e) => onList.has(e.id));
    if (own) return own;
  }
  return upcoming.find((e) => e.type === "conference") ?? upcoming[0];
}

/** Status of one person's attendance row, for chips. */
export function attendanceStatus(a: Attendance | undefined): {
  tone: Tone;
  label: string;
  detail?: string;
} {
  if (!a) return { tone: "neutral", label: "Not on the list yet" };
  if (a.hasTicket) return { tone: "good", label: "Ticket bought" };
  if (a.desireToAttend === "no") return { tone: "neutral", label: "Not going" };
  const detail = a.plannedPurchaseDate
    ? `Plans to buy by ${shortDate(a.plannedPurchaseDate)}`
    : a.followUpDate
      ? `Follow-up ${shortDate(a.followUpDate)}`
      : undefined;
  if (a.desireToAttend === "maybe") return { tone: "info", label: "Thinking about it", detail };
  return { tone: "warn", label: "No ticket yet", detail };
}
