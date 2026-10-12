/**
 * Date-only helpers. The app stores calendar dates as "YYYY-MM-DD" strings.
 *
 * Avoid `new Date("YYYY-MM-DD")` (parsed as UTC midnight, so it shows as the
 * previous day west of UTC) and `toISOString().slice(0, 10)` (the UTC date, so
 * "today" flips to tomorrow in the evening in the Americas).
 */
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

/** "YYYY-MM-DD" for a date in the user's local time zone. */
export const localDate = (d: Date = new Date()): string => format(d, "yyyy-MM-dd");

/** "YYYY-MM-DD" for today plus `n` days (negative for the past). */
export const daysFromToday = (n: number): string => localDate(addDays(new Date(), n));

/** Parse "YYYY-MM-DD" (or a full ISO timestamp) as local time. */
export const parseDate = (s: string): Date => parseISO(s);

/** Whole calendar days from `date` to today; null when there is no date. */
export function daysSince(date?: string): number | null {
  if (!date) return null;
  return differenceInCalendarDays(new Date(), parseISO(date));
}
