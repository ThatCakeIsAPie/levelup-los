import { describe, expect, it } from "vitest";
import type { CrmEvent, EventSeries } from "@/stores/eventsStore";
import { addDaysTo, weekdayOf } from "@/data/recurrence/rule";
import { dayLabel, weekAhead, WEEK_AHEAD_SHOWN } from "./calendar";

const TODAY = "2026-11-14"; // a Saturday

const ev = (over: Partial<CrmEvent> & { id: string; date: string }): CrmEvent => ({
  name: over.id,
  categoryId: "c1",
  ...over,
});
const series = (over: Partial<EventSeries> & { id: string }): EventSeries => ({
  freq: "weekly",
  startsOn: "2026-11-02", // a Monday
  skipped: [],
  name: "Weekly meetup",
  categoryId: "c1",
  lengthDays: 0,
  ...over,
});

describe("the week ahead's seven days", () => {
  it("starts today, whatever weekday that is, and runs six days on", () => {
    const w = weekAhead([], [], TODAY);
    expect(w.start).toBe(TODAY);
    expect(w.days).toEqual([
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
    ]);
    expect(weekdayOf(w.days[0])).toBe(6);
    expect(weekAhead([], [], "2026-11-15").days[0]).toBe("2026-11-15"); // a Sunday
  });

  it("carries across a month end, with the 1st labelled", () => {
    const w = weekAhead([], [], "2026-11-28");
    expect(w.days).toEqual([
      "2026-11-28",
      "2026-11-29",
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
    ]);
    expect(w.days.map((d) => dayLabel(d, "2026-11-28").kind)).toEqual([
      "today",
      "day",
      "day",
      "month",
      "day",
      "day",
      "day",
    ]);
    // February in a leap year
    expect(weekAhead([], [], "2028-02-26").days.slice(2, 5)).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("carries across a year end", () => {
    const w = weekAhead([], [], "2026-12-29");
    expect(w.days).toEqual([
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
      "2027-01-04",
    ]);
    expect(dayLabel(w.days[3], w.start)).toEqual({ text: "Jan 1, 2027", kind: "month" });
    const e = weekAhead([ev({ id: "ny", date: "2027-01-01" })], [], "2026-12-29");
    expect(e.perDay.map((d) => d.length)).toEqual([0, 0, 0, 1, 0, 0, 0]);
  });

  it("is not moved by either daylight-saving change, in any time zone", () => {
    const saved = process.env.TZ;
    try {
      for (const tz of ["America/Chicago", "Europe/London", "Australia/Lord_Howe", "UTC"]) {
        process.env.TZ = tz;
        // US: Mar 8 and Nov 1 2026; Europe: Mar 29 and Oct 25 2026; Lord Howe: Apr 5 and Oct 4 2026.
        for (const [today, change] of [
          ["2026-03-05", "2026-03-08"],
          ["2026-03-27", "2026-03-29"],
          ["2026-04-03", "2026-04-05"],
          ["2026-10-02", "2026-10-04"],
          ["2026-10-23", "2026-10-25"],
          ["2026-10-30", "2026-11-01"],
        ]) {
          const e = ev({ id: "x", date: change });
          const w = weekAhead([e], [], today);
          expect(w.days).toHaveLength(7);
          for (let i = 0; i < 7; i++) expect(w.days[i]).toBe(addDaysTo(today, i));
          expect(w.days).toContain(change);
          expect(new Set(w.days).size).toBe(7);
          expect(w.perDay[w.days.indexOf(change)].map((i) => i.key)).toEqual(["x"]);
          expect(w.perDay.filter((d) => d.length).length).toBe(1);
        }
      }
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});

describe("what the week ahead holds", () => {
  it("leaves out events before today and after the sixth day after it", () => {
    const w = weekAhead(
      [
        ev({ id: "yesterday", date: "2026-11-13" }),
        ev({ id: "today", date: TODAY }),
        ev({ id: "last", date: "2026-11-20" }),
        ev({ id: "tooLate", date: "2026-11-21" }),
        ev({ id: "ended", date: "2026-11-10", endDate: "2026-11-13" }),
      ],
      [],
      TODAY,
    );
    expect(w.perDay.flat().map((i) => i.key)).toEqual(["today", "last"]);
    expect(w.perDay[0].map((i) => i.key)).toEqual(["today"]);
    expect(w.perDay[6].map((i) => i.key)).toEqual(["last"]);
  });

  it("shows a multi-day event on each day it covers inside the window", () => {
    // Began two days ago, ends in two days: today, tomorrow and the day after.
    const w = weekAhead(
      [
        ev({ id: "begun", date: "2026-11-12", endDate: "2026-11-16" }),
        ev({ id: "runs", date: "2026-11-18", endDate: "2026-11-25" }),
      ],
      [],
      TODAY,
    );
    const begun = w.segments.find((s) => s.item.key === "begun")!;
    expect(begun).toMatchObject({ col0: 0, col1: 2, before: true, after: false, multi: true });
    const runs = w.segments.find((s) => s.item.key === "runs")!;
    expect(runs).toMatchObject({ col0: 4, col1: 6, before: false, after: true, multi: true });
    expect(w.perDay.map((d) => d.map((i) => i.key))).toEqual([
      ["begun"],
      ["begun"],
      ["begun"],
      [],
      ["runs"],
      ["runs"],
      ["runs"],
    ]);
    // one row across its days
    expect(begun.lane).toBe(0);
  });

  it("keeps the calendar's same-day order: all-day first, then by time, stored before projected", () => {
    const day = "2026-11-16"; // a Monday
    const w = weekAhead(
      [
        ev({ id: "late", date: day, startTime: "19:00" }),
        ev({ id: "early", date: day, startTime: "08:30" }),
        ev({ id: "allday", date: day }),
      ],
      [series({ id: "s", startTime: "08:30", name: "Standup" })],
      TODAY,
    );
    expect(w.perDay[2].map((i) => `${i.name}${i.projected ? "*" : ""}`)).toEqual([
      "allday",
      "early",
      "Standup*",
      "late",
    ]);
  });

  it("includes events of every category", () => {
    const w = weekAhead(
      [
        ev({ id: "a", date: TODAY, categoryId: "c1" }),
        ev({ id: "b", date: TODAY, categoryId: "c2" }),
      ],
      [series({ id: "s", categoryId: "c3", startsOn: TODAY, freq: "daily" })],
      TODAY,
    );
    expect(new Set(w.perDay[0].map((i) => i.categoryId))).toEqual(new Set(["c1", "c2", "c3"]));
  });
});

describe("the cut after three events a day", () => {
  const day = "2026-11-17";
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      ev({ id: `e${i}`, date: day, startTime: `${String(8 + i).padStart(2, "0")}:00` }),
    );
  const col = 3;

  it("shows up to three, then how many more", () => {
    expect(WEEK_AHEAD_SHOWN).toBe(3);
    for (const [n, hidden] of [
      [1, 0],
      [3, 0],
      [4, 1],
      [5, 2],
      [9, 6],
    ]) {
      const w = weekAhead(many(n), [], TODAY);
      const drawn = w.segments.filter((s) => s.col0 === col);
      expect(drawn).toHaveLength(Math.min(n, 3));
      expect(w.hidden[col]).toBe(hidden);
      // every event of the day is still in perDay, for the list on phones
      expect(w.perDay[col]).toHaveLength(n);
      // the ones drawn are the first three of the day's order
      expect(drawn.map((s) => s.item.key)).toEqual(
        w.perDay[col].slice(0, drawn.length).map((i) => i.key),
      );
      expect(w.slots).toBe(hidden ? 4 : Math.max(n, 0));
    }
  });

  it("counts a bar as one of the day's three, and never draws half a bar", () => {
    const w = weekAhead(
      [
        ev({ id: "bar", date: "2026-11-16", endDate: "2026-11-18" }),
        ...many(4), // four on the 17th too: five items that day
      ],
      [],
      TODAY,
    );
    expect(w.hidden[col]).toBe(2);
    const bar = w.segments.find((s) => s.item.key === "bar");
    expect(bar).toMatchObject({ col0: 2, col1: 4 });
    expect(w.segments.filter((s) => s.col0 <= col && s.col1 >= col)).toHaveLength(3);
    expect(w.hidden[2]).toBe(0);
    expect(w.hidden[4]).toBe(0);
  });

  it("an empty week has nothing in any day", () => {
    const w = weekAhead([ev({ id: "later", date: "2026-12-30" })], [], TODAY);
    expect(w.perDay.every((d) => d.length === 0)).toBe(true);
    expect(w.segments).toEqual([]);
    expect(w.hidden).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("repeating events in the week ahead", () => {
  it("projects occurrences that are not stored, one per matching day", () => {
    // Weekly from Mon Nov 2, nothing stored: Mon Nov 16 is the only Monday in Nov 14..20.
    const w = weekAhead([], [series({ id: "s" })], TODAY);
    expect(w.perDay.map((d) => d.length)).toEqual([0, 0, 1, 0, 0, 0, 0]);
    const it = w.perDay[2][0];
    expect(it).toMatchObject({
      projected: true,
      seriesId: "s",
      date: "2026-11-16",
      name: "Weekly meetup",
    });
    expect(it.eventId).toBeUndefined();
    // a daily one covers all seven days
    const daily = weekAhead(
      [],
      [series({ id: "d", freq: "daily", startsOn: "2026-11-01" })],
      TODAY,
    );
    expect(daily.perDay.map((d) => d.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(daily.perDay.flat().every((i) => i.projected)).toBe(true);
  });

  it("shows the stored occurrence instead when there is one, and not a moved one's old date", () => {
    const stored = ev({
      id: "s-2026-11-16",
      date: "2026-11-16",
      seriesId: "s",
      seriesDate: "2026-11-16",
      name: "Weekly meetup",
    });
    const w = weekAhead([stored], [series({ id: "s" })], TODAY);
    expect(w.perDay[2].map((i) => [i.key, i.projected])).toEqual([["s-2026-11-16", false]]);
    const moved = ev({ ...stored, date: "2026-11-18" });
    const m = weekAhead([moved], [series({ id: "s" })], TODAY);
    expect(m.perDay.map((d) => d.length)).toEqual([0, 0, 0, 0, 1, 0, 0]);
    expect(m.perDay[4][0].projected).toBe(false);
  });

  it("leaves out skipped dates and anything after the series ends", () => {
    expect(
      weekAhead([], [series({ id: "s", skipped: ["2026-11-16"] })], TODAY).perDay.flat(),
    ).toEqual([]);
    expect(weekAhead([], [series({ id: "s", endsOn: "2026-11-13" })], TODAY).perDay.flat()).toEqual(
      [],
    );
    expect(
      weekAhead([], [series({ id: "s", freq: "daily", endsOn: "2026-11-16" })], TODAY).perDay.map(
        (d) => d.length,
      ),
    ).toEqual([1, 1, 1, 0, 0, 0, 0]);
  });

  it("draws a projected multi-day occurrence as a bar over its days", () => {
    const w = weekAhead([], [series({ id: "s", lengthDays: 2 })], TODAY);
    expect(w.segments).toHaveLength(1);
    expect(w.segments[0]).toMatchObject({ col0: 2, col1: 4, multi: true });
    expect(w.segments[0].item.projected).toBe(true);
  });
});
