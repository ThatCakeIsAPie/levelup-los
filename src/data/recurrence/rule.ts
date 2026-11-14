/**
 * The date arithmetic of a repeating event: pure, no stores, no clock. The same rules are written in
 * SQL (`public.series_nth_date()` in the migration `20261020000100_recurring_events`) and both are
 * tested against the one table of cases in `cases.ts`.
 *
 * A rule is a frequency and a first date (the "anchor"). The nth occurrence is worked out from the
 * anchor and n alone, never from the previous occurrence, so a short month never drags later months
 * along with it (day 31 is the 28th in February and the 31st again in March).
 *
 * Dates are "YYYY-MM-DD" strings. Everything here counts whole days from the UTC calendar, so it can
 * not move with the viewer's time zone or a daylight-saving change.
 */

export const REPEAT_FREQS = [
  "daily",
  "weekly",
  "biweekly",
  "monthly_date",
  "monthly_weekday",
] as const;
export type RepeatFreq = (typeof REPEAT_FREQS)[number];

/** A repeating event is kept filled this many days ahead of today ... */
export const HORIZON_DAYS = 56;
/** ... and never with fewer than this many upcoming occurrences. */
export const MIN_AHEAD = 2;
/** Safety stop for walking occurrences. */
const MAX_STEPS = 5000;

const DAY_MS = 86_400_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Whole days since 1970-01-01 for a "YYYY-MM-DD" date. */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** The "YYYY-MM-DD" date for a day number. */
export function dateOfDay(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `date` plus `n` days (negative for earlier). */
export const addDaysTo = (date: string, n: number): string => dateOfDay(dayNumber(date) + n);

/** Whole days from `a` to `b`. */
export const daysBetween = (a: string, b: string): number => dayNumber(b) - dayNumber(a);

/** 0 = Sunday ... 6 = Saturday. */
export const weekdayOf = (date: string): number => (((dayNumber(date) + 4) % 7) + 7) % 7;

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Which weekday of the month a date is: 1 = the first ... 5 = the fifth. */
export const weekdayOrdinal = (date: string): number =>
  Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1;

/**
 * The nth occurrence (0 = the anchor itself) of a rule.
 *  - monthly_date: the same day of the month; in a month without it, the last day of the month.
 *  - monthly_weekday: the same weekday in the same place in the month (the second Tuesday); the
 *    fifth in a month that has only four is the last such weekday.
 */
export function nthDate(freq: RepeatFreq, anchor: string, n: number): string {
  switch (freq) {
    case "daily":
      return addDaysTo(anchor, n);
    case "weekly":
      return addDaysTo(anchor, 7 * n);
    case "biweekly":
      return addDaysTo(anchor, 14 * n);
    case "monthly_date":
    case "monthly_weekday": {
      const months = Number(anchor.slice(0, 4)) * 12 + Number(anchor.slice(5, 7)) - 1 + n;
      const y = Math.floor(months / 12);
      const m = (months % 12) + 1;
      const last = daysInMonth(y, m);
      if (freq === "monthly_date") {
        return `${pad(y, 4)}-${pad(m)}-${pad(Math.min(Number(anchor.slice(8, 10)), last))}`;
      }
      const first = `${pad(y, 4)}-${pad(m)}-01`;
      let day =
        1 + ((weekdayOf(anchor) - weekdayOf(first) + 7) % 7) + 7 * (weekdayOrdinal(anchor) - 1);
      if (day > last) day -= 7;
      return `${pad(y, 4)}-${pad(m)}-${pad(day)}`;
    }
  }
}

/** Whether `date` is one of the rule's occurrences. */
export function isSlot(freq: RepeatFreq, anchor: string, date: string): boolean {
  if (date < anchor) return false;
  for (let n = 0; n < MAX_STEPS; n++) {
    const d = nthDate(freq, anchor, n);
    if (d === date) return true;
    if (d > date) return false;
  }
  return false;
}

/** The shortest gap, in days, between two occurrences of a rule. */
export const periodDays = (freq: RepeatFreq): number =>
  freq === "daily" ? 1 : freq === "weekly" ? 7 : freq === "biweekly" ? 14 : 28;

/** How many days an event covers, counting both ends (a one-day event covers 1). */
export const spanDays = (date: string, endDate?: string): number =>
  endDate && endDate > date ? daysBetween(date, endDate) + 1 : 1;

/**
 * Whether an event of this length may repeat this way. A one-day event may repeat at any rate; a
 * multi-day one only with a period longer than its own length, so two occurrences never overlap.
 */
export function repeatFits(freq: RepeatFreq, date: string, endDate?: string): boolean {
  const span = spanDays(date, endDate);
  return span === 1 || periodDays(freq) > span;
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The short label of a repeat choice; the two monthly ones name the date or weekday of `date`. */
export function repeatLabel(freq: RepeatFreq, date: string): string {
  switch (freq) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Every 2 weeks";
    case "monthly_date":
      return `Monthly on day ${Number(date.slice(8, 10))}`;
    case "monthly_weekday":
      return `Monthly on the ${ORDINALS[weekdayOrdinal(date) - 1]} ${WEEKDAYS[weekdayOf(date)]}`;
  }
}

export interface SlotRule {
  freq: RepeatFreq;
  /** The first occurrence's date: where the rule starts counting. */
  startsOn: string;
  /** The last date an occurrence may fall on; none means it never ends. */
  endsOn?: string;
  /** Dates whose occurrence was deleted by itself: they never come back. */
  skipped: readonly string[];
}

/**
 * The dates a series must have occurrences on, for a given today: every date from today on that is
 * within `HORIZON_DAYS`, and at least the next `MIN_AHEAD`; never a date in the past, never a skipped
 * one, never after the end. (The first date itself, when it is in the past, is made when the series is
 * made and is not asked for here.) Idempotent: it depends on the rule and today, nothing else.
 */
export function slotsToFill(rule: SlotRule, today: string): string[] {
  const horizon = addDaysTo(today, HORIZON_DAYS);
  const out: string[] = [];
  for (let n = 0; n < MAX_STEPS; n++) {
    const slot = nthDate(rule.freq, rule.startsOn, n);
    if (rule.endsOn && slot > rule.endsOn) break;
    if (slot < today) continue;
    if (slot > horizon && out.length >= MIN_AHEAD) break;
    if (rule.skipped.includes(slot)) continue;
    out.push(slot);
  }
  return out;
}
