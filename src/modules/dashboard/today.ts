/**
 * The Dashboard "Today" list: one prioritised list of things that need the
 * user today, merged from several sources. Pure (no hooks, no stores) so it
 * can be unit-tested; the card component feeds it hook results.
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
 *   4. Contact overdue (team, prospects, customers)           100 × days / threshold
 *      Apprentices 90 days out                                 150
 *      Referral sources with no names after a week (own cards)  90 + days over 7 (max 99)
 *      ("Ask Sarah for names", src/data/referrals)
 *   5. Invite your customers to an upcoming event whose        200 - days until
 *      category welcomes them (the soonest two events)
 * Ties fall back to the person's name.
 *
 * Groups (`TodayFilter`, the card's chips) go by who the item is about, by
 * their effective stage, not by where the item came from:
 *   - team:      registered people (apprentices and IBOs, you included):
 *                check-ins, IBO anniversaries. A prospect is never here.
 *   - customers: your customers: contact reminders, booked steps on names that
 *                already buy (a reorder, On Ditto).
 *   - pipeline:  people still in progress, in two sub-sections (`TodaySub`):
 *                recruiting (prospects: check-ins, booked steps) and customer
 *                (names on your customer pipeline: booked steps).
 *   - events:    tickets, RSVP follow-ups (customers on the list too), missed
 *                events (team members and customers), and inviting your
 *                customers.
 */
import { addYears, differenceInCalendarDays } from "date-fns";
import {
  apprenticeAlertLevel,
  effectiveBizClass,
  localDate,
  parseDate,
  categoryLookup,
  startingCategories,
  welcomesCustomers,
  type ApprenticeAlert,
  type Attendance,
  type CrmEvent,
  type CrmPerson,
  type DueBooking,
  type EventCategory,
  type MissedStreak,
  type ReferralReminder,
  type Role,
  type Sale,
} from "@/data";

/** Today's groups, in the order they're shown. */
export const TODAY_FILTERS = ["team", "customers", "pipeline", "events"] as const;
export type TodayFilter = (typeof TODAY_FILTERS)[number];
/** Pipeline's two sub-sections. */
export type TodaySub = "recruiting" | "customer";

interface Base {
  key: string;
  filter: TodayFilter;
  /** Pipeline items only: which pipeline. */
  sub?: TodaySub;
  score: number;
  person: CrmPerson;
  /** The item is about the viewer themself (own ticket, own anniversary). */
  self: boolean;
}

interface ContactDue {
  /** Days since last contact (or since joining when never contacted); null if unknown. */
  days: number | null;
  never: boolean;
  threshold: number;
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
  | (Base & ContactDue & { kind: "customer"; lastSale?: Sale })
  /** A registered team member past the team contact threshold. */
  | (Base & ContactDue & { kind: "team" })
  /** A prospect (recruiting pipeline) past the team contact threshold. */
  | (Base & ContactDue & { kind: "prospect" })
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
      /** "Ask Sarah for names": a referral source of the viewer's with nobody referred yet. */
      kind: "referral";
      reminder: ReferralReminder;
    })
  | (Base & {
      kind: "anniversary";
      level: Exclude<ApprenticeAlert, null>;
      /** The day they become an IBO ("YYYY-MM-DD"). */
      date: string;
      daysLeft: number;
      /** IBO# / LTD# on file. */
      numbersOnFile: boolean;
    })
  | (Base & {
      /** Invite your customers to an upcoming event they're welcome at. */
      kind: "invite";
      event: CrmEvent;
      /** Your customers not on the event's list yet ("Do not contact" left out). */
      customers: CrmPerson[];
      daysUntil: number;
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
   * members and customers of yours or your team's, never the viewer;
   * customers in "Do not contact" are already left out).
   */
  missed?: MissedStreak[];
  /**
   * The team's event categories (archived ones too), for "Invite your
   * customers" (`welcomesCustomers`). Defaults to the six starting ones.
   */
  categories?: readonly EventCategory[];
  /**
   * Booked next steps due today or overdue on the viewer's own cards, both
   * boards (`useDueBookings()`, "Do not contact" already left out).
   */
  bookings?: DueBooking[];
  /**
   * The viewer's referral sources (both boards) who've passed on no names
   * after a week (`useReferralReminders()`, "Do not contact" already left out).
   */
  referrals?: ReferralReminder[];
  /** Events whose "invite your customers" suggestion was put off ("Not now"). */
  dismissedInvites?: ReadonlySet<string>;
  /** "Now"; defaults to the current time. */
  now?: Date;
}

/** Follow-ups due within this many days (today and tomorrow) show up. */
const FOLLOW_UP_WINDOW = 1;
/** Customer invites cover events in the next this many days… */
export const INVITE_WINDOW_DAYS = 14;
/** …and at most this many of them (the soonest). */
export const MAX_INVITES = 2;

const diff = (a: string, b: string) => differenceInCalendarDays(parseDate(a), parseDate(b));

/** Registered: an apprentice or IBO (an apprentice past their year counts as an IBO). */
function registered(p: CrmPerson, now: Date): boolean {
  const stage = effectiveBizClass(p, now);
  return stage === "apprentice" || stage === "ibo";
}

/** Build and rank the Today list. */
export function buildTodayItems(input: TodayInput): TodayItem[] {
  const now = input.now ?? new Date();
  const today = localDate(now);
  const skip = input.doNotContact;
  const byId = new Map(input.people.filter((p) => !skip?.has(p.id)).map((p) => [p.id, p] as const));
  const everyone = new Map(input.people.map((p) => [p.id, p] as const));
  const items: TodayItem[] = [];

  // 1 + 2. Event tickets and follow-ups on events that haven't finished
  // (anyone on the list: team, prospects and customers alike).
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

  if (input.role === "candidate") return rank(items);

  // Missed an event they came to last time (team members, never the viewer).
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

  // Booked pipeline steps that are due (the viewer's own cards).
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
    const base = {
      key: `step:${b.board}:${b.cardId}`,
      kind: "step" as const,
      person,
      self: false,
      booking: b,
      score: 750 + Math.min(49, b.daysLate),
    };
    // A name that already buys is your customer (a reorder, On Ditto).
    if (b.board === "customer" && b.customerId) items.push({ ...base, filter: "customers" });
    else
      items.push({
        ...base,
        filter: "pipeline",
        sub: b.board === "customer" ? "customer" : "recruiting",
      });
  }

  // Referral sources with no names yet: a gentle "Ask … for names" under Pipeline.
  for (const r of input.referrals ?? []) {
    const person: CrmPerson =
      (r.board === "recruiting" ? everyone.get(r.cardId) : undefined) ??
      ({ id: r.cardId, name: r.name, bizClass: "prospect" } as CrmPerson);
    if (skip?.has(person.id)) continue;
    items.push({
      key: `referral:${r.board}:${r.cardId}`,
      kind: "referral",
      filter: "pipeline",
      sub: r.board === "customer" ? "customer" : "recruiting",
      person,
      self: false,
      reminder: r,
      // Gentle: under every overdue contact (100+), a little higher the longer it waits.
      score: 90 + Math.min(9, r.days - 7),
    });
  }

  for (const p of input.people) {
    if (skip?.has(p.id)) continue;
    // 3. Customers past the contact threshold (own customers only are visible).
    if (effectiveBizClass(p, now) === "customer") {
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

    // 5. Past the team contact threshold (never the viewer): registered
    // people under Team, prospects under Pipeline › Recruiting.
    if (p.id === input.viewerId) continue;
    const { days, never } = daysSinceContact(p, input.lastContact, today);
    const t = input.settings.teamDays;
    if (days !== null && days <= t) continue;
    const contact = { person: p, self: false, days, never, threshold: t };
    const score = contactScore(days, t);
    if (registered(p, now)) {
      items.push({ ...contact, key: `team:${p.id}`, kind: "team", filter: "team", score });
    } else {
      items.push({
        ...contact,
        key: `prospect:${p.id}`,
        kind: "prospect",
        filter: "pipeline",
        sub: "recruiting",
        score,
      });
    }
  }

  // 6. Invite your customers to the next events they're welcome at.
  items.push(...inviteItems(input, now, today));

  return rank(items);
}

function rank(items: TodayItem[]): TodayItem[] {
  return items.sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name));
}

/**
 * "Invite your customers": one item per upcoming event your customers are
 * welcome at (its category's `welcomesCustomers`: at first info sessions,
 * trainings and the monthly meeting) in the next
 * `INVITE_WINDOW_DAYS`, while some of your customers aren't on its list; the
 * soonest `MAX_INVITES` events, not ones put off with "Not now".
 */
function inviteItems(input: TodayInput, now: Date, today: string): TodayItem[] {
  const mine = input.people.filter(
    (p) =>
      p.ownerId === input.viewerId &&
      effectiveBizClass(p, now) === "customer" &&
      !input.doNotContact?.has(p.id),
  );
  if (!mine.length) return [];
  const me =
    input.people.find((p) => p.id === input.viewerId) ??
    ({ id: input.viewerId, name: "You", bizClass: "apprentice" } as CrmPerson);
  const categoryOf = categoryLookup(input.categories ?? startingCategories());
  const soon = input.events
    .filter((e) => {
      const until = diff(e.date, today);
      return (
        welcomesCustomers(categoryOf(e)) &&
        until >= 0 &&
        until <= INVITE_WINDOW_DAYS &&
        !input.dismissedInvites?.has(e.id)
      );
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const out: TodayItem[] = [];
  for (const event of soon) {
    if (out.length >= MAX_INVITES) break;
    const listed = new Set(
      input.attendances.filter((a) => a.eventId === event.id).map((a) => a.personId),
    );
    const customers = mine
      .filter((c) => !listed.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!customers.length) continue;
    const daysUntil = diff(event.date, today);
    out.push({
      key: `invite:${event.id}`,
      kind: "invite",
      filter: "events",
      person: me,
      self: true,
      event,
      customers,
      daysUntil,
      score: 200 - daysUntil,
    });
  }
  return out;
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

export interface TodayGroup {
  filter: TodayFilter;
  items: TodayItem[];
  /** Pipeline only: Recruiting, then Customer (empty ones left out). */
  subs?: { sub: TodaySub; items: TodayItem[] }[];
}

/**
 * The list split into its groups (Team, Customers, Pipeline, Events; empty
 * ones left out), each keeping the list's order (most urgent first).
 * Pipeline also has them split into Recruiting and Customer (same order).
 */
export function groupToday(items: TodayItem[]): TodayGroup[] {
  const out: TodayGroup[] = [];
  for (const filter of TODAY_FILTERS) {
    const mine = items.filter((i) => i.filter === filter);
    if (!mine.length) continue;
    if (filter !== "pipeline") {
      out.push({ filter, items: mine });
      continue;
    }
    const subs = (["recruiting", "customer"] as const)
      .map((sub) => ({ sub, items: mine.filter((i) => (i.sub ?? "recruiting") === sub) }))
      .filter((g) => g.items.length > 0);
    out.push({ filter, items: mine, subs });
  }
  return out;
}
