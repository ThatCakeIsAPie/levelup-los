import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEventsStore, type CrmEvent } from "@/stores/eventsStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import { storageKey } from "@/lib/brand";
// The stores persist to localStorage in the demo; there is none in this environment.
const mem = vi.hoisted(() => {
  const m = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    },
  });
  return m;
});

import { addEvent, assignToEvent, removeEvent, updateEvent } from "../events";
import { makeEventRepeat, removeEventFollowing, saveEventFollowing, topUpSeries } from "./api";
import { occurrencesPerDate } from "./plan";

const NOW = new Date(2026, 10, 14, 9, 5); // Saturday 14 November 2026, local time
const day = (n: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + n);
  return d;
};
const state = () => useEventsStore.getState();
const series = (id?: string) =>
  state()
    .events.filter((e) => (id ? e.seriesId === id : !!e.seriesId))
    .sort((a, b) => a.seriesDate!.localeCompare(b.seriesDate!));
const sid = () => state().series[0].id;
const counts = (id = sid()) => Object.fromEntries(occurrencesPerDate(state(), id));
const dates = (id = sid()) => series(id).map((e) => e.seriesDate!);

async function weekly(): Promise<CrmEvent> {
  const e = addEvent({
    name: "Info session",
    categoryId: "w1-info_session",
    date: "2026-11-17",
    location: "Dallas, TX",
    format: "in_person",
  });
  const r = await makeEventRepeat(e.id, { freq: "weekly" });
  expect(r).toEqual({ ok: true });
  return e;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mem.clear();
  useEventsStore.setState({ events: [], series: [] });
  useAttendanceStore.setState({ attendances: [], missedNotes: [] });
});
afterEach(() => vi.useRealTimers());

describe("repeating events in the browser-storage demo", () => {
  it("(a) a weekly event with no end gets the next 8 weeks, one per week", async () => {
    await weekly();
    expect(dates()).toEqual([
      "2026-11-17",
      "2026-11-24",
      "2026-12-01",
      "2026-12-08",
      "2026-12-15",
      "2026-12-22",
      "2026-12-29",
      "2027-01-05",
    ]);
    expect(Object.values(counts()).every((n) => n === 1)).toBe(true);
  });

  it("(b) the top-up run again and again, and concurrently, adds nothing", async () => {
    await weekly();
    const before = counts();
    await Promise.all(Array.from({ length: 25 }, () => topUpSeries()));
    await topUpSeries();
    expect(counts()).toEqual(before);
    expect(state().events).toHaveLength(8);
  });

  it("(c) three weeks later the series is topped up, one per week, none twice, even run 25 times at once", async () => {
    await weekly();
    const before = counts();
    vi.setSystemTime(day(21));
    await Promise.all(Array.from({ length: 25 }, () => topUpSeries()));
    const after = counts();
    expect(Object.keys(before)).toHaveLength(8);
    expect(Object.keys(after)).toHaveLength(11);
    expect(Object.values(after).every((n) => n === 1)).toBe(true);
    expect(dates().slice(-3)).toEqual(["2027-01-12", "2027-01-19", "2027-01-26"]);
  });

  it("another tab that already topped up is not made to do it twice (its events are read first)", async () => {
    await weekly();
    const stale = { events: state().events, series: state().series };
    vi.setSystemTime(day(21));
    await topUpSeries(); // this tab
    const saved = mem.get(storageKey("events"))!;
    // A second tab loaded before that, holds the old list in memory, and wakes up:
    useEventsStore.setState(stale);
    mem.set(storageKey("events"), saved); // (what the first tab saved is what is in storage)
    await Promise.all([topUpSeries(), topUpSeries()]);
    expect(Object.keys(counts())).toHaveLength(11);
    expect(Object.values(counts()).every((n) => n === 1)).toBe(true);
  });

  it("(d) This event: rename one occurrence; only it changes", async () => {
    await weekly();
    const three = series()[2];
    const others = series().filter((e) => e.id !== three.id);
    updateEvent(three.id, { name: "Three only" });
    expect(series().find((e) => e.id === three.id)!.name).toBe("Three only");
    expect(series().find((e) => e.id === three.id)!.seriesOverrides).toEqual(["name"]);
    for (const o of others) expect(series().find((e) => e.id === o.id)).toEqual(o);
  });

  it("(e) This and following: later ones change, earlier ones and their attendance don't", async () => {
    await weekly();
    const two = series()[1];
    assignToEvent(two.id, "p1");
    const three = series()[2];
    updateEvent(three.id, { name: "Three only" });
    const before = series().map((e) => ({ ...e }));
    const four = series()[3];
    const r = await saveEventFollowing(four.id, { location: "Room 9" }, undefined);
    expect(r.ok).toBe(true);
    const now = series();
    expect(now.slice(0, 3).map((e) => e.location)).toEqual([
      "Dallas, TX",
      "Dallas, TX",
      "Dallas, TX",
    ]);
    expect(now.slice(3).every((e) => e.location === "Room 9")).toBe(true);
    expect(now.slice(0, 3)).toEqual(before.slice(0, 3));
    expect(now[2].name).toBe("Three only");
    expect(
      useAttendanceStore.getState().attendances.filter((a) => a.eventId === two.id),
    ).toHaveLength(1);
  });

  it("(f) deleting one occurrence by itself: it never comes back, however the clock moves", async () => {
    await weekly();
    const five = series()[4];
    removeEvent(five.id);
    expect(dates()).not.toContain(five.seriesDate);
    await topUpSeries();
    for (const n of [0, 21, 60]) {
      vi.setSystemTime(day(n));
      await Promise.all([topUpSeries(), topUpSeries()]);
      expect(dates()).not.toContain(five.seriesDate);
    }
    expect(state().series[0].skipped).toEqual([five.seriesDate]);
  });

  it("(g) This and following on delete: later ones gone, series stopped, earlier ones and their attendance intact", async () => {
    await weekly();
    const two = series()[1];
    const seven = series()[6];
    assignToEvent(two.id, "p1");
    assignToEvent(seven.id, "p1");
    const keep = series()
      .slice(0, 5)
      .map((e) => ({ ...e }));
    const r = await removeEventFollowing(series()[5].id);
    expect(r.ok).toBe(true);
    expect(series()).toEqual(keep);
    expect(state().series[0].endsOn).toBe("2026-12-21");
    // the later ones' rosters went with them (as deleting an event does); the earlier ones' stayed
    const rows = useAttendanceStore.getState().attendances;
    expect(rows.filter((a) => a.eventId === two.id)).toHaveLength(1);
    expect(rows.filter((a) => a.eventId === seven.id)).toHaveLength(0);
    vi.setSystemTime(day(90));
    await topUpSeries();
    expect(series()).toHaveLength(5);
  });

  it("re-planning keeps later occurrences that have a roster", async () => {
    await weekly();
    const four = series()[3];
    const six = series()[5];
    assignToEvent(six.id, "p1");
    const r = await saveEventFollowing(four.id, { date: "2026-12-09" }, undefined);
    expect(r.ok).toBe(true);
    const kept = state().events.find((e) => e.id === six.id)!;
    expect(kept.seriesId).toBeUndefined(); // a single event now
    expect(kept.date).toBe("2026-12-22");
    expect(
      useAttendanceStore.getState().attendances.filter((a) => a.eventId === six.id),
    ).toHaveLength(1);
    expect(series(state().series[1].id).map((e) => e.date)[0]).toBe("2026-12-09");
    // one event per date in each series
    for (const s of state().series)
      expect(Object.values(counts(s.id)).every((n) => n === 1)).toBe(true);
  });

  it("an event that doesn't repeat is edited and deleted as before, with nothing about series", () => {
    const e = addEvent({
      name: "Plain",
      categoryId: "w1-info_session",
      date: "2026-11-20",
      format: "in_person",
    });
    updateEvent(e.id, { name: "Plain 2" });
    expect(state().events[0]).toMatchObject({ name: "Plain 2" });
    expect(state().events[0].seriesId).toBeUndefined();
    expect(state().events[0].seriesOverrides).toBeUndefined();
    removeEvent(e.id);
    expect(state().events).toEqual([]);
    expect(state().series).toEqual([]);
  });

  it("monthly on the second Tuesday, ending on a date: right dates, nothing after the end", async () => {
    const e = addEvent({
      name: "Monthly",
      categoryId: "w1-info_session",
      date: "2026-11-10",
      format: "in_person",
    });
    await makeEventRepeat(e.id, { freq: "monthly_weekday", endsOn: "2027-02-28" });
    for (const n of [0, 40, 80, 200]) {
      vi.setSystemTime(day(n));
      await topUpSeries();
    }
    expect(dates()).toEqual(["2026-11-10", "2026-12-08", "2027-01-12", "2027-02-09"]);
  });
});
