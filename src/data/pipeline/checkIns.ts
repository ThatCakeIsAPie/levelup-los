/**
 * How often Home's Today card asks for a check-in with a PROSPECT (a name on
 * the recruiting board). Pure: no hooks, no stores. Tested in checkIns.test.ts.
 *
 * The interval is in whole calendar months and comes from the prospect's
 * card, not from the "team members" day count (`teamDays`, which registered
 * people keep):
 *   - Do not contact: never reminded.
 *   - in Not interested, or taken off the board (`droppedAt`): the Not
 *     interested interval, whatever their rating;
 *   - anyone else: the interval of their card's rating (Hot, Warm, Cold); a
 *     prospect with no rating uses the Warm one (Referral source cards too).
 *
 * Four numbers make a set (`CheckInMonths`); a person sets all four or none
 * (null: use the nearest upline's, `effectiveSettings` in ./rules).
 */
import { addMonths, differenceInCalendarDays } from "date-fns";
import { localDate, parseDate } from "@/lib/dates";
import { asRating, type ContactRating } from "../rating";
import { DO_NOT_CONTACT, NOT_INTERESTED, type PipelineCard } from "./types";

/** Months between check-ins for each kind of prospect. */
export interface CheckInMonths {
  hot: number;
  warm: number;
  cold: number;
  notInterested: number;
}

/** What nobody up the line has set: Hot 3, Warm 6, Cold 12, Not interested 12. */
export const DEFAULT_CHECK_IN_MONTHS: CheckInMonths = {
  hot: 3,
  warm: 6,
  cold: 12,
  notInterested: 12,
};

export const MIN_CHECK_IN_MONTHS = 1;
export const MAX_CHECK_IN_MONTHS = 36;

/** A whole number of months from 1 to 36. */
export const validCheckInMonths = (n: number): boolean =>
  Number.isInteger(n) && n >= MIN_CHECK_IN_MONTHS && n <= MAX_CHECK_IN_MONTHS;

/** Every one of the four is valid. */
export const validCheckInSet = (m: CheckInMonths): boolean =>
  [m.hot, m.warm, m.cold, m.notInterested].every(validCheckInMonths);

/** Which of the four intervals a prospect uses ("unrated" uses Warm's). */
export type CheckInBasis = ContactRating | "unrated" | "not_interested";

export const CHECK_IN_BASIS_LABEL: Record<CheckInBasis, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
  unrated: "Not rated",
  not_interested: "Not interested",
};

/** "3 months", "a year", "1 month" (12 reads as a year). */
export function monthsText(n: number): string {
  if (n === 12) return "a year";
  return n === 1 ? "1 month" : `${n} months`;
}

/** "every 3 months", "every year", "every month". */
export function everyMonths(n: number): string {
  if (n === 12) return "every year";
  return n === 1 ? "every month" : `every ${n} months`;
}

/** The recruiting board's Not interested hint: "Revisit in a year", "Revisit in 9 months". */
export const revisitHint = (months: number): string => `Revisit in ${monthsText(months)}`;

/** The card fields the rule reads. */
export type CheckInCard = Pick<PipelineCard, "column" | "droppedAt" | "rating">;

export interface ProspectCheckIn {
  /** Why this interval; null for Do not contact (never reminded). */
  basis: CheckInBasis | null;
  /** The interval in months; null for Do not contact. */
  months: number | null;
  /** The day it falls due ("YYYY-MM-DD"): last contact (or the day added) plus the interval; null when neither day is known. */
  dueOn: string | null;
  /** Today is on or after `dueOn`; true when no day is known (as before), never for Do not contact. */
  due: boolean;
  /** Days since the last contact (or since they were added); null when neither is known. */
  days: number | null;
  /** No contact has been logged: `days` counts from the day they were added. */
  never: boolean;
  /** The interval's length in days from that day (the divisor of the row's score); 0 when there is no interval. */
  intervalDays: number;
}

/** Which interval a prospect's card selects. Null: Do not contact. */
export function checkInBasis(card: CheckInCard | null | undefined): CheckInBasis | null {
  if (card && !card.droppedAt && card.column === DO_NOT_CONTACT) return null;
  if (card && (card.droppedAt || card.column === NOT_INTERESTED)) return "not_interested";
  return asRating(card?.rating) ?? "unrated";
}

/** The months a basis maps to in a set. */
export function monthsFor(basis: CheckInBasis, set: CheckInMonths): number {
  switch (basis) {
    case "hot":
      return set.hot;
    case "cold":
      return set.cold;
    case "not_interested":
      return set.notInterested;
    default:
      return set.warm;
  }
}

/**
 * A prospect's check-in interval and whether it is due. `lastContact` is the
 * day of their latest logged contact; `person.joinedDate` is the day they
 * were added (used when never contacted); `today` is the team's day
 * ("YYYY-MM-DD"). Due when today is on or after that day plus the interval
 * (`addMonths`: Jan 31 + 1 month is the last day of February).
 */
export function prospectCheckIn(
  person: { joinedDate?: string },
  lastContact: string | undefined,
  card: CheckInCard | null | undefined,
  set: CheckInMonths,
  today: string,
): ProspectCheckIn {
  const basis = checkInBasis(card);
  const never = !lastContact;
  const since = lastContact || person.joinedDate || null;
  const days = since ? differenceInCalendarDays(parseDate(today), parseDate(since)) : null;
  if (basis === null) {
    return { basis, months: null, dueOn: null, due: false, days, never, intervalDays: 0 };
  }
  const months = monthsFor(basis, set);
  if (!since) {
    // Nothing to count from: listed (as before), the interval counted from today.
    const length = differenceInCalendarDays(addMonths(parseDate(today), months), parseDate(today));
    return { basis, months, dueOn: null, due: true, days, never, intervalDays: length };
  }
  const dueOn = localDate(addMonths(parseDate(since), months));
  return {
    basis,
    months,
    dueOn,
    due: today >= dueOn,
    days,
    never,
    intervalDays: differenceInCalendarDays(parseDate(dueOn), parseDate(since)),
  };
}
