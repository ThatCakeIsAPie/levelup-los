/**
 * Missed-event follow-ups (pure; docs/plans/mvp-plan-2026-10-13.md "Events").
 *
 * Someone who came to the last event of a category and didn't come to the
 * next one gets a follow-up in the Today list of everyone above them. One
 * rule for every category whose "Remind uplines when someone misses one?" is
 * on (`countsForMissed`), worked out per category in one pass:
 *
 *  - Only finished events count (the day after their last day), and only once
 *    attendance was taken for them: at least one row of the event has
 *    attendance recorded (attended or no-show). A Night Owls nobody has
 *    logged yet doesn't make everyone a "miss".
 *  - A streak is the run of counted events of one category since the person
 *    last came to one. Missing several in a row is one follow-up, about the
 *    latest. People who never came to that category have no streak. Merging
 *    two categories joins their events into one run.
 *  - A streak is handled once anyone else logs a contact with the person on or
 *    after the first missed event's day (a check-in, a call, a chat check-in),
 *    or an upline leaves an "already handled" note on one of the missed
 *    events. Handled is handled for every upline at once.
 *  - Only recent misses show: the latest missed event ended within the last
 *    `MISSED_WINDOW_DAYS` days. Coming again ends the streak.
 *
 * Who sees a follow-up is the caller's business (the Today list: people the
 * viewer can see who are registered team members, or customers of the viewer
 * or of someone on their team (`missedAudience`), never the viewer themself).
 * Customers on an event's list count like everyone else: they're part of the
 * business. A customer's uplines are their owner and the owner's uplines.
 */
import { differenceInCalendarDays } from "date-fns";
import { parseDate } from "@/lib/dates";
import type { CrmEvent } from "@/stores/eventsStore";
import type { Attendance, MissedEventNote } from "@/stores/attendanceStore";
import type { Contact } from "@/stores/crmStore";
import { effectiveBizClass, type CrmPerson } from "@/stores/peopleStore";
import { countsForMissed } from "../eventCategories/rules";
import type { EventCategory } from "../eventCategories/types";

/** Misses older than this (by the latest missed event's last day) are left alone. */
export const MISSED_WINDOW_DAYS = 30;

export type MissedHandled =
  | { kind: "contact"; date: string; byId?: string; contactId: string }
  | { kind: "note"; note: MissedEventNote };

export interface MissedStreak {
  /** `${personId}:${categoryId}` (one streak per person and category). */
  key: string;
  personId: string;
  categoryId: string;
  /** The last event of this category they came to. */
  lastAttended: CrmEvent;
  /** Counted events of this category since then that they missed, oldest first. */
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
  /**
   * The team's categories (archived ones too): events of a category with
   * `countsForMissed` off are left out. Events of a category not listed count.
   */
  categories?: readonly Pick<EventCategory, "id" | "countsForMissed">[];
}

const lastDay = (e: CrmEvent) => e.endDate ?? e.date;
const byDate = (a: CrmEvent, b: CrmEvent) =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/**
 * Every current missed streak (handled or not) within the window, per person
 * and category. Linear in events + rows + contacts + notes.
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
  const skipped = new Set(
    (input.categories ?? []).filter((c) => !countsForMissed(c)).map((c) => c.id),
  );
  const counted = new Map<string, CrmEvent[]>();
  for (const e of input.events) {
    if (lastDay(e) >= today || skipped.has(e.categoryId)) continue;
    const rows = rowsByEvent.get(e.id);
    if (!rows?.some((a) => a.attended !== undefined)) continue;
    const list = counted.get(e.categoryId);
    if (list) list.push(e);
    else counted.set(e.categoryId, [e]);
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
  for (const [categoryId, list] of counted) {
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
        key: `${personId}:${categoryId}`,
        personId,
        categoryId,
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
 * Whose misses the viewer follows up (the uplines' side of the rule), from
 * the people the viewer can see: registered team members (apprentices and
 * IBOs), and customers owned by the viewer or by someone on their team. A
 * customer's uplines are their owner and the owner's uplines. Customers in
 * "Do not contact" (`skip`) are left out; prospects never count.
 */
export function missedAudience(
  people: readonly CrmPerson[],
  viewerId: string,
  now = new Date(),
  skip?: ReadonlySet<string>,
): Set<string> {
  const team = new Set<string>();
  for (const p of people) {
    const c = effectiveBizClass(p, now);
    if (c === "apprentice" || c === "ibo") team.add(p.id);
  }
  const out = new Set(team);
  for (const p of people) {
    if (effectiveBizClass(p, now) !== "customer" || skip?.has(p.id) || !p.ownerId) continue;
    if (p.ownerId === viewerId || team.has(p.ownerId)) out.add(p.id);
  }
  return out;
}

/**
 * The open follow-ups the viewer should see: unhandled streaks of the people
 * passed in `people` (`missedAudience`), never the viewer's own.
 */
export function openMissedFollowUps(
  streaks: MissedStreak[],
  viewerId: string,
  people: ReadonlySet<string>,
): MissedStreak[] {
  return streaks.filter((s) => !s.handled && s.personId !== viewerId && people.has(s.personId));
}
