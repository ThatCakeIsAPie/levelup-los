import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEventsStore } from "@/stores/eventsStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
// The stores persist to localStorage in the demo; there is none in this environment.
vi.hoisted(() => {
  const m = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    },
  });
});

import { addEvent, assignToEvent, updateAttendance } from "../events";
import { makeEventRepeat, moveEventFollowing, moveEventOne, topUpSeries } from "./api";

const NOW = new Date(2026, 10, 14, 9, 5); // Saturday 14 November 2026, local time
const state = () => useEventsStore.getState();
const mine = () =>
  state()
    .events.filter((e) => e.seriesId)
    .sort((a, b) => a.seriesDate!.localeCompare(b.seriesDate!));

async function weekly() {
  const e = addEvent({
    name: "Info session",
    categoryId: "w1-info_session",
    date: "2026-11-17",
    startTime: "19:00",
    endTime: "20:30",
    location: "Dallas, TX",
    format: "in_person",
  });
  expect(await makeEventRepeat(e.id, { freq: "weekly" })).toEqual({ ok: true });
  return e;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  useEventsStore.setState({ events: [], series: [] });
  useAttendanceStore.setState({ attendances: [], missedNotes: [] });
});
afterEach(() => vi.useRealTimers());

describe("moving an occurrence on the calendar (browser-storage demo)", () => {
  it("Move just this one: a one-time event, answers kept, the series does not make it again, Undo puts it back", async () => {
    await weekly();
    const three = mine()[2];
    const row = assignToEvent(three.id, "p1");
    updateAttendance(row.id, { desire: "going" } as never);
    const snapshot = JSON.stringify(state().events);
    const seriesBefore = JSON.stringify(state().series);

    const r = await moveEventOne(three.id, "2026-12-03");
    expect(r.ok).toBe(true);
    const moved = state().events.find((e) => e.id === three.id)!;
    expect([moved.date, moved.startTime, moved.endTime]).toEqual(["2026-12-03", "19:00", "20:30"]);
    expect(moved.seriesId).toBeUndefined();
    expect(state().series[0].skipped).toEqual([three.seriesDate]);
    // the answer is still on the same event
    const att = useAttendanceStore.getState().attendances.find((a) => a.eventId === three.id)!;
    expect(att.personId).toBe("p1");
    expect((att as unknown as { desire: string }).desire).toBe("going");

    // a top-up, even weeks later, does not bring the old Tuesday back
    vi.setSystemTime(new Date(2026, 11, 21, 9, 0));
    await topUpSeries();
    await topUpSeries();
    expect(
      state().events.filter((e) => e.seriesDate === three.seriesDate && e.id !== three.id),
    ).toEqual([]);

    vi.setSystemTime(NOW);
    if (r.ok) expect(await r.undo()).toEqual({ ok: true });
    expect(JSON.stringify(state().series)).toBe(seriesBefore);
    const back = state().events.find((e) => e.id === three.id)!;
    expect(back.seriesId).toBe(three.seriesId);
    expect(
      JSON.stringify(state().events.filter((e) => e.seriesDate && e.seriesDate <= "2027-01-05")),
    ).toBe(
      JSON.stringify(JSON.parse(snapshot).filter((e: { seriesDate?: string }) => e.seriesDate)),
    );
  });

  it("Move all: this and later move together with their answers, earlier stay, the rule follows, Undo restores", async () => {
    await weekly();
    const four = mine()[3];
    assignToEvent(four.id, "p1");
    const before = JSON.stringify(state());
    const earlier = mine()
      .slice(0, 3)
      .map((e) => JSON.stringify(e));

    const r = await moveEventFollowing(four.id, 2);
    expect(r.ok && r.moved).toBe(5);
    expect(
      mine()
        .slice(0, 3)
        .map((e) => JSON.stringify(e)),
    ).toEqual(earlier);
    const fourNow = state().events.find((e) => e.id === four.id)!;
    expect(fourNow.date).toBe("2026-12-10"); // Tuesday Dec 8 + 2
    expect(useAttendanceStore.getState().attendances.some((a) => a.eventId === four.id)).toBe(true);
    expect(state().series).toHaveLength(2);

    // Undo (before anything else changes): exactly what was there
    vi.setSystemTime(NOW);
    if (r.ok) expect(await r.undo()).toEqual({ ok: true });
    expect(JSON.stringify(state())).toBe(before);
    // and a top-up afterwards makes nothing twice
    vi.setSystemTime(new Date(2027, 0, 25, 9, 0));
    await topUpSeries();
    const slots = state()
      .events.filter((e) => e.seriesId)
      .map((e) => e.seriesDate);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("a move of an event that does not repeat is refused, nothing changes", async () => {
    const e = addEvent({ name: "Once", categoryId: "w1-info_session", date: "2026-11-20" });
    const r = await moveEventOne(e.id, "2026-11-21");
    expect(r.ok).toBe(false);
    expect(state().events.find((x) => x.id === e.id)!.date).toBe("2026-11-20");
  });
});
