/**
 * The one "needs attention" rule for event rosters (pure). Used by the Events
 * nav badge, the event cards on the Events list and the Dashboard, and the
 * event page's attention panel, so every count agrees.
 */
import { addDays, format } from "date-fns";
import { localDate, parseDate } from "@/lib/dates";
import type { Attendance } from "@/stores/attendanceStore";
import type { CrmEvent } from "@/stores/eventsStore";

export type AttentionCode =
  "date_passed" | "no_helper" | "no_followup" | "buy_due" | "followup_due" | "unrecorded";

export interface AttentionItem {
  a: Attendance;
  code: AttentionCode;
  label: string;
  tone: "good" | "warn" | "bad" | "info" | "neutral";
}

const short = (d: string) => format(parseDate(d), "MMM d");

/**
 * An event as the rule needs it: its days, and whether its category uses
 * tickets (`usesTickets(category)` from src/data/eventCategories).
 */
export type AttentionEvent = Pick<CrmEvent, "date" | "endDate"> & { tickets: boolean };

/**
 * Everyone on an event who needs a nudge this week, one item per person,
 * most urgent first. Upcoming events flag: planned ticket date passed,
 * planning to buy within a week, a follow-up due within a week, and people
 * who want to go with no helper or no follow-up set. Finished events only
 * flag ticket holders whose attendance was never recorded.
 */
export function attentionItems(
  /** Events whose category has no tickets (Night Owls, trainings...) only flag follow-ups due. */
  event: AttentionEvent,
  rows: Attendance[],
  now = new Date(),
  /** People hidden from reminders ("Do not contact" on the customer board). */
  skip?: ReadonlySet<string>,
): AttentionItem[] {
  const today = localDate(now);
  const weekOut = localDate(addDays(parseDate(today), 7));
  const finished = (event.endDate ?? event.date) < today;
  const out: AttentionItem[] = [];
  const followUpDue = (a: Attendance) =>
    !!a.followUpDate && a.followUpDate >= today && a.followUpDate <= weekOut;
  const tickets = event.tickets;
  for (const a of rows) {
    if (skip?.has(a.personId)) continue;
    if (!tickets) {
      if (!finished && a.desireToAttend !== "no" && followUpDue(a))
        out.push({
          a,
          code: "followup_due",
          label: `Follow up ${short(a.followUpDate!)}`,
          tone: "info",
        });
      continue;
    }
    if (finished) {
      if (a.hasTicket && a.attended === undefined)
        out.push({ a, code: "unrecorded", label: "Attendance not recorded", tone: "warn" });
      continue;
    }
    if (a.hasTicket || a.desireToAttend === "no") {
      if (followUpDue(a))
        out.push({
          a,
          code: "followup_due",
          label: `Follow up ${short(a.followUpDate!)}`,
          tone: "info",
        });
      continue;
    }
    if (a.plannedPurchaseDate && a.plannedPurchaseDate < today) {
      out.push({
        a,
        code: "date_passed",
        label: `Planned to buy by ${short(a.plannedPurchaseDate)}`,
        tone: "bad",
      });
    } else if (a.plannedPurchaseDate && a.plannedPurchaseDate <= weekOut) {
      out.push({
        a,
        code: "buy_due",
        label: `Plans to buy by ${short(a.plannedPurchaseDate)}`,
        tone: "warn",
      });
    } else if (followUpDue(a)) {
      out.push({
        a,
        code: "followup_due",
        label: `Follow up ${short(a.followUpDate!)}`,
        tone: "info",
      });
    } else if (a.desireToAttend === "yes" && !a.helperId) {
      out.push({ a, code: "no_helper", label: "Wants to go, no helper", tone: "bad" });
    } else if (a.desireToAttend === "yes" && !a.followUpDate) {
      out.push({ a, code: "no_followup", label: "Wants to go, no follow-up set", tone: "warn" });
    }
  }
  const rank: Record<AttentionCode, number> = {
    date_passed: 0,
    unrecorded: 0,
    no_helper: 1,
    buy_due: 2,
    followup_due: 3,
    no_followup: 4,
  };
  return out.sort((x, y) => rank[x.code] - rank[y.code]);
}

/**
 * People needing attention across events that haven't finished yet (the
 * Events nav badge). `rows` may span every event; each event counts its own.
 */
export function upcomingAttentionCount(
  events: (AttentionEvent & Pick<CrmEvent, "id">)[],
  rows: Attendance[],
  now = new Date(),
  skip?: ReadonlySet<string>,
): number {
  const today = localDate(now);
  let n = 0;
  for (const e of events) {
    if ((e.endDate ?? e.date) < today) continue;
    n += attentionItems(
      e,
      rows.filter((a) => a.eventId === e.id),
      now,
      skip,
    ).length;
  }
  return n;
}

/** Still needs a ticket: no ticket yet and hasn't said they're not going. */
export const needsTicket = (a: Attendance) => !a.hasTicket && a.desireToAttend !== "no";
