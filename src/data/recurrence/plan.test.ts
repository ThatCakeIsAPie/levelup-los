import { describe, expect, it } from "vitest";
import type { CrmEvent } from "@/stores/eventsStore";
import {
  dedupeOccurrences,
  editFollowing,
  fillSeries,
  isPlanError,
  markOverrides,
  needsFill,
  occurrencesPerDate,
  removeFollowing,
  removeOne,
  slotId,
  startSeries,
  type Hooks,
  type Outcome,
  type SeriesState,
} from "./plan";
import { addDaysTo } from "./rule";

const TODAY = "2026-11-14"; // a Saturday
const FIRST = "2026-11-17"; // the first Tuesday after it

const base = (over: Partial<CrmEvent> = {}): CrmEvent => ({
  id: "e0",
  name: "Info session",
  categoryId: "c1",
  date: FIRST,
  location: "Dallas, TX",
  format: "in_person",
  ...over,
});

const must = <T>(x: T | { error: string }): T => {
  if (isPlanError(x)) throw new Error(x.error);
  return x;
};

const make = (
  freq = "weekly" as const,
  over: Partial<CrmEvent> = {},
  endsOn?: string,
): SeriesState =>
  must(startSeries({ events: [base(over)], series: [] }, "e0", { freq, endsOn }, "S1", TODAY));

const dates = (s: SeriesState, seriesId = "S1") =>
  s.events
    .filter((e) => e.seriesId === seriesId)
    .map((e) => e.seriesDate!)
    .sort();
const at = (s: SeriesState, date: string, seriesId = "S1") =>
  s.events.find((e) => e.seriesId === seriesId && e.seriesDate === date)!;
const hooks = (today = TODAY, dependents: string[] = []): Hooks => ({
  today,
  hasDependents: (id) => dependents.includes(id),
  newSeriesId: () => "S2",
});
const outcome = (x: Outcome | { error: string }) => must(x);
const perDate = (s: SeriesState, id = "S1") => [...occurrencesPerDate(s, id).values()];

const WEEKLY = [
  "2026-11-17",
  "2026-11-24",
  "2026-12-01",
  "2026-12-08",
  "2026-12-15",
  "2026-12-22",
  "2026-12-29",
  "2027-01-05",
];

describe("a new repeating series", () => {
  it("makes the first date and the next 8 weeks, one per week", () => {
    const s = make();
    expect(dates(s)).toEqual(WEEKLY);
    expect(s.series).toHaveLength(1);
    expect(s.series[0]).toMatchObject({ id: "S1", freq: "weekly", startsOn: FIRST, skipped: [] });
  });

  it("makes every occurrence a real event of its own with the series' details", () => {
    const s = make();
    const ids = new Set(s.events.map((e) => e.id));
    expect(ids.size).toBe(8);
    expect(at(s, "2026-12-08")).toMatchObject({
      name: "Info session",
      categoryId: "c1",
      location: "Dallas, TX",
      date: "2026-12-08",
      id: slotId("S1", "2026-12-08"),
    });
  });

  it("the first date can be in the past, and nothing else is", () => {
    const s = must(
      startSeries(
        { events: [base({ date: "2026-10-27" })], series: [] },
        "e0",
        { freq: "weekly" },
        "S1",
        TODAY,
      ),
    );
    expect(dates(s)[0]).toBe("2026-10-27");
    expect(
      dates(s)
        .slice(1)
        .every((d) => d >= TODAY),
    ).toBe(true);
    expect(dates(s)).not.toContain("2026-11-03");
    expect(dates(s)).not.toContain("2026-11-10");
  });

  it("a monthly series on the second Tuesday, ending on a date, stops there", () => {
    const s = must(
      startSeries(
        { events: [base({ date: "2026-11-10" })], series: [] },
        "e0",
        { freq: "monthly_weekday", endsOn: "2027-02-28" },
        "S1",
        TODAY,
      ),
    );
    // The first date is past; the next two are the ones ahead (the second is beyond 8 weeks: never fewer than 2).
    expect(dates(s)).toEqual(["2026-11-10", "2026-12-08", "2027-01-12"]);
    const later = fillSeries(s, "2027-01-20");
    expect(dates(later)).toEqual(["2026-11-10", "2026-12-08", "2027-01-12", "2027-02-09"]);
    expect(dates(fillSeries(later, "2027-06-01"))).toEqual(dates(later));
  });

  it("multi-day events repeat only less often than they are long", () => {
    const three = base({ endDate: "2026-11-19" });
    const run = (freq: "daily" | "weekly") =>
      startSeries({ events: [three], series: [] }, "e0", { freq }, "S1", TODAY);
    expect(isPlanError(run("daily"))).toBe(true);
    const s = must(run("weekly"));
    expect(at(s, "2026-12-01").endDate).toBe("2026-12-03");
  });

  it("refuses an event that already repeats, and an end before the start", () => {
    const s = make();
    expect(isPlanError(startSeries(s, "e0", { freq: "daily" }, "S9", TODAY))).toBe(true);
    expect(
      isPlanError(
        startSeries(
          { events: [base()], series: [] },
          "e0",
          { freq: "daily", endsOn: "2026-11-01" },
          "S1",
          TODAY,
        ),
      ),
    ).toBe(true);
  });
});

describe("exactly one event per series date (requirement A)", () => {
  it("running the top-up again and again changes nothing: count per date before and after", () => {
    const start = make();
    const before = Object.fromEntries(occurrencesPerDate(start, "S1"));
    let s = start;
    for (let i = 0; i < 25; i++) s = fillSeries(s, TODAY);
    const after = Object.fromEntries(occurrencesPerDate(s, "S1"));
    expect(after).toEqual(before);
    expect(Object.values(after).every((n) => n === 1)).toBe(true);
    expect(s).toBe(start); // the very same object: nothing was touched
    expect(needsFill(start, TODAY)).toBe(false);
  });

  it("tops up as time passes, one per week, none twice", () => {
    let s = make();
    const days = [
      TODAY,
      addDaysTo(TODAY, 7),
      addDaysTo(TODAY, 21),
      addDaysTo(TODAY, 21),
      addDaysTo(TODAY, 22),
    ];
    for (const d of days) s = fillSeries(s, d);
    expect(dates(s)).toEqual([...WEEKLY, "2027-01-12", "2027-01-19", "2027-01-26"]);
    expect(perDate(s).every((n) => n === 1)).toBe(true);
    expect(needsFill(s, addDaysTo(TODAY, 21))).toBe(false);
    expect(needsFill(s, addDaysTo(TODAY, 40))).toBe(true);
  });

  it("two copies that each fill from the same stale state make the very same events", () => {
    const start = make();
    const later = addDaysTo(TODAY, 21);
    const tabA = fillSeries(start, later);
    const tabB = fillSeries(start, later);
    // Whichever tab saves last wins, or both are merged: either way one per date.
    expect(tabA.events.map((e) => e.id).sort()).toEqual(tabB.events.map((e) => e.id).sort());
    const merged = dedupeOccurrences([...tabA.events, ...tabB.events]);
    expect(merged).toHaveLength(tabA.events.length);
    expect(perDate({ ...tabA, events: merged }).every((n) => n === 1)).toBe(true);
  });

  it("a stray second copy for one date is dropped the next time the events load", () => {
    const s = make();
    const twin: CrmEvent = { ...at(s, "2026-12-08"), id: "twin" };
    const withTwin = [...s.events, twin];
    expect(dedupeOccurrences(withTwin)).toHaveLength(8);
    expect(fillSeries({ ...s, events: withTwin }, TODAY).events).toHaveLength(8);
  });
});

describe("one occurrence on its own: This event (requirement B)", () => {
  it("a deleted occurrence is never made again", () => {
    let s = make();
    const gone = at(s, "2026-12-08");
    s = removeOne(s, gone.id);
    expect(dates(s)).not.toContain("2026-12-08");
    expect(s.series[0].skipped).toEqual(["2026-12-08"]);
    for (const d of [TODAY, addDaysTo(TODAY, 21), addDaysTo(TODAY, 120), TODAY]) {
      s = fillSeries(s, d);
      expect(dates(s)).not.toContain("2026-12-08");
    }
  });

  it("a plain event is deleted as before, with nothing to remember", () => {
    const single: SeriesState = { events: [base()], series: [] };
    expect(removeOne(single, "e0")).toEqual({ events: [], series: [] });
  });

  it("an edited occurrence remembers what was changed on it", () => {
    const s = make();
    const e = at(s, "2026-12-01");
    expect(markOverrides(e, { name: "Special" })).toEqual({ seriesOverrides: ["name"] });
    expect(markOverrides(e, { name: "Info session" })).toEqual({}); // nothing changed
    expect(markOverrides({ ...e, seriesOverrides: ["name"] }, { date: "2026-12-02" })).toEqual({
      seriesOverrides: ["date", "name"],
    });
    expect(markOverrides(base(), { name: "x" })).toEqual({}); // not part of a series
  });

  it("moving one occurrence keeps its place: the top-up does not make another for the old date", () => {
    let s = make();
    const e = at(s, "2026-12-01");
    const moved = { ...e, date: "2026-12-03", seriesOverrides: ["date"] };
    s = { ...s, events: s.events.map((x) => (x.id === e.id ? moved : x)) };
    s = fillSeries(s, TODAY);
    s = fillSeries(s, addDaysTo(TODAY, 21));
    expect(s.events.filter((x) => x.date === "2026-12-01")).toHaveLength(0);
    expect(perDate(s).every((n) => n === 1)).toBe(true);
    expect(at(s, "2026-12-01").date).toBe("2026-12-03");
  });
});

describe("This and following: changing fields (requirement B, last case)", () => {
  const withOwnName = () => {
    const s = make();
    const seven = at(s, "2027-01-05");
    return {
      ...s,
      events: s.events.map((e) =>
        e.id === seven.id ? { ...e, name: "Own name", seriesOverrides: ["name"] } : e,
      ),
    };
  };

  it("changes this one and every later one, never an earlier one", () => {
    const s = make();
    const from = at(s, "2026-12-08");
    const out = outcome(editFollowing(s, from.id, { location: "Room 9" }, undefined, hooks()));
    const loc = (d: string) => at(out.state, d).location;
    expect(["2026-11-17", "2026-11-24", "2026-12-01"].map(loc)).toEqual([
      "Dallas, TX",
      "Dallas, TX",
      "Dallas, TX",
    ]);
    expect(["2026-12-08", "2026-12-15", "2027-01-05"].map(loc)).toEqual([
      "Room 9",
      "Room 9",
      "Room 9",
    ]);
    expect(out.state.series[0].location).toBe("Room 9");
    expect(out.removedIds).toEqual([]);
  });

  it("applies to occurrences made in future", () => {
    const s = make();
    const out = outcome(
      editFollowing(
        s,
        at(s, "2026-12-08").id,
        { location: "Room 9", name: "New" },
        undefined,
        hooks(),
      ),
    );
    const later = fillSeries(out.state, addDaysTo(TODAY, 28));
    expect(at(later, "2027-02-02")).toMatchObject({ location: "Room 9", name: "New" });
  });

  it("RULE: a field changed on one occurrence stays as it is when the edit starts at an earlier one", () => {
    const s = withOwnName();
    const out = outcome(
      editFollowing(
        s,
        at(s, "2026-12-08").id,
        { name: "Renamed", location: "Room 9" },
        undefined,
        hooks(),
      ),
    );
    expect(at(out.state, "2027-01-05")).toMatchObject({ name: "Own name", location: "Room 9" });
    expect(at(out.state, "2026-12-29").name).toBe("Renamed");
    expect(at(out.state, "2027-01-05").seriesOverrides).toEqual(["name"]);
  });

  it("RULE: an edit that starts at that occurrence overwrites its own change", () => {
    const s = withOwnName();
    const out = outcome(
      editFollowing(s, at(s, "2027-01-05").id, { name: "Renamed" }, undefined, hooks()),
    );
    expect(at(out.state, "2027-01-05").name).toBe("Renamed");
    expect(at(out.state, "2027-01-05").seriesOverrides).toBeUndefined();
  });

  it("an unchanged field is not 'changed': a form that sends everything leaves later own edits alone", () => {
    const s = withOwnName();
    const e = at(s, "2026-12-08");
    const patch = { name: e.name, categoryId: e.categoryId, location: "Room 9", notes: undefined };
    const out = outcome(editFollowing(s, e.id, patch, undefined, hooks()));
    expect(at(out.state, "2027-01-05").name).toBe("Own name");
  });

  it("changes the length of later occurrences (not those moved on their own)", () => {
    const s = make();
    const out = outcome(
      editFollowing(s, at(s, "2026-12-08").id, { endDate: "2026-12-09" }, undefined, hooks()),
    );
    expect(at(out.state, "2026-12-15").endDate).toBe("2026-12-16");
    expect(at(out.state, "2026-12-01").endDate).toBeUndefined();
    expect(out.state.series[0].lengthDays).toBe(1);
  });

  it("refuses a length that overlaps the next occurrence", () => {
    const s = make();
    expect(
      isPlanError(
        editFollowing(s, at(s, "2026-12-08").id, { endDate: "2026-12-15" }, undefined, hooks()),
      ),
    ).toBe(true);
  });
});

describe("This and following: changing the schedule", () => {
  it("moving an occurrence a day later shifts the series from it, splitting it there", () => {
    const s = make();
    const e = at(s, "2026-12-08");
    const out = outcome(editFollowing(s, e.id, { date: "2026-12-09" }, undefined, hooks()));
    const st = out.state;
    expect(dates(st, "S1")).toEqual(["2026-11-17", "2026-11-24", "2026-12-01"]);
    expect(st.series.find((x) => x.id === "S1")!.endsOn).toBe("2026-12-07");
    expect(dates(st, "S2")).toEqual([
      "2026-12-09",
      "2026-12-16",
      "2026-12-23",
      "2026-12-30",
      "2027-01-06",
    ]);
    expect(st.series.find((x) => x.id === "S2")).toMatchObject({
      freq: "weekly",
      startsOn: "2026-12-09",
    });
    // the earlier ones are untouched, and the moved one keeps its id
    expect(at(st, "2026-12-01", "S1").id).toBe(at(s, "2026-12-01").id);
    expect(st.events.find((x) => x.id === e.id)).toMatchObject({
      date: "2026-12-09",
      seriesId: "S2",
    });
    // later ones nobody touched were replaced, 5 of them
    expect(out.removedIds).toHaveLength(4);
    expect(
      perDate(st, "S1")
        .concat(perDate(st, "S2"))
        .every((n) => n === 1),
    ).toBe(true);
  });

  it("later occurrences with a roster are never deleted: kept as single events when their date no longer fits", () => {
    const s = make();
    const e = at(s, "2026-12-08");
    const rostered = at(s, "2026-12-22");
    const out = outcome(
      editFollowing(s, e.id, { date: "2026-12-09" }, undefined, hooks(TODAY, [rostered.id])),
    );
    const kept = out.state.events.find((x) => x.id === rostered.id)!;
    expect(kept.seriesId).toBeUndefined();
    expect(kept.date).toBe("2026-12-22");
    expect(out.removedIds).not.toContain(rostered.id);
  });

  it("later occurrences with a roster stay in the series when their date still fits the new rule", () => {
    const s = make();
    const e = at(s, "2026-12-08");
    const rostered = at(s, "2026-12-22");
    // weekly -> every 2 weeks from the 8th: the 22nd still fits (and so does the 5th of January? no: 12-08+14k).
    const out = outcome(
      editFollowing(s, e.id, {}, { freq: "biweekly" }, hooks(TODAY, [rostered.id])),
    );
    const kept = out.state.events.find((x) => x.id === rostered.id)!;
    expect(kept.seriesId).toBe("S2");
    expect(kept.seriesDate).toBe("2026-12-22");
    // 12-15 and 12-29 don't fit and were dropped; 12-22 stayed; nothing was made twice
    expect(dates(out.state, "S2")).toEqual(["2026-12-08", "2026-12-22", "2027-01-05"]);
    expect(perDate(out.state, "S2").every((n) => n === 1)).toBe(true);
  });

  it("later occurrences with their own edits are kept too (as single events when they no longer fit)", () => {
    const s = make();
    const own = at(s, "2027-01-05");
    const edited = {
      ...s,
      events: s.events.map((x) =>
        x.id === own.id ? { ...x, name: "Mine", seriesOverrides: ["name"] } : x,
      ),
    };
    const out = outcome(
      editFollowing(
        edited,
        at(edited, "2026-12-08").id,
        { date: "2026-12-09" },
        undefined,
        hooks(),
      ),
    );
    const kept = out.state.events.find((x) => x.id === own.id)!;
    expect(kept).toMatchObject({ name: "Mine", date: "2027-01-05" });
    expect(kept.seriesId).toBeUndefined();
    expect(kept.seriesOverrides).toBeUndefined();
  });

  it("finished later occurrences are history: kept even with nothing on them", () => {
    const s = make();
    const e = at(s, "2026-11-24");
    // 'today' has moved on past the 1st of December
    const out = outcome(
      editFollowing(s, e.id, { date: "2026-11-25" }, undefined, hooks("2026-12-05")),
    );
    const past = out.state.events.find((x) => x.date === "2026-12-01")!;
    expect(past.seriesId).toBeUndefined();
    expect(out.removedIds).not.toContain(past.id);
  });

  it("changing Ends from the first occurrence changes the series itself", () => {
    const s = make();
    const first = at(s, FIRST);
    const out = outcome(
      editFollowing(s, first.id, {}, { freq: "weekly", endsOn: "2026-12-08" }, hooks()),
    );
    expect(out.state.series).toHaveLength(1);
    expect(out.state.series[0].endsOn).toBe("2026-12-08");
    expect(dates(out.state)).toEqual(["2026-11-17", "2026-11-24", "2026-12-01", "2026-12-08"]);
    const later = fillSeries(out.state, addDaysTo(TODAY, 90));
    expect(dates(later)).toHaveLength(4); // and nothing is made after it
  });

  it("changing Ends later in the series splits it: the earlier ones keep their own end", () => {
    const s = make();
    const out = outcome(
      editFollowing(
        s,
        at(s, "2026-12-01").id,
        {},
        { freq: "weekly", endsOn: "2026-12-08" },
        hooks(),
      ),
    );
    expect(dates(out.state, "S1")).toEqual(["2026-11-17", "2026-11-24"]);
    expect(dates(out.state, "S2")).toEqual(["2026-12-01", "2026-12-08"]);
    expect(out.state.series.find((x) => x.id === "S1")!.endsOn).toBe("2026-11-30");
  });

  it("stopping repeating here makes this one a single event and stops the series before it", () => {
    const s = make();
    const out = outcome(editFollowing(s, at(s, "2026-12-08").id, {}, "none", hooks()));
    expect(dates(out.state)).toEqual(["2026-11-17", "2026-11-24", "2026-12-01"]);
    const here = out.state.events.find((x) => x.id === slotId("S1", "2026-12-08"))!;
    expect(here.seriesId).toBeUndefined();
    expect(out.removedIds).toHaveLength(4);
    expect(dates(fillSeries(out.state, addDaysTo(TODAY, 60)))).toHaveLength(3);
  });

  it("a deleted date carries over to the new series from the split on", () => {
    let s = make();
    s = removeOne(s, at(s, "2026-12-22").id);
    s = removeOne(s, at(s, "2026-11-24").id);
    const out = outcome(editFollowing(s, at(s, "2026-12-08").id, {}, { freq: "daily" }, hooks()));
    const second = out.state.series.find((x) => x.id === "S2")!;
    expect(second.skipped).toEqual(["2026-12-22"]);
    expect(dates(out.state, "S2")).not.toContain("2026-12-22");
  });
});

describe("This and following: delete (requirement D)", () => {
  it("removes this and every later occurrence, stops the series there and leaves earlier ones alone", () => {
    const s = make();
    const e = at(s, "2026-12-15");
    const out = outcome(removeFollowing(s, e.id, { today: TODAY }));
    expect(dates(out.state)).toEqual(["2026-11-17", "2026-11-24", "2026-12-01", "2026-12-08"]);
    expect(out.removedIds).toHaveLength(4);
    expect(out.state.series[0].endsOn).toBe("2026-12-14");
    // the series is stopped: a later top-up makes nothing
    expect(dates(fillSeries(out.state, addDaysTo(TODAY, 90)))).toHaveLength(4);
    // earlier occurrences keep their very same events
    for (const d of dates(out.state)) expect(at(out.state, d)).toBe(at(s, d));
  });

  it("later occurrences that are already over stay, as single events", () => {
    const s = make();
    const out = outcome(removeFollowing(s, at(s, "2026-11-24").id, { today: "2026-12-10" }));
    const past = out.state.events.find((x) => x.date === "2026-12-01")!;
    expect(past.seriesId).toBeUndefined();
    expect(out.removedIds).toHaveLength(5); // 24 Nov and the ones from 15 Dec on
  });

  it("deleting from the first occurrence ends the series before it", () => {
    const s = make();
    const out = outcome(removeFollowing(s, at(s, FIRST).id, { today: TODAY }));
    expect(out.state.events).toHaveLength(0);
    expect(fillSeries(out.state, addDaysTo(TODAY, 60)).events).toHaveLength(0);
  });

  it("an event that doesn't repeat has no following ones", () => {
    expect(
      isPlanError(removeFollowing({ events: [base()], series: [] }, "e0", { today: TODAY })),
    ).toBe(true);
    expect(
      isPlanError(editFollowing({ events: [base()], series: [] }, "e0", {}, undefined, hooks())),
    ).toBe(true);
  });
});
