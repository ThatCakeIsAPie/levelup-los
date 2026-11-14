import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RULE_CASES } from "./cases";
import {
  HORIZON_DAYS,
  addDaysTo,
  isSlot,
  nthDate,
  periodDays,
  repeatFits,
  repeatLabel,
  slotsToFill,
  spanDays,
  weekdayOf,
  weekdayOrdinal,
  type SlotRule,
} from "./rule";

describe("nthDate: the shared table of cases", () => {
  it.each(RULE_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(nthDate(c.freq, c.anchor, c.n)).toBe(c.expected);
  });

  it("gives the same dates in any time zone (no daylight-saving drift)", () => {
    const before = process.env.TZ;
    try {
      for (const tz of ["America/Chicago", "Pacific/Auckland", "Europe/London", "UTC"]) {
        process.env.TZ = tz;
        for (const c of RULE_CASES) expect(nthDate(c.freq, c.anchor, c.n)).toBe(c.expected);
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it("is the very table the database tests run (supabase/tests/030_event_series.test.sql)", () => {
    const sql = readFileSync(
      resolve(__dirname, "../../../supabase/tests/030_event_series.test.sql"),
      "utf8",
    );
    const rows = [
      ...sql.matchAll(
        /^\s*\('([^']+)', '(\w+)', '(\d{4}-\d{2}-\d{2})', (\d+), '(\d{4}-\d{2}-\d{2})'\),?\s*$/gm,
      ),
    ].map(([, name, freq, anchor, n, expected]) => ({
      name,
      freq,
      anchor,
      n: Number(n),
      expected,
    }));
    expect(rows).toEqual(RULE_CASES.map((c) => ({ ...c })));
  });
});

describe("nthDate: more", () => {
  it("never decreases and never repeats a date", () => {
    for (const freq of [
      "daily",
      "weekly",
      "biweekly",
      "monthly_date",
      "monthly_weekday",
    ] as const) {
      for (const anchor of ["2026-01-31", "2028-02-29", "2026-11-03", "2026-12-31", "2026-03-08"]) {
        let prev = "";
        for (let n = 0; n < 60; n++) {
          const d = nthDate(freq, anchor, n);
          expect(d > prev).toBe(true);
          prev = d;
        }
      }
    }
  });

  it("keeps the weekday of a weekday rule and the day of a date rule when the month has it", () => {
    for (let n = 0; n < 40; n++) {
      const d = nthDate("monthly_weekday", "2026-11-10", n);
      expect(weekdayOf(d)).toBe(2); // Tuesday
      expect(weekdayOrdinal(d)).toBe(2);
      const e = nthDate("monthly_date", "2026-11-14", n);
      expect(e.slice(8)).toBe("14");
    }
  });

  it("the fifth weekday is the last one in months that have only four", () => {
    // Fifth Friday of January 2026 is the 30th; February 2026 has four Fridays, the last is the 27th.
    expect(nthDate("monthly_weekday", "2026-01-30", 1)).toBe("2026-02-27");
    expect(weekdayOf("2026-02-27")).toBe(5);
    expect(addDaysTo("2026-02-27", 7)).toBe("2026-03-06");
  });

  it("isSlot says which dates belong to a rule", () => {
    expect(isSlot("weekly", "2026-11-17", "2026-12-01")).toBe(true);
    expect(isSlot("weekly", "2026-11-17", "2026-12-02")).toBe(false);
    expect(isSlot("weekly", "2026-11-17", "2026-11-10")).toBe(false); // before the first date
    expect(isSlot("monthly_date", "2026-01-31", "2026-02-28")).toBe(true);
    expect(isSlot("monthly_date", "2026-01-31", "2026-02-27")).toBe(false);
  });
});

describe("labels and lengths", () => {
  it("names the monthly choices after the chosen date", () => {
    expect(repeatLabel("daily", "2026-11-14")).toBe("Daily");
    expect(repeatLabel("weekly", "2026-11-14")).toBe("Weekly");
    expect(repeatLabel("biweekly", "2026-11-14")).toBe("Every 2 weeks");
    expect(repeatLabel("monthly_date", "2026-11-14")).toBe("Monthly on day 14");
    expect(repeatLabel("monthly_weekday", "2026-11-10")).toBe("Monthly on the second Tuesday");
    expect(repeatLabel("monthly_weekday", "2026-11-03")).toBe("Monthly on the first Tuesday");
    expect(repeatLabel("monthly_weekday", "2026-01-30")).toBe("Monthly on the fifth Friday");
  });

  it("a multi-day event may repeat only less often than it is long", () => {
    expect(periodDays("daily")).toBe(1);
    expect(spanDays("2026-11-10")).toBe(1);
    expect(spanDays("2026-11-10", "2026-11-12")).toBe(3);
    // One-day events repeat at any rate.
    expect(repeatFits("daily", "2026-11-10")).toBe(true);
    expect(repeatFits("daily", "2026-11-10", "2026-11-10")).toBe(true);
    // Three days: weekly and slower, not daily.
    expect(repeatFits("daily", "2026-11-10", "2026-11-12")).toBe(false);
    expect(repeatFits("weekly", "2026-11-10", "2026-11-12")).toBe(true);
    // Seven days long is not shorter than a week.
    expect(repeatFits("weekly", "2026-11-10", "2026-11-16")).toBe(false);
    expect(repeatFits("biweekly", "2026-11-10", "2026-11-16")).toBe(true);
    expect(repeatFits("monthly_date", "2026-11-10", "2026-12-07")).toBe(false); // 28 days
    expect(repeatFits("monthly_date", "2026-11-10", "2026-12-06")).toBe(true); // 27 days
  });
});

describe("slotsToFill", () => {
  const weekly = (over: Partial<SlotRule> = {}): SlotRule => ({
    freq: "weekly",
    startsOn: "2026-11-17",
    skipped: [],
    ...over,
  });
  const today = "2026-11-14";

  it("covers 8 weeks ahead, one per week, from the first date", () => {
    const s = slotsToFill(weekly(), today);
    expect(s[0]).toBe("2026-11-17");
    expect(s.length).toBe(8);
    expect(s[s.length - 1] <= addDaysTo(today, HORIZON_DAYS)).toBe(true);
    expect(addDaysTo(s[s.length - 1], 7) > addDaysTo(today, HORIZON_DAYS)).toBe(true);
  });

  it("makes nothing in the past, including the first date when it is past", () => {
    const s = slotsToFill(weekly({ startsOn: "2026-10-01" }), today);
    expect(s.every((d) => d >= today)).toBe(true);
    expect(s[0]).toBe("2026-11-19");
  });

  it("never fewer than the next 2, even when they are far apart", () => {
    const monthly = slotsToFill(
      { freq: "monthly_date", startsOn: "2026-11-30", skipped: [] },
      "2026-11-14",
    );
    expect(monthly).toEqual(["2026-11-30", "2026-12-30"]);
    const sparse = slotsToFill(
      { freq: "monthly_date", startsOn: "2026-01-10", skipped: [] },
      today,
    );
    expect(sparse.length).toBeGreaterThanOrEqual(2);
  });

  it("stops at the end date, skips deleted dates and is the same every time", () => {
    const rule = weekly({ endsOn: "2026-12-08", skipped: ["2026-11-24"] });
    const s = slotsToFill(rule, today);
    expect(s).toEqual(["2026-11-17", "2026-12-01", "2026-12-08"]);
    expect(slotsToFill(rule, today)).toEqual(s);
  });

  it("starts counting again as time passes", () => {
    const now = slotsToFill(weekly(), today);
    const later = slotsToFill(weekly(), addDaysTo(today, 21));
    expect(later.slice(0, 5)).toEqual(now.slice(3));
    expect(later.length).toBe(8);
  });

  it("a daily series is 57 occurrences deep", () => {
    expect(slotsToFill({ freq: "daily", startsOn: today, skipped: [] }, today).length).toBe(57);
  });
});
