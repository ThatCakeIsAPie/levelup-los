/**
 * Missed-event follow-ups (pure; docs/plans/mvp-plan-2026-10-13.md "Events").
 *
 * Someone who came to the last event of a type and didn't come to the next
 * one gets a follow-up in the Today list of everyone above them. One rule for
 * every type, worked out per type in one pass:
 *
 *  - Only finished events count (the day after their last day), and only once
 *    attendance was taken for them: at least one row of the event has
 *    attendance recorded (attended or no-show). A Night Owls nobody has
 *    logged yet doesn't make everyone a "miss".
 *  - A streak is the run of counted events of one type since the person last
 *    came to one. Missing several in a row is one follow-up, about the latest.
 *    People who never came to that type have no streak.
 *  - A streak is handled once anyone else logs a contact with the person on or
 *    after the first missed event's day (a check-in, a call, a chat check-in),
 *    or an upline leaves an "already handled" note on one of the missed
 *    events. Handled is handled for every upline at once.
 *  - Only recent misses show: the latest missed event ended within the last
 *    `MISSED_WINDOW_DAYS` days. Coming again ends the streak.
 *
 * Who sees a follow-up is the caller's business (the Today list: people the
 * viewer can see, registered team members only, never the viewer themself).
 */
import { differenceInCalendarDays } from "date-fns";
import { parseDate } from "@/lib/dates";
import type { CrmEvent, EventType } from "@/stores/eventsStore";
import type { Attendance, MissedEventNote } from "@/stores/attendanceStore";
import type { Contact } from "@/stores/crmStore";

/** Misses older than this (by the latest missed event's last day) are left alone. */
export const MISSED_WINDOW_DAYS = 30;

export type MissedHandled =
  | { kind: "contact"; date: string; byId?: string; contactId: string }
  | { kind: "note"; note: MissedEventNote };

export interface MissedStreak {
  /** `${personId}:${type}` (one streak per person and type). */
  key: string;
  personId: string;
  type: EventType;
  /** The last event of this type they came to. */
  lastAttended: CrmEvent;
  /** Counted events of this type since then that they missed, oldest first. */
  missed: CrmEvent[];
  /** The latest missed event (the one the follow-up is about). */
  latest: CrmEvent;
  /** How it was handled (a note wins over a contact); undefined while open. */
  handled?: MissedHandled;
  /** Every note left on this streak's events, newest first. */
  notes: MissedEventNote[];
}

export interface MissedInput {
  events: CrmEvent[];
  /** Attendance rows (the viewer's visible ones). */
  attendances: Attendance[];
  contacts: Pick<Contact, "id" | "personId" | "date" | "byId">[];
  notes: MissedEventNote[];
  /** "YYYY-MM-DD". */
  today: string;
  windowDays?: number;
}

const lastDay = (e: CrmEvent) => e.endDate ?? e.date;
const byDate = (a: CrmEvent, b: CrmEvent) =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/**
 * Every current missed streak (handled or not) within the window, per person
 * and type. Linear in events + rows + contacts + notes.
 */
export function missedEventStreaks(input: MissedInput): MissedStreak[] {
  const { today } = input;
  const windowDays = input.windowDays ?? MISSED_WINDOW_DAYS;

  // Rows per event, and which finished events had attendance taken.
  const rowsByEvent = new Map<string, Attendance[]>();
  for (const a of input.attendances) {
    const list = rowsByEvent.get(a.eventId);
    if (list) list.push(a);
    else rowsByEvent.set(a.eventId, [a]);
  }
  const counted = new Map<EventType, CrmEvent[]>();
  for (const e of input.events) {
    if (lastDay(e) >= today) continue;
    const rows = rowsByEvent.get(e.id);
    if (!rows?.some((a) => a.attended !== undefined)) continue;
    const list = counted.get(e.type);
    if (list) list.push(e);
    else counted.set(e.type, [e]);
  }

  // Latest contact with each person logged by someone else.
  const lastContact = new Map<string, MissedInput["contacts"][number]>();
  for (const c of input.contacts) {
    if (c.byId && c.byId === c.personId) continue;
    const prev = lastContact.get(c.personId);
    if (!prev || c.date > prev.date) lastContact.set(c.personId, c);
  }
  // Notes per person and event.
  const notesFor = new Map<string, MissedEventNote[]>();
  for (const n of input.notes) {
    const k = `${n.personId}:${n.eventId}`;
    const list = notesFor.get(k);
    if (list) list.push(n);
    else notesFor.set(k, [n]);
  }

  const out: MissedStreak[] = [];
  for (const [type, list] of counted) {
    list.sort(byDate);
    const latest = list[list.length - 1];
    if (differenceInCalendarDays(parseDate(today), parseDate(lastDay(latest))) > windowDays)
      continue;
    // Index of the last counted event each person came to.
    const lastIdx = new Map<string, number>();
    list.forEach((e, i) => {
      for (const a of rowsByEvent.get(e.id) ?? [])
        if (a.attended === true) lastIdx.set(a.personId, i);
    });
    for (const [personId, i] of lastIdx) {
      if (i === list.length - 1) continue;
      const missed = list.slice(i + 1);
      const notes = missed
        .flatMap((e) => notesFor.get(`${personId}:${e.id}`) ?? [])
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const c = lastContact.get(personId);
      const handled: MissedHandled | undefined = notes.length
        ? { kind: "note", note: notes[0] }
        : c && c.date >= missed[0].date
          ? { kind: "contact", date: c.date, byId: c.byId, contactId: c.id }
          : undefined;
      out.push({
        key: `${personId}:${type}`,
        personId,
        type,
        lastAttended: list[i],
        missed,
        latest,
        handled,
        notes,
      });
    }
  }
  return out.sort((a, b) => byDate(b.latest, a.latest) || a.key.localeCompare(b.key));
}

/**
 * The open follow-ups the viewer should see: unhandled streaks of the people
 * passed in `people` (the viewer's registered team), never the viewer's own.
 */
export function openMissedFollowUps(
  streaks: MissedStreak[],
  viewerId: string,
  people: ReadonlySet<string>,
): MissedStreak[] {
  return streaks.filter((s) => !s.handled && s.personId !== viewerId && people.has(s.personId));
}
