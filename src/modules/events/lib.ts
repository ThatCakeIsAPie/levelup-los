/**
 * Pure helpers shared by the Events list and event detail pages: labels, date
 * ranges, countdowns, the attendance funnel and the "needs attention" rules.
 */
import { differenceInCalendarDays, format } from "date-fns";
import { localDate, parseDate } from "@/data";
import type { Attendance, CrmEvent } from "@/data";
import type { Tone } from "@/components/brand";

/** "Nov 7, 2026", "Nov 7–8, 2026", "Oct 31 – Nov 1, 2026" or across years. */
export function formatEventRange(e: Pick<CrmEvent, "date" | "endDate">): string {
  const start = parseDate(e.date);
  if (!e.endDate || e.endDate === e.date) return format(start, "MMM d, yyyy");
  const end = parseDate(e.endDate);
  if (start.getFullYear() !== end.getFullYear())
    return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
  if (start.getMonth() !== end.getMonth())
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  return `${format(start, "MMM d")}–${format(end, "d, yyyy")}`;
}

/** Calendar days until the event starts (negative once it has started). */
export function daysUntil(date: string, today = new Date()): number {
  return differenceInCalendarDays(parseDate(date), today);
}

export type EventTiming =
  { kind: "upcoming"; days: number } | { kind: "now" } | { kind: "past"; days: number };

export function eventTiming(
  e: Pick<CrmEvent, "date" | "endDate">,
  today = new Date(),
): EventTiming {
  const start = daysUntil(e.date, today);
  if (start > 0) return { kind: "upcoming", days: start };
  const end = daysUntil(e.endDate ?? e.date, today);
  if (end >= 0) return { kind: "now" };
  return { kind: "past", days: -end };
}

/** "In 26 days", "Tomorrow", "Happening now", "Yesterday", "12 days ago". */
export function timingLabel(t: EventTiming): string {
  if (t.kind === "now") return "Happening now";
  if (t.kind === "upcoming") return t.days === 1 ? "Tomorrow" : `In ${t.days} days`;
  return t.days === 1 ? "Yesterday" : `${t.days} days ago`;
}

export const shortDate = (d: string) => format(parseDate(d), "MMM d");

// ---------------------------------------------------------------------------
// Funnel / board stages
// ---------------------------------------------------------------------------

/** Board columns and funnel steps, in order. */
export type StageKey = "invited" | "interested" | "date" | "ticket" | "attended";

export const STAGES: { key: StageKey; label: string; funnelLabel: string; dot: string }[] = [
  { key: "invited", label: "Invited", funnelLabel: "Invited", dot: "bg-faint" },
  { key: "interested", label: "Interested", funnelLabel: "Interested", dot: "bg-sky" },
  { key: "date", label: "Date set", funnelLabel: "Committed", dot: "bg-amber" },
  { key: "ticket", label: "Ticket", funnelLabel: "Has a ticket", dot: "bg-teal" },
  { key: "attended", label: "Attended", funnelLabel: "Attended", dot: "bg-good" },
];

/** The furthest stage an attendance row has reached (board column). */
export function stageOf(a: Attendance): StageKey {
  if (a.attended === true) return "attended";
  if (a.hasTicket) return "ticket";
  if (a.plannedPurchaseDate) return "date";
  if (a.desireToAttend === "yes" || a.desireToAttend === "maybe") return "interested";
  return "invited";
}

const STAGE_INDEX: Record<StageKey, number> = {
  invited: 0,
  interested: 1,
  date: 2,
  ticket: 3,
  attended: 4,
};

/**
 * Cumulative funnel: each step counts the people who reached it OR went
 * further, so the numbers never go up from one step to the next and every
 * share is out of the people invited (the attendance rows).
 */
export function funnelCounts(rows: Attendance[]): Record<StageKey, number> {
  const out: Record<StageKey, number> = {
    invited: 0,
    interested: 0,
    date: 0,
    ticket: 0,
    attended: 0,
  };
  for (const a of rows) {
    const reached = STAGE_INDEX[stageOf(a)];
    for (const s of STAGES) if (STAGE_INDEX[s.key] <= reached) out[s.key]++;
  }
  return out;
}

/** Patch that moves a row to a board column (same rules as the old kanban). */
export function patchForStage(a: Attendance, target: StageKey): Partial<Attendance> {
  switch (target) {
    case "invited":
      return {
        desireToAttend: undefined,
        plannedPurchaseDate: undefined,
        hasTicket: false,
        attended: undefined,
      };
    case "interested":
      return {
        desireToAttend: a.desireToAttend === "maybe" ? "maybe" : "yes",
        plannedPurchaseDate: undefined,
        hasTicket: false,
        attended: undefined,
      };
    case "date":
      return {
        desireToAttend: a.desireToAttend ?? "yes",
        hasTicket: false,
        plannedPurchaseDate: a.plannedPurchaseDate ?? localDate(addDaysLocal(7)),
        attended: undefined,
      };
    case "ticket":
      return {
        desireToAttend: "yes",
        hasTicket: true,
        mode: a.mode ?? "in_person",
        attended: undefined,
      };
    case "attended":
      return {
        desireToAttend: "yes",
        hasTicket: true,
        mode: a.mode ?? "in_person",
        attended: true,
      };
  }
}

function addDaysLocal(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

// ---------------------------------------------------------------------------
// Status labels
// ---------------------------------------------------------------------------

export const DESIRE_LABEL = { yes: "Wants to go", maybe: "Maybe", no: "Not going" } as const;
export const DESIRE_TONE: Record<"yes" | "maybe" | "no", Tone> = {
  yes: "good",
  maybe: "info",
  no: "neutral",
};

/** The one status chip that best describes a row (used on cards and in Compare). */
export function attendanceStatus(a: Attendance | undefined): { label: string; tone: Tone } {
  if (!a) return { label: "Not invited", tone: "neutral" };
  if (a.attended === true) return { label: "Attended", tone: "good" };
  if (a.hasTicket && a.attended === false) return { label: "No-show", tone: "bad" };
  if (a.hasTicket)
    return { label: a.mode === "virtual" ? "Virtual ticket" : "Has ticket", tone: "info" };
  if (a.desireToAttend === "no") return { label: "Not going", tone: "neutral" };
  if (a.plannedPurchaseDate)
    return { label: `Buying by ${shortDate(a.plannedPurchaseDate)}`, tone: "warn" };
  if (a.desireToAttend === "yes") return { label: "Wants to go", tone: "warn" };
  if (a.desireToAttend === "maybe") return { label: "Maybe", tone: "info" };
  return { label: "Invited", tone: "neutral" };
}

/** Ticket cell text: "In person", "Virtual", "Plans Oct 20", "No ticket". */
export function ticketStatus(a: Attendance, today = localDate()): { label: string; tone: Tone } {
  if (a.hasTicket) return { label: a.mode === "virtual" ? "Virtual" : "In person", tone: "info" };
  if (a.plannedPurchaseDate)
    return {
      label: `Plans ${shortDate(a.plannedPurchaseDate)}`,
      tone: a.plannedPurchaseDate < today ? "bad" : "warn",
    };
  return { label: "No ticket", tone: "neutral" };
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

/** Risk reasons for one row, most urgent first (replaces the old RiskFlags copy). */
export function riskReasons(a: Attendance, today = localDate()): { label: string; tone: Tone }[] {
  const out: { label: string; tone: Tone }[] = [];
  if (!a.hasTicket && a.plannedPurchaseDate && a.plannedPurchaseDate < today)
    out.push({ label: "Planned ticket date passed", tone: "bad" });
  if (a.desireToAttend === "yes" && !a.hasTicket && !a.helperId)
    out.push({ label: "Wants to go, no helper", tone: "bad" });
  if (a.desireToAttend === "yes" && !a.hasTicket && !a.followUpDate)
    out.push({ label: "Wants to go, no follow-up set", tone: "warn" });
  return out;
}

// The shared rule lives in @/data so the nav badge and every card agree.
export { attentionItems, type AttentionCode, type AttentionItem } from "@/data";
