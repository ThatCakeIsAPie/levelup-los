/**
 * The one table of date-arithmetic cases for a repeating event's rule. `rule.test.ts` runs it
 * against `nthDate` (TypeScript) and `supabase/tests/030_event_series.test.sql` runs the same rows
 * against `public.series_nth_date()`; `rule.test.ts` also checks that the two tables are identical,
 * so the two implementations can never drift apart.
 *
 * Each row: a name, the rule, the first date, n (0 = the first date itself) and the date of the nth
 * occurrence. Expected values were worked out from a calendar, not from the code.
 */
export interface RuleCase {
  name: string;
  freq: "daily" | "weekly" | "biweekly" | "monthly_date" | "monthly_weekday";
  anchor: string;
  n: number;
  expected: string;
}

export const RULE_CASES: readonly RuleCase[] = [
  {
    name: "weekly across the spring daylight change",
    freq: "weekly",
    anchor: "2026-03-02",
    n: 1,
    expected: "2026-03-09",
  },
  {
    name: "weekly across the spring daylight change",
    freq: "weekly",
    anchor: "2026-03-02",
    n: 2,
    expected: "2026-03-16",
  },
  {
    name: "weekly across the autumn daylight change",
    freq: "weekly",
    anchor: "2026-10-27",
    n: 1,
    expected: "2026-11-03",
  },
  {
    name: "weekly across the autumn daylight change",
    freq: "weekly",
    anchor: "2026-10-27",
    n: 2,
    expected: "2026-11-10",
  },
  {
    name: "every 2 weeks across a year end",
    freq: "biweekly",
    anchor: "2026-12-21",
    n: 1,
    expected: "2027-01-04",
  },
  {
    name: "every 2 weeks across a year end",
    freq: "biweekly",
    anchor: "2026-12-21",
    n: 2,
    expected: "2027-01-18",
  },
  {
    name: "every 2 weeks across a year end",
    freq: "biweekly",
    anchor: "2026-12-28",
    n: 1,
    expected: "2027-01-11",
  },
  {
    name: "daily across a year end",
    freq: "daily",
    anchor: "2026-12-30",
    n: 2,
    expected: "2027-01-01",
  },
  {
    name: "daily across a leap day",
    freq: "daily",
    anchor: "2028-02-28",
    n: 1,
    expected: "2028-02-29",
  },
  {
    name: "daily across a leap day",
    freq: "daily",
    anchor: "2028-02-28",
    n: 2,
    expected: "2028-03-01",
  },
  {
    name: "monthly on day 31 in a short month",
    freq: "monthly_date",
    anchor: "2026-01-31",
    n: 1,
    expected: "2026-02-28",
  },
  {
    name: "monthly on day 31 in a 31-day month",
    freq: "monthly_date",
    anchor: "2026-01-31",
    n: 2,
    expected: "2026-03-31",
  },
  {
    name: "monthly on day 31 in a 30-day month",
    freq: "monthly_date",
    anchor: "2026-01-31",
    n: 3,
    expected: "2026-04-30",
  },
  {
    name: "monthly on day 31 after a short month",
    freq: "monthly_date",
    anchor: "2026-01-31",
    n: 4,
    expected: "2026-05-31",
  },
  {
    name: "monthly on day 31 across a year",
    freq: "monthly_date",
    anchor: "2026-01-31",
    n: 13,
    expected: "2027-02-28",
  },
  {
    name: "monthly on day 31, leap February",
    freq: "monthly_date",
    anchor: "2028-01-31",
    n: 1,
    expected: "2028-02-29",
  },
  {
    name: "monthly on day 30 in February",
    freq: "monthly_date",
    anchor: "2026-01-30",
    n: 1,
    expected: "2026-02-28",
  },
  {
    name: "monthly on day 14",
    freq: "monthly_date",
    anchor: "2026-11-14",
    n: 1,
    expected: "2026-12-14",
  },
  {
    name: "monthly on a leap day, next month",
    freq: "monthly_date",
    anchor: "2028-02-29",
    n: 1,
    expected: "2028-03-29",
  },
  {
    name: "monthly on a leap day, next February",
    freq: "monthly_date",
    anchor: "2028-02-29",
    n: 12,
    expected: "2029-02-28",
  },
  {
    name: "monthly on a leap day, the next leap year",
    freq: "monthly_date",
    anchor: "2028-02-29",
    n: 48,
    expected: "2032-02-29",
  },
  {
    name: "weekly from a leap day",
    freq: "weekly",
    anchor: "2028-02-29",
    n: 1,
    expected: "2028-03-07",
  },
  {
    name: "monthly on the second Tuesday",
    freq: "monthly_weekday",
    anchor: "2026-11-10",
    n: 0,
    expected: "2026-11-10",
  },
  {
    name: "monthly on the second Tuesday",
    freq: "monthly_weekday",
    anchor: "2026-11-10",
    n: 1,
    expected: "2026-12-08",
  },
  {
    name: "monthly on the second Tuesday across a year end",
    freq: "monthly_weekday",
    anchor: "2026-11-10",
    n: 2,
    expected: "2027-01-12",
  },
  {
    name: "monthly on the first Tuesday",
    freq: "monthly_weekday",
    anchor: "2026-11-03",
    n: 1,
    expected: "2026-12-01",
  },
  {
    name: "monthly on the first Tuesday across a year end",
    freq: "monthly_weekday",
    anchor: "2026-11-03",
    n: 2,
    expected: "2027-01-05",
  },
  {
    name: "monthly on the fifth Friday, a month with four",
    freq: "monthly_weekday",
    anchor: "2026-01-30",
    n: 1,
    expected: "2026-02-27",
  },
  {
    name: "monthly on the fifth Friday, another month with four",
    freq: "monthly_weekday",
    anchor: "2026-01-30",
    n: 2,
    expected: "2026-03-27",
  },
  {
    name: "monthly on the fifth Friday, a month with five",
    freq: "monthly_weekday",
    anchor: "2026-01-30",
    n: 4,
    expected: "2026-05-29",
  },
  {
    name: "monthly on the fifth Friday, April",
    freq: "monthly_weekday",
    anchor: "2026-01-30",
    n: 3,
    expected: "2026-04-24",
  },
  {
    name: "monthly on the fifth Tuesday of a leap February",
    freq: "monthly_weekday",
    anchor: "2028-02-29",
    n: 0,
    expected: "2028-02-29",
  },
  {
    name: "monthly on the fifth Tuesday of a leap February",
    freq: "monthly_weekday",
    anchor: "2028-02-29",
    n: 1,
    expected: "2028-03-28",
  },
  {
    name: "monthly on the fifth Tuesday, next February (four)",
    freq: "monthly_weekday",
    anchor: "2028-02-29",
    n: 12,
    expected: "2029-02-27",
  },
  {
    name: "monthly on the fourth Wednesday",
    freq: "monthly_weekday",
    anchor: "2026-11-25",
    n: 1,
    expected: "2026-12-23",
  },
];

/**
 * The one table of start and end time cases (src/data/eventTimes.ts). `eventTimes.test.ts` runs it against
 * `timesOk` and `fitEndTime` (TypeScript) and `supabase/tests/050_event_times.test.sql` runs the same rows
 * against `public.event_times_ok()` (the rule the `events` and `event_series` check constraints use) and
 * the end time a later occurrence can keep; `eventTimes.test.ts` also checks that the two tables are
 * identical.
 *
 * Each row: a name, how many days the event runs past its first day (0 = a one-day event), the start time,
 * the end time (null = none), whether that pair is allowed, and the end time that stays on an occurrence
 * when the pair is applied to it (null = none stays).
 */
export interface TimeCase {
  name: string;
  lengthDays: number;
  start: string | null;
  end: string | null;
  ok: boolean;
  fit: string | null;
}

export const TIME_CASES: readonly TimeCase[] = [
  { name: "all-day", lengthDays: 0, start: null, end: null, ok: true, fit: null },
  { name: "all-day, multi-day", lengthDays: 2, start: null, end: null, ok: true, fit: null },
  { name: "start time only", lengthDays: 0, start: "19:00", end: null, ok: true, fit: null },
  { name: "start and end", lengthDays: 0, start: "19:00", end: "20:30", ok: true, fit: "20:30" },
  {
    name: "end after start by a minute",
    lengthDays: 0,
    start: "19:00",
    end: "19:01",
    ok: true,
    fit: "19:01",
  },
  {
    name: "end equals start, one day",
    lengthDays: 0,
    start: "19:00",
    end: "19:00",
    ok: false,
    fit: null,
  },
  {
    name: "end before start, one day",
    lengthDays: 0,
    start: "19:00",
    end: "18:00",
    ok: false,
    fit: null,
  },
  { name: "end without start", lengthDays: 0, start: null, end: "20:30", ok: false, fit: null },
  { name: "midnight start", lengthDays: 0, start: "00:00", end: "00:30", ok: true, fit: "00:30" },
  { name: "end at 23:59", lengthDays: 0, start: "23:00", end: "23:59", ok: true, fit: "23:59" },
  {
    name: "multi-day, end earlier than start",
    lengthDays: 1,
    start: "19:00",
    end: "11:00",
    ok: true,
    fit: "11:00",
  },
  {
    name: "multi-day, end equals start",
    lengthDays: 2,
    start: "09:00",
    end: "09:00",
    ok: true,
    fit: "09:00",
  },
  { name: "multi-day, start only", lengthDays: 2, start: "09:00", end: null, ok: true, fit: null },
  {
    name: "multi-day, end without start",
    lengthDays: 1,
    start: null,
    end: "11:00",
    ok: false,
    fit: null,
  },
];
