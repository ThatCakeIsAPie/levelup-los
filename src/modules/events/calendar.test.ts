import { describe, expect, it } from "vitest";
import type { CrmEvent, EventSeries } from "@/stores/eventsStore";
import { addDaysTo, nthDate, weekdayOf } from "@/data/recurrence/rule";
import {
  bucketByWeek,
  calendarItems,
  dayLabel,
  gridEnd,
  gridWeeks,
  itemsOnDay,
  layoutWeek,
  MAX_SLOTS,
  projectOccurrences,
  weekDays,
  weekStartOf,
  WEEKS_AHEAD,
  WEEKS_BACK,
  type CalItem,
} from "./calendar";

const TODAY = "2026-11-14"; // a Saturday

const ev = (over: Partial<CrmEvent> & { id: string; date: string }): CrmEvent => ({
  name: over.id,
  categoryId: "c1",
  ...over,
});
const item = (over: Partial<CalItem> & { key: string; date: string }): CalItem => ({
  name: over.key,
  categoryId: "c1",
  projected: false,
  eventId: over.key,
  ...over,
});
const series = (over: Partial<EventSeries> & { id: string }): EventSeries => ({
  freq: "weekly",
  startsOn: "2026-11-02",
  skipped: [],
  name: "Weekly meetup",
  categoryId: "c1",
  lengthDays: 0,
  ...over,
});

describe("the week grid's date maths", () => {
  const check = (weeks: string[]) => {
    for (const w of weeks) expect(weekdayOf(w)).toBe(0);
    for (let i = 1; i < weeks.length; i++) expect(weeks[i]).toBe(addDaysTo(weeks[i - 1], 7));
  };

  it("starts on Sunday and opens on the current week", () => {
    expect(weekStartOf("2026-11-14")).toBe("2026-11-08");
    expect(weekStartOf("2026-11-08")).toBe("2026-11-08");
    expect(weekDays("2026-11-08")).toEqual([
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
    ]);
    const weeks = gridWeeks(TODAY);
    expect(weeks).toHaveLength(WEEKS_BACK + WEEKS_AHEAD + 1);
    expect(weeks[WEEKS_BACK]).toBe("2026-11-08");
    expect(WEEKS_BACK).toBeGreaterThanOrEqual(26);
    expect(WEEKS_AHEAD).toBeGreaterThanOrEqual(78);
    expect(gridEnd(weeks)).toBe(addDaysTo(weeks[weeks.length - 1], 6));
    check(weeks);
  });

  it("carries a week across a year end", () => {
    expect(weekDays(weekStartOf("2026-12-31"))).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    check(gridWeeks("2026-12-30"));
    expect(dayLabel("2027-01-01", TODAY)).toEqual({ text: "Jan 1, 2027", kind: "month" });
  });

  it("has a leap day in its week", () => {
    expect(weekDays(weekStartOf("2028-02-29"))).toEqual([
      "2028-02-27",
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
      "2028-03-02",
      "2028-03-03",
      "2028-03-04",
    ]);
    // the grid from a day just before it reaches it exactly once
    const all = gridWeeks("2028-02-20", 2, 2).flatMap(weekDays);
    expect(all.filter((d) => d === "2028-02-29")).toHaveLength(1);
    expect(all.filter((d) => d === "2027-02-29")).toHaveLength(0);
  });

  it("is not moved by either daylight-saving change, in any time zone", () => {
    const saved = process.env.TZ;
    try {
      for (const tz of ["America/Chicago", "Europe/London", "Australia/Lord_Howe", "UTC"]) {
        process.env.TZ = tz;
        // US: Mar 8 and Nov 1 2026; Europe: Mar 29 and Oct 25 2026; Lord Howe: Apr 5 and Oct 4 2026.
        for (const day of [
          "2026-03-08",
          "2026-03-29",
          "2026-04-05",
          "2026-10-04",
          "2026-10-25",
          "2026-11-01",
        ]) {
          const weeks = gridWeeks(day, 3, 3);
          check(weeks);
          const days = weeks.flatMap(weekDays);
          expect(new Set(days).size).toBe(days.length);
          expect(days).toContain(day);
          expect(weekDays(weekStartOf(day))).toContain(day);
        }
      }
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  it("labels today, the first of a month and every other day", () => {
    expect(dayLabel("2026-11-14", TODAY)).toEqual({ text: "Today, Nov 14", kind: "today" });
    expect(dayLabel("2026-12-01", TODAY)).toEqual({ text: "Dec 1, 2026", kind: "month" });
    expect(dayLabel("2026-11-15", TODAY)).toEqual({ text: "15", kind: "day" });
    // today wins over the first of a month
    expect(dayLabel("2026-12-01", "2026-12-01").kind).toBe("today");
  });
});

describe("placing events in a week", () => {
  const week = "2026-11-08"; // Sun Nov 8 .. Sat Nov 14

  it("puts a single event in its day", () => {
    const w = layoutWeek(week, [item({ key: "a", date: "2026-11-10" })]);
    expect(w.segments).toHaveLength(1);
    expect(w.segments[0]).toMatchObject({
      col0: 2,
      col1: 2,
      lane: 0,
      before: false,
      after: false,
      multi: false,
    });
    expect(w.hidden.every((n) => n === 0)).toBe(true);
    expect(w.slots).toBe(2); // the minimum
  });

  it("orders a day's events by start time, all-day first", () => {
    const day = "2026-11-10";
    const w = layoutWeek(
      week,
      [
        item({ key: "late", date: day, startTime: "19:00" }),
        item({ key: "early", date: day, startTime: "08:30" }),
        item({ key: "allday", date: day }),
      ].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "")),
    );
    const lanes = Object.fromEntries(w.segments.map((s) => [s.item.key, s.lane]));
    expect(lanes).toEqual({ allday: 0, early: 1, late: 2 });
    expect(w.perDay[2].map((i) => i.key)).toEqual(["allday", "early", "late"]);
  });

  it("draws a multi-day event across every day it covers, above the day's single events", () => {
    const w = layoutWeek(week, [
      item({ key: "single", date: "2026-11-10", startTime: "09:00" }),
      item({
        key: "bar",
        date: "2026-11-09",
        endDate: "2026-11-11",
        startTime: "18:00",
        endTime: "12:00",
      }),
    ]);
    const bar = w.segments.find((s) => s.item.key === "bar")!;
    const single = w.segments.find((s) => s.item.key === "single")!;
    expect(bar).toMatchObject({
      col0: 1,
      col1: 3,
      lane: 0,
      multi: true,
      before: false,
      after: false,
    });
    expect(single.lane).toBe(1);
    expect(w.perDay[1].map((i) => i.key)).toEqual(["bar"]);
    expect(w.perDay[2].map((i) => i.key).sort()).toEqual(["bar", "single"]);
    expect(w.perDay[3].map((i) => i.key)).toEqual(["bar"]);
  });

  it("continues a Saturday-to-Sunday event on the next row", () => {
    const bar = item({ key: "bar", date: "2026-11-14", endDate: "2026-11-16" });
    const weeks = ["2026-11-08", "2026-11-15"];
    const buckets = bucketByWeek([bar], weeks);
    const first = layoutWeek(weeks[0], buckets.get(weeks[0])!);
    const second = layoutWeek(weeks[1], buckets.get(weeks[1])!);
    expect(first.segments[0]).toMatchObject({ col0: 6, col1: 6, before: false, after: true });
    expect(second.segments[0]).toMatchObject({ col0: 0, col1: 1, before: true, after: false });
    // three days in all: Sat, Sun, Mon
    const covered = [...first.perDay, ...second.perDay].filter((d) => d.length).length;
    expect(covered).toBe(3);
  });

  it("spans whole weeks and keeps the same lane for it", () => {
    const bar = item({ key: "long", date: "2026-11-05", endDate: "2026-11-26" });
    const weeks = gridWeeks("2026-11-14", 1, 3).slice(0, 4);
    const buckets = bucketByWeek([bar], weeks);
    const rows = weeks.map((w) => layoutWeek(w, buckets.get(w)!));
    expect(rows.map((r) => r.segments.length)).toEqual([1, 1, 1, 1]);
    expect(rows[0].segments[0]).toMatchObject({ before: false, after: true, col0: 4, col1: 6 });
    expect(rows[1].segments[0]).toMatchObject({ before: true, after: true, col0: 0, col1: 6 });
    expect(rows[2].segments[0]).toMatchObject({ before: true, after: true, col0: 0, col1: 6 });
    expect(rows[3].segments[0]).toMatchObject({ before: true, after: false, col0: 0, col1: 4 });
    expect(itemsOnDay([bar], "2026-11-20")).toHaveLength(1);
    expect(itemsOnDay([bar], "2026-11-27")).toHaveLength(0);
  });

  it("buckets an item into every week it touches and ignores one outside the grid", () => {
    const weeks = gridWeeks(TODAY, 1, 1);
    const inside = item({ key: "in", date: "2026-11-14", endDate: "2026-11-16" });
    const outside = item({ key: "out", date: "2030-01-01" });
    const old = item({ key: "old", date: "2020-01-01" });
    const b = bucketByWeek([inside, outside, old], weeks);
    expect([...b.values()].map((l) => l.map((i) => i.key))).toEqual([[], ["in"], ["in"]]);
  });

  it("shows every event of a day up to the limit, then '+N more' on the last row", () => {
    const day = "2026-11-11";
    const make = (n: number) =>
      layoutWeek(
        week,
        Array.from({ length: n }, (_, i) =>
          item({ key: `e${i}`, date: day, startTime: `${10 + i}:00` }),
        ),
      );
    for (const n of [1, 2, 3, MAX_SLOTS]) {
      const w = make(n);
      expect(w.segments).toHaveLength(n);
      expect(w.hidden[3]).toBe(0);
    }
    const five = make(5);
    expect(MAX_SLOTS - 1).toBeGreaterThanOrEqual(3); // at least three events show before "+N more"
    expect(five.segments).toHaveLength(MAX_SLOTS - 1);
    expect(five.hidden[3]).toBe(2);
    expect(five.slots).toBe(MAX_SLOTS);
    expect(five.perDay[3]).toHaveLength(5); // the popover has all of them
    const nine = make(9);
    expect(nine.hidden[3]).toBe(9 - (MAX_SLOTS - 1));
    expect(nine.hidden.filter((n) => n > 0)).toHaveLength(1);
  });

  it("never draws half a bar: a bar that does not fit one day is hidden on all its days", () => {
    const bars = Array.from({ length: 5 }, (_, i) =>
      item({ key: `b${i}`, date: "2026-11-09", endDate: "2026-11-11", name: `b${i}` }),
    );
    const w = layoutWeek(week, bars);
    expect(w.segments).toHaveLength(MAX_SLOTS - 1);
    expect([1, 2, 3].map((c) => w.hidden[c])).toEqual([2, 2, 2]);
    expect(w.hidden[0]).toBe(0);
    expect(w.perDay[2]).toHaveLength(5);
  });

  it("tabs through a week in day order, then row", () => {
    const w = layoutWeek(week, [
      item({ key: "thu", date: "2026-11-12", startTime: "09:00" }),
      item({ key: "mon2", date: "2026-11-09", startTime: "12:00" }),
      item({ key: "mon1", date: "2026-11-09", startTime: "08:00" }),
    ]);
    expect(w.segments.map((s) => s.item.key)).toEqual(["mon1", "mon2", "thu"]);
  });
});

describe("occurrences projected from a series", () => {
  const until = addDaysTo(TODAY, 7 * 20);

  it("shows a weekly series on its weekday beyond the stored occurrences", () => {
    const s = series({ id: "s1", freq: "weekly", startsOn: "2026-11-02" }); // Mondays
    const stored = [
      ev({ id: "s1-2026-11-16", date: "2026-11-16", seriesId: "s1", seriesDate: "2026-11-16" }),
    ];
    const out = projectOccurrences([s], stored, TODAY, until);
    expect(out[0].date).toBe("2026-11-23"); // the 16th is stored; nothing before today
    expect(out.every((o) => weekdayOf(o.date) === 1 && o.projected && !o.eventId)).toBe(true);
    expect(out.every((o) => o.date >= TODAY && o.date <= until)).toBe(true);
    expect(out.map((o) => o.date)).not.toContain("2026-11-16");
    // it goes on for as far as the grid does
    expect(out[out.length - 1].date >= addDaysTo(until, -7)).toBe(true);
    expect(new Set(out.map((o) => o.key)).size).toBe(out.length);
  });

  it("never duplicates a stored occurrence, even one that was moved", () => {
    const s = series({ id: "s1", startsOn: "2026-11-02" });
    const stored = [
      ev({ id: "a", date: "2026-11-23", seriesId: "s1", seriesDate: "2026-11-23" }),
      // the 30th's occurrence was moved to the 1st: its slot is taken
      ev({ id: "b", date: "2026-12-01", seriesId: "s1", seriesDate: "2026-11-30" }),
    ];
    const dates = projectOccurrences([s], stored, TODAY, until).map((o) => o.date);
    expect(dates).not.toContain("2026-11-23");
    expect(dates).not.toContain("2026-11-30");
    expect(dates).toContain("2026-12-07");
  });

  it("honours skipped dates and the end date, and shows nothing for an ended series", () => {
    const skipped = series({ id: "s1", skipped: ["2026-11-23", "2026-12-14"] });
    const dates = projectOccurrences([skipped], [], TODAY, until).map((o) => o.date);
    expect(dates).not.toContain("2026-11-23");
    expect(dates).not.toContain("2026-12-14");
    expect(dates).toContain("2026-11-30");

    const ends = series({ id: "s2", endsOn: "2026-12-10" });
    expect(projectOccurrences([ends], [], TODAY, until).map((o) => o.date)).toEqual([
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
      "2026-12-07",
    ]);
    const over = series({ id: "s3", endsOn: "2026-11-13" });
    expect(projectOccurrences([over], [], TODAY, until)).toEqual([]);
  });

  it("repeats every 2 weeks", () => {
    const s = series({ id: "s1", freq: "biweekly", startsOn: "2026-11-02" });
    const dates = projectOccurrences([s], [], TODAY, "2027-01-31").map((o) => o.date);
    expect(dates).toEqual([
      "2026-11-16",
      "2026-11-30",
      "2026-12-14",
      "2026-12-28",
      "2027-01-11",
      "2027-01-25",
    ]);
  });

  it("repeats monthly on a day of the month, with the short-month rule", () => {
    const s = series({ id: "s1", freq: "monthly_date", startsOn: "2026-10-31" });
    const dates = projectOccurrences([s], [], TODAY, "2027-03-31").map((o) => o.date);
    expect(dates).toEqual(["2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]);
    // the same dates as the repeat rule itself gives
    expect(dates[0]).toBe(nthDate("monthly_date", "2026-10-31", 1));
  });

  it("repeats monthly on the nth weekday, skipping one date and stopping at the end", () => {
    // the second Tuesday of the month
    const s = series({
      id: "s1",
      freq: "monthly_weekday",
      startsOn: "2026-10-13",
      skipped: ["2027-01-12"],
      endsOn: "2027-03-31",
    });
    const stored = [ev({ id: "x", date: "2026-11-10", seriesId: "s1", seriesDate: "2026-11-10" })];
    const dates = projectOccurrences([s], stored, "2026-11-01", "2027-06-30").map((o) => o.date);
    expect(dates).toEqual(["2026-12-08", "2027-02-09", "2027-03-09"]);
  });

  it("takes name, category, times and length from the series", () => {
    const s = series({
      id: "s1",
      name: "Retreat",
      categoryId: "c9",
      startTime: "18:00",
      endTime: "12:00",
      lengthDays: 2,
      freq: "monthly_date",
      startsOn: "2026-11-20",
    });
    const [p] = projectOccurrences([s], [], TODAY, until);
    expect(p).toMatchObject({
      name: "Retreat",
      categoryId: "c9",
      date: "2026-11-20",
      endDate: "2026-11-22",
      startTime: "18:00",
      endTime: "12:00",
      seriesId: "s1",
      projected: true,
    });
  });

  it("is part of the calendar's items, filtered by category like the stored ones", () => {
    const s1 = series({ id: "s1", categoryId: "c1" });
    const s2 = series({ id: "s2", categoryId: "c2", name: "Other" });
    const events = [
      ev({ id: "one", date: "2026-11-20", categoryId: "c1" }),
      ev({ id: "two", date: "2026-11-20", categoryId: "c2" }),
    ];
    const all = calendarItems(events, [s1, s2], TODAY, until);
    expect(all.some((i) => i.projected && i.categoryId === "c1")).toBe(true);
    expect(all.some((i) => i.projected && i.categoryId === "c2")).toBe(true);
    const only = calendarItems(events, [s1, s2], TODAY, until, "c2");
    expect(only.every((i) => i.categoryId === "c2")).toBe(true);
    expect(only.filter((i) => !i.projected).map((i) => i.key)).toEqual(["two"]);
    expect(only.some((i) => i.projected)).toBe(true);
  });

  it("sorts by day, then start time with all-day first", () => {
    const s = series({ id: "s1", startsOn: "2026-11-16", startTime: "08:00" });
    const events = [
      ev({ id: "later", date: "2026-11-16", startTime: "20:00" }),
      ev({ id: "allday", date: "2026-11-16" }),
    ];
    const keys = calendarItems(events, [s], TODAY, "2026-11-16").map((i) => i.key);
    expect(keys).toEqual(["allday", "s1:2026-11-16", "later"]);
  });
});
