import { format } from "date-fns";
import { isUpcoming, localDate, parseDate, type Attendance, type CrmEvent } from "@/data";
import type { Tone } from "@/components/brand";

/** "Oct 3" this year, "Oct 3, 2025" otherwise (or always with `year: true`). */
export function fmtDate(d: string | undefined, opts: { year?: boolean } = {}): string {
  if (!d) return "";
  const date = parseDate(d);
  const withYear = opts.year ?? date.getFullYear() !== new Date().getFullYear();
  return format(date, withYear ? "MMM d, yyyy" : "MMM d");
}

/** "Today", "1 day", "9 days". */
export function daysLabel(n: number | null): string {
  if (n === null) return "Never";
  if (n <= 0) return "Today";
  return n === 1 ? "1 day" : `${n} days`;
}

/** "in 53 days", "tomorrow", "today", "2 days ago". */
export function relativeDays(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
export const fmtMoney = (n: number) => money.format(n);

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Labels for the keys returned by missingRequiredFields(). */
export const FIELD_LABEL: Record<string, string> = {
  name: "name",
  owner: "owner",
  iboNumber: "IBO#",
  ltdNumber: "LTD#",
  businessStartDate: "business start date",
};

export const TICKET_TYPE_LABEL = { in_person: "In person", virtual: "Virtual" } as const;
export const COMING_LABEL = { yes: "Coming", maybe: "Maybe", no: "Can't make it" } as const;
export const DESIRE_LABEL = { yes: "Wants to go", maybe: "Maybe", no: "Not going" } as const;

export type ChipSpec = { tone: Tone; label: string };

/**
 * Status chips for one attendance row (desire / ticket / attended). `tickets`:
 * the event's category uses tickets (`usesTickets(category)`).
 */
export function attendanceChips(
  a: Attendance,
  ev: CrmEvent,
  tickets: boolean,
  today = localDate(),
): ChipSpec[] {
  const chips: ChipSpec[] = [];
  // Events without tickets: coming / came (and how), nothing about tickets.
  if (!tickets) {
    if (a.attended === true)
      chips.push({ tone: "good", label: a.mode === "virtual" ? "Came · virtual" : "Came" });
    else if (a.attended === false) chips.push({ tone: "bad", label: "Wasn't there" });
    else if (a.desireToAttend)
      chips.push({
        tone:
          a.desireToAttend === "yes" ? "good" : a.desireToAttend === "maybe" ? "info" : "neutral",
        label: COMING_LABEL[a.desireToAttend],
      });
    else if (!isUpcoming(ev, today)) chips.push({ tone: "neutral", label: "Not recorded" });
    return chips;
  }
  if (isUpcoming(ev, today)) {
    if (a.desireToAttend) {
      const tone: Tone =
        a.desireToAttend === "yes" ? "good" : a.desireToAttend === "maybe" ? "info" : "neutral";
      chips.push({ tone, label: DESIRE_LABEL[a.desireToAttend] });
    }
    if (a.hasTicket) chips.push({ tone: "good", label: "Ticket bought" });
    else if (a.desireToAttend !== "no") chips.push({ tone: "warn", label: "No ticket yet" });
    return chips;
  }
  if (a.attended === true)
    chips.push({ tone: "good", label: a.mode === "virtual" ? "Attended · virtual" : "Attended" });
  else if (a.hasTicket && a.attended === false) chips.push({ tone: "bad", label: "No-show" });
  else if (a.hasTicket) chips.push({ tone: "warn", label: "Attendance not marked" });
  else if (a.desireToAttend === "yes") chips.push({ tone: "bad", label: "Missed" });
  else if (a.desireToAttend === "no") chips.push({ tone: "neutral", label: "Not going" });
  else chips.push({ tone: "neutral", label: "Didn't go" });
  return chips;
}

/** True when the planned purchase date has passed and there is still no ticket. */
export function purchaseOverdue(a: Attendance, today = localDate()): boolean {
  return !a.hasTicket && !!a.plannedPurchaseDate && a.plannedPurchaseDate < today;
}
