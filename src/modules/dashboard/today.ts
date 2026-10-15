/**
 * The Dashboard "Today" list: one prioritised list of things that need the
 * user today, merged from four sources. Pure (no hooks, no stores) so it can
 * be unit-tested; the card component feeds it hook results.
 *
 * Ranking (higher score first):
 *   1. Event tickets whose planned purchase date has passed   1000 + days late
 *   2. Event follow-ups that are overdue, due today/tomorrow   800–900+
 *      Booked pipeline steps due today or overdue (own cards)  750 + days late
 *      (both boards; src/data/pipeline/booking.ts dueBookings, "Do not
 *      contact" left out; Done moves the card, Reschedule, Cancel)
 *   3. Apprentices at their IBO anniversary (due / 30 days)    700 / 500
 *      Missed an event they came to last time (uplines)       650 - days since
 *      (src/data/eventTypes/missed.ts; cleared for every upline by a
 *      check-in or an "already handled" note)
 *   4. Contact overdue (team and customers)                    100 × days / threshold
 *      Apprentices 90 days out                                 150
 * Ties fall back to the person's name.
 */
import { addYears, differenceInCalendarDays } from "date-fns";
import {
  apprenticeAlertLevel,
  localDate,
  parseDate,
  type ApprenticeAlert,
  type Attendance,
  type CrmEvent,
  type CrmPerson,
  type DueBooking,
  type MissedStreak,
  type Role,
  type Sale,
} from "@/data";

export type TodayFilter = "team" | "customers" | "events" | "pipeline";

interface Base {
  key: string;
  filter: TodayFilter;
  score: number;
  person: CrmPerson;
  /** The item is about the viewer themself (own ticket, own anniversary). */
  self: boolean;
}

export type TodayItem =
  | (Base & {
      kind: "ticket";
      attendance: Attendance;
      event: CrmEvent;
      /** Planned purchase date that has passed. */
      dueDate: string;
      daysLate: number;
    })
  | (Base & {
      kind: "followup";
      attendance: Attendance;
      event: CrmEvent;
      dueDate: string;
      /** Days until the follow-up (0 = today, negative = overdue). */
      daysUntil: number;
    })
  | (Base & {
      kind: "customer";
      /** Days since last contact (or since joining when never contacted); null if unknown. */
      days: number | null;
      never: boolean;
      threshold: number;
      lastSale?: Sale;
    })
  | (Base & {
      kind: "team";
      days: number | null;
      never: boolean;
      threshold: number;
    })
  | (Base & {
      kind: "missed";
      /** Came to `streak.lastAttended`, missed `streak.latest` (and maybe more). */
      streak: MissedStreak;
      /** Days since the latest missed event. */
      daysAgo: number;
    })
  | (Base & {
      kind: "step";
      /** A booked next step due today or overdue on one of the viewer's cards. */
      booking: DueBooking;
    })
  | (Base & {
      kind: "anniversary";
      level: Exclude<ApprenticeAlert, null>;
      /** The day they become an IBO ("YYYY-MM-DD"). */
      date: string;
      daysLeft: number;
      /** IBO# / LTD# on file. */
      numbersOnFile: boolean;
    });

export type TodayKind = TodayItem["kind"];

export interface TodayInput {
  viewerId: string;
  role: Role;
  /** Every person the viewer may see (team, self and own customers). */
  people: CrmPerson[];
  /** personId -> last contact date. */
  lastContact: Map<string, string>;
  settings: { teamDays: number; customerDays: number };
  /** Events (any order); only unfinished ones are used. */
  events: CrmEvent[];
  /** Visible attendance rows (any event). */
  attendances: Attendance[];
  /** Visible sales, for "last bought" on customer rows. */
  sales: Sale[];
  /** People hidden from reminders ("Do not contact" on the customer board). */
  doNotContact?: ReadonlySet<string>;
  /**
   * Open missed-event follow-ups (`useMissedFollowUps()`: registered team
   * members only, never the viewer). "Do not contact" doesn't apply to them.
   */
  missed?: MissedStreak[];
  /**
   * Booked next steps due today or overdue on the viewer's own cards, both
   * boards (`useDueBookings()`, "Do not contact" already left out).
   */
  bookings?: DueBooking[];
  /** "Now"; defaults to the current time. */
  now?: Date;
}

/** Follow-ups due within this many days (today and tomorrow) show up. */
const FOLLOW_UP_WINDOW = 1;

const diff = (a: string, b: string) => differenceInCalendarDays(parseDate(a), parseDate(b));

/** Build and rank the Today list. */
export function buildTodayItems(input: TodayInput): TodayItem[] {
  const now = input.now ?? new Date();
  const today = localDate(now);
  const skip = input.doNotContact;
  const byId = new Map(input.people.filter((p) => !skip?.has(p.id)).map((p) => [p.id, p] as const));
  const items: TodayItem[] = [];

  // 1 + 2. Event tickets and follow-ups on events that haven't finished.
  const upcoming = new Map(
    input.events.filter((e) => (e.endDate ?? e.date) >= today).map((e) => [e.id, e]),
  );
  for (const a of input.attendances) {
    const event = upcoming.get(a.eventId);
    const person = byId.get(a.personId);
    if (!event || !person || a.hasTicket || a.desireToAttend === "no") continue;
    if (input.role === "candidate" && a.personId !== input.viewerId) continue;
    const self = a.personId === input.viewerId;
    const base = { person, self, event, attendance: a, filter: "events" as const };

    if (a.plannedPurchaseDate && a.plannedPurchaseDate < today) {
      const daysLate = diff(today, a.plannedPurchaseDate);
      items.push({
        ...base,
        key: `ticket:${a.id}`,
        kind: "ticket",
        dueDate: a.plannedPurchaseDate,
        daysLate,
        score: 1000 + daysLate,
      });
      continue;
    }
    // Earliest of the follow-up / planned purchase dates that falls due by tomorrow.
    const due = [a.followUpDate, a.plannedPurchaseDate]
      .filter((d): d is string => !!d)
      .map((d) => d.slice(0, 10))
      .filter((d) => diff(d, today) <= FOLLOW_UP_WINDOW)
      .sort()[0];
    if (due) {
      const daysUntil = diff(due, today);
      items.push({
        ...base,
        key: `followup:${a.id}`,
        kind: "followup",
        dueDate: due,
        daysUntil,
        score: daysUntil > 0 ? 800 : 900 - daysUntil,
      });
    }
  }

  // Missed an event they came to last time (team members, never the viewer).
  if (input.role !== "candidate") {
    const everyone = new Map(input.people.map((p) => [p.id, p] as const));
    for (const streak of input.missed ?? []) {
      const person = everyone.get(streak.personId);
      if (!person || person.id === input.viewerId) continue;
      const daysAgo = Math.max(0, diff(today, streak.latest.endDate ?? streak.latest.date));
      items.push({
        key: `missed:${streak.key}`,
        kind: "missed",
        filter: "events",
        person,
        self: false,
        streak,
        daysAgo,
        score: 650 - daysAgo,
      });
    }
  }

  // Booked pipeline steps that are due (the viewer's own cards).
  if (input.role !== "candidate") {
    const everyone = new Map(input.people.map((p) => [p.id, p] as const));
    for (const b of input.bookings ?? []) {
      // A list name isn't a person: stand in with its name (the row links to the board).
      const person: CrmPerson =
        (b.board === "recruiting" ? everyone.get(b.cardId) : undefined) ??
        ({
          id: b.cardId,
          name: b.name,
          bizClass: b.board === "customer" ? "customer" : "prospect",
        } as CrmPerson);
      if (skip?.has(person.id)) continue;
      items.push({
        key: `step:${b.board}:${b.cardId}`,
        kind: "step",
        filter: "pipeline",
        person,
        self: false,
        booking: b,
        score: 750 + Math.min(49, b.daysLate),
      });
    }
  }

  if (input.role !== "candidate") {
    for (const p of input.people) {
      if (skip?.has(p.id)) continue;
      // 3. Customers past the contact threshold (own customers only are visible).
      if (p.bizClass === "customer") {
        const { days, never } = daysSinceContact(p, input.lastContact, today);
        const t = input.settings.customerDays;
        if (days === null || days > t) {
          const lastSale = input.sales
            .filter((s) => s.customerId === p.id)
            .reduce<Sale | undefined>(
              (best, s) => (!best || s.date > best.date ? s : best),
              undefined,
            );
          items.push({
            key: `customer:${p.id}`,
            kind: "customer",
            filter: "customers",
            person: p,
            self: false,
            days,
            never,
            threshold: t,
            lastSale,
            score: contactScore(days, t),
          });
        }
        continue;
      }

      // 4. Apprentices close to their IBO anniversary (including the viewer).
      const level = apprenticeAlertLevel(p, now);
      if (level && p.businessStartDate) {
        const date = localDate(addYears(parseDate(p.businessStartDate), 1));
        items.push({
          key: `anniversary:${p.id}`,
          kind: "anniversary",
          filter: "team",
          person: p,
          self: p.id === input.viewerId,
          level,
          date,
          daysLeft: Math.max(0, diff(date, today)),
          numbersOnFile: !!p.iboNumber?.trim() && !!p.ltdNumber?.trim(),
          score: level === "due" ? 700 : level === "30d" ? 500 : 150,
        });
      }

      // 5. Team members past the team contact threshold (never the viewer).
      if (p.id === input.viewerId) continue;
      const { days, never } = daysSinceContact(p, input.lastContact, today);
      const t = input.settings.teamDays;
      if (days === null || days > t) {
        items.push({
          key: `team:${p.id}`,
          kind: "team",
          filter: "team",
          person: p,
          self: false,
          days,
          never,
          threshold: t,
          score: contactScore(days, t),
        });
      }
    }
  }

  return items.sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name));
}

/**
 * Days since the last contact. People never contacted count from the day they
 * joined (so someone added yesterday isn't "overdue"); null when neither date
 * is known.
 */
function daysSinceContact(
  p: CrmPerson,
  lastContact: Map<string, string>,
  today: string,
): { days: number | null; never: boolean } {
  const last = lastContact.get(p.id);
  if (last) return { days: diff(today, last), never: false };
  return { days: p.joinedDate ? diff(today, p.joinedDate) : null, never: true };
}

function contactScore(days: number | null, threshold: number): number {
  if (days === null) return 100;
  return Math.round((100 * days) / Math.max(1, threshold));
}

/** Item counts per filter chip. */
export function countByFilter(items: TodayItem[]): Record<"all" | TodayFilter, number> {
  const out = { all: items.length, team: 0, customers: 0, events: 0, pipeline: 0 };
  for (const it of items) out[it.filter]++;
  return out;
}
