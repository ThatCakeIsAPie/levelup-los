import { describe, expect, it } from "vitest";
import type { CrmEvent } from "@/stores/eventsStore";
import { fillSeries, isPlanError, startSeries, type SeriesState } from "./plan";
import { moveFollowing, moveOne, restoreMove, slotIndex, snapshotOf } from "./move";
import { addDaysTo, nthDate } from "./rule";

const TODAY = "2026-11-14"; // a Saturday
const FIRST = "2026-11-17"; // the first Tuesday after it

const must = <T>(x: T | { error: string }): T => {
  if (isPlanError(x)) throw new Error(x.error);
  return x;
};

const make = (
  freq: "weekly" | "daily" | "biweekly" | "monthly_date" | "monthly_weekday" = "weekly",
  over: Partial<CrmEvent> = {},
  endsOn?: string,
  today = TODAY,
): SeriesState =>
  must(
    startSeries(
      {
        events: [
          {
            id: "e0",
            name: "Info session",
            categoryId: "c1",
            date: FIRST,
            location: "Dallas, TX",
            format: "in_person",
            startTime: "19:00",
            endTime: "20:30",
            ...over,
          },
        ],
        series: [],
      },
      "e0",
      { freq, endsOn },
      "S1",
      today,
    ),
  );

const inSeries = (s: SeriesState, id: string) =>
  s.events
    .filter((e) => e.seriesId === id)
    .sort((a, b) => a.seriesDate!.localeCompare(b.seriesDate!));
const dateOf = (s: SeriesState, id: string) => s.events.find((e) => e.id === id)!.date;
const slot = (s: SeriesState, n: number) => inSeries(s, "S1")[n];
const perSlot = (s: SeriesState) => {
  const seen = new Map<string, number>();
  for (const e of s.events)
    if (e.seriesId)
      seen.set(
        `${e.seriesId}|${e.seriesDate}`,
        (seen.get(`${e.seriesId}|${e.seriesDate}`) ?? 0) + 1,
      );
  return [...seen.values()];
};

describe("slotIndex", () => {
  it("counts the places of a rule from 0 and says -1 for a date that is not one", () => {
    expect(slotIndex("weekly", "2026-11-17", "2026-11-17")).toBe(0);
    expect(slotIndex("weekly", "2026-11-17", "2026-12-08")).toBe(3);
    expect(slotIndex("weekly", "2026-11-17", "2026-12-09")).toBe(-1);
    expect(slotIndex("weekly", "2026-11-17", "2026-11-10")).toBe(-1);
    expect(slotIndex("monthly_date", "2026-01-31", "2026-02-28")).toBe(1);
  });
});

describe("Move just this one", () => {
  it("makes it a one-time event on the new day, with its times and length, and skips its old place", () => {
    const s = make("weekly", { endDate: undefined });
    const two = slot(s, 1);
    const out = must(moveOne(s, two.id, "2026-11-26"));
    const moved = out.events.find((e) => e.id === two.id)!;
    expect(moved.date).toBe("2026-11-26");
    expect(moved.startTime).toBe("19:00");
    expect(moved.endTime).toBe("20:30");
    expect(moved.seriesId).toBeUndefined();
    expect(moved.seriesDate).toBeUndefined();
    expect(moved.seriesOverrides).toBeUndefined();
    expect(out.series[0].skipped).toEqual([two.seriesDate]);
    // the others are exactly where they were
    for (const e of s.events.filter((x) => x.id !== two.id))
      expect(out.events.find((x) => x.id === e.id)).toEqual(e);
  });

  it("keeps a multi-day event's number of days", () => {
    const s = make("monthly_date", { endDate: "2026-11-19" });
    const out = must(moveOne(s, "e0", "2026-11-20", "2026-11-22"));
    const e = out.events.find((x) => x.id === "e0")!;
    expect([e.date, e.endDate]).toEqual(["2026-11-20", "2026-11-22"]);
  });

  it("is never made again by a later top-up (any day, any number of times)", () => {
    const s = make();
    const two = slot(s, 1);
    const out = must(moveOne(s, two.id, "2026-11-26"));
    for (const today of [TODAY, "2026-11-30", "2026-12-20", "2027-02-01"]) {
      const filled = fillSeries(fillSeries(out, today), today);
      expect(
        filled.events.filter((e) => e.seriesId === "S1" && e.seriesDate === two.seriesDate),
      ).toEqual([]);
      expect(perSlot(filled).every((n) => n === 1)).toBe(true);
    }
  });

  it("works on the first occurrence too (the series goes on from the second)", () => {
    const s = make();
    const out = must(moveOne(s, "e0", "2026-11-18"));
    expect(out.series[0].skipped).toEqual([FIRST]);
    const filled = fillSeries(out, "2026-11-20");
    expect(filled.events.filter((e) => e.seriesId === "S1" && e.seriesDate === FIRST)).toEqual([]);
  });

  it("refuses an event that does not repeat", () => {
    const s = { events: make().events.map((e) => ({ ...e, seriesId: undefined })), series: [] };
    expect(isPlanError(moveOne(s, "e0", "2026-11-18"))).toBe(true);
  });
});

describe("Move all", () => {
  it("shifts this and every later occurrence by the same days, leaves earlier ones, and the rule follows", () => {
    const s = make();
    const four = slot(s, 3);
    const out = must(moveFollowing(s, four.id, 2, "S2"));
    const before = inSeries(s, "S1");
    // earlier ones: untouched objects
    for (const e of before.slice(0, 3))
      expect(out.state.events.find((x) => x.id === e.id)).toEqual(e);
    // this and later: +2 days, same id, same times
    for (const e of before.slice(3)) {
      const moved = out.state.events.find((x) => x.id === e.id)!;
      expect(moved.date).toBe(addDaysTo(e.date, 2));
      expect(moved.startTime).toBe("19:00");
      expect(moved.seriesId).toBe("S2");
      expect(moved.seriesDate).toBe(moved.date);
    }
    expect(out.movedIds).toEqual(before.slice(3).map((e) => e.id));
    const old = out.state.series.find((x) => x.id === "S1")!;
    const next = out.state.series.find((x) => x.id === "S2")!;
    expect(old.endsOn).toBe(addDaysTo(four.seriesDate!, -1));
    expect(next.startsOn).toBe(addDaysTo(four.seriesDate!, 2));
    expect(next.freq).toBe("weekly");
    expect(next.startTime).toBe("19:00");
  });

  it("the series keeps its new weekday when it is topped up later", () => {
    const s = make();
    const four = slot(s, 3);
    const out = must(moveFollowing(s, four.id, 2, "S2")).state; // Tue -> Thu
    const filled = fillSeries(out, "2027-01-04");
    const mine = filled.events.filter((e) => e.seriesId === "S2");
    expect(mine.length).toBeGreaterThan(5);
    for (const e of mine) expect(new Date(`${e.date}T12:00:00Z`).getUTCDay()).toBe(4); // Thursday
    expect(perSlot(filled).every((n) => n === 1)).toBe(true);
    // nothing new is made on the old Tuesdays of the moved part
    expect(
      filled.events.filter((e) => e.seriesId === "S1" && e.date > addDaysTo(four.seriesDate!, -1)),
    ).toEqual([]);
  });

  it("moves the series in place when it is the first occurrence, and its end and skipped dates with it", () => {
    let s = make("weekly", {}, "2027-03-02");
    const third = slot(s, 2);
    s = must(moveOne(s, third.id, "2026-12-03")); // detach the third; its place is skipped
    const skippedBefore = s.series[0].skipped;
    const out = must(moveFollowing(s, "e0", -1, "S2")).state;
    expect(out.series).toHaveLength(1);
    expect(out.series[0].id).toBe("S1");
    expect(out.series[0].startsOn).toBe("2026-11-16");
    expect(out.series[0].endsOn).toBe("2027-03-01");
    expect(out.series[0].skipped).toEqual(skippedBefore.map((d) => addDaysTo(d, -1)));
    expect(dateOf(out, "e0")).toBe("2026-11-16");
    // the detached one is not part of it: it stays where it was moved to
    expect(dateOf(out, third.id)).toBe("2026-12-03");
    // a top-up makes nothing on the skipped (shifted) place
    const filled = fillSeries(out, "2026-12-01");
    expect(
      filled.events.filter((e) => e.seriesId === "S1" && e.seriesDate === "2026-11-30"),
    ).toEqual([]);
  });

  it("keeps a multi-day event's length and marks a monthly event that no longer sits on its place", () => {
    // Monthly on the second Tuesday, moved by +6 days: its places become the third Monday of each month.
    const s = make("monthly_weekday", { date: "2026-11-10" }, undefined, "2026-11-01");
    const first = s.events.find((e) => e.id === "e0")!;
    const next = inSeries(s, "S1")[1];
    const out = must(moveFollowing(s, first.id, 6, "S2")).state;
    expect(out.series[0].startsOn).toBe("2026-11-16");
    const moved = out.events.find((e) => e.id === next.id)!;
    expect(moved.date).toBe(addDaysTo(next.date, 6)); // by the same days...
    expect(moved.seriesDate).toBe(nthDate("monthly_weekday", "2026-11-16", 1)); // ...its place is the next month's
    if (moved.date !== moved.seriesDate) expect(moved.seriesOverrides).toContain("date");
    expect(perSlot(out).every((n) => n === 1)).toBe(true);

    const long = make("monthly_date", { date: "2026-11-17", endDate: "2026-11-19" });
    const moved2 = must(moveFollowing(long, "e0", 1, "S2")).state.events.find(
      (e) => e.id === "e0",
    )!;
    expect([moved2.date, moved2.endDate]).toEqual(["2026-11-18", "2026-11-20"]);
  });

  it("refuses 0 days and an event that does not repeat", () => {
    const s = make();
    expect(isPlanError(moveFollowing(s, "e0", 0, "S2"))).toBe(true);
    const single = { events: s.events.map((e) => ({ ...e, seriesId: undefined })), series: [] };
    expect(isPlanError(moveFollowing(single, "e0", 1, "S2"))).toBe(true);
  });

  it("a moved-by-itself occurrence keeps its own offset", () => {
    let s = make();
    s = must(moveFollowing(s, slot(s, 1).id, 1, "S2")).state;
    const two = s.events.find((e) => e.seriesId === "S2" && e.seriesDate === "2026-11-25")!;
    expect(two.date).toBe("2026-11-25");
  });
});

describe("Undo", () => {
  it("brings back the one occurrence into its series, with its skipped place and its marks", () => {
    const s = make();
    const two = slot(s, 1);
    const before = { events: s.events, series: s.series };
    const out = must(moveOne(s, two.id, "2026-11-26"));
    const back = restoreMove(out, snapshotOf(before, out));
    expect(back).toEqual(before);
  });

  it("brings back all of a split: dates, series, the old series' end, and drops the new series", () => {
    const s = make("weekly", {}, "2027-02-23");
    const before = { events: s.events, series: s.series };
    const out = must(moveFollowing(s, slot(s, 3).id, -3, "S2")).state;
    expect(out.series).toHaveLength(2);
    const snap = snapshotOf(before, out);
    expect(snap.dropSeries).toEqual(["S2"]);
    expect(restoreMove(out, snap)).toEqual(before);
  });

  it("brings back an in-place move of the whole series", () => {
    const s = make("monthly_date", {}, "2027-05-17");
    const before = { events: s.events, series: s.series };
    const out = must(moveFollowing(s, "e0", 5, "S2")).state;
    expect(restoreMove(out, snapshotOf(before, out))).toEqual(before);
  });

  it("does not touch what was changed elsewhere in the meantime", () => {
    const s = make();
    const before = { events: s.events, series: s.series };
    const out = must(moveOne(s, slot(s, 1).id, "2026-11-26"));
    const snap = snapshotOf(before, out);
    const other = slot(s, 4);
    const edited = {
      ...out,
      events: out.events.map((e) => (e.id === other.id ? { ...e, name: "Renamed" } : e)),
    };
    const back = restoreMove(edited, snap);
    expect(back.events.find((e) => e.id === other.id)!.name).toBe("Renamed");
    expect(back.events.find((e) => e.id === slot(s, 1).id)!.seriesId).toBe("S1");
  });

  it("keeps a series someone has since put an event in", () => {
    const s = make();
    const before = { events: s.events, series: s.series };
    const out = must(moveFollowing(s, slot(s, 3).id, 2, "S2")).state;
    const snap = snapshotOf(before, out);
    const kept = restoreMove(out, snap);
    expect(kept.series.map((x) => x.id)).toEqual(["S1"]);
    const stuck = {
      ...out,
      events: [
        ...out.events,
        { ...out.events[0], id: "x", seriesId: "S2", seriesDate: "2027-09-01" },
      ],
    };
    expect(restoreMove(stuck, snap).series.map((x) => x.id)).toContain("S2");
  });
});
