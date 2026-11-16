/**
 * Moving an occurrence of a repeating event to another day (the calendar's drag), as pure functions over
 * `{ events, series }`: no stores, no clock, no ids from a random source except the one the caller hands in.
 * The browser-storage demo applies these directly; with real accounts the database does the same in
 * `move_event_one`, `move_event_series_following` and `restore_event_move` (migration
 * `20261116000100_move_event_occurrences`), and both follow the same rules:
 *
 *  - "Move just this one" (`moveOne`): the occurrence leaves its series and becomes a single event on its
 *    new days. Its old place in the series is kept in `series.skipped`, so filling never makes it again.
 *    This is not what a plain edit of the date does: that keeps the event in the series, on its old place.
 *  - "Move all" (`moveFollowing`): this occurrence and every later one move by the same number of days and the
 *    rule moves with them (the series is split before this occurrence, or moved in place when this is its
 *    first), so filling makes the next ones on the new weekday. This is not what "This and following events"
 *    does with a new date: that plans the later occurrences again and drops the ones nothing hangs off.
 *    Here no event is made or dropped, so every event keeps its id, answers, tickets and attendance.
 *  - Nothing is filled by a move; the next filling does it.
 *  - `snapshotOf` / `restoreMove` are the Undo: the events and series a move changed, as they were.
 */
import type { CrmEvent, EventSeries } from "@/stores/eventsStore";
import { addDaysTo, nthDate } from "./rule";
import { tombstone, type PlanError, type SeriesState } from "./plan";

/** Safety stop for counting along a rule. */
const MAX_STEPS = 5000;

/** The number of a date's place in a rule (0 = the first date), or -1 when it is not one of its dates. */
export function slotIndex(freq: EventSeries["freq"], anchor: string, date: string): number {
  if (date < anchor) return -1;
  for (let n = 0; n < MAX_STEPS; n++) {
    const d = nthDate(freq, anchor, n);
    if (d === date) return n;
    if (d > date) return -1;
  }
  return -1;
}

const detach = (e: CrmEvent): CrmEvent => {
  const { seriesId: _s, seriesDate: _d, seriesOverrides: _o, ...rest } = e;
  return rest;
};

/** The same event on other days (its times stay; a one-day event stays one day). */
function onDays(e: CrmEvent, date: string, endDate: string | undefined): CrmEvent {
  const next: CrmEvent = { ...e, date };
  if (endDate) next.endDate = endDate;
  else delete next.endDate;
  return next;
}

/** "Move just this one": a single event on the new days; the series keeps going without this place. */
export function moveOne(
  state: SeriesState,
  eventId: string,
  date: string,
  endDate?: string,
): SeriesState | PlanError {
  const e = state.events.find((x) => x.id === eventId);
  if (!e || !e.seriesId || !e.seriesDate) return { error: "That event doesn't repeat." };
  return {
    events: state.events.map((x) => (x.id === e.id ? detach(onDays(x, date, endDate)) : x)),
    series: tombstone(state.series, e),
  };
}

export interface Moved {
  state: SeriesState;
  /** The events that moved (this one and the later ones). */
  movedIds: string[];
}

/**
 * "Move all": this occurrence and every later one of its series move `days` days (negative = earlier) and so
 * does the rule. Earlier occurrences stay. A moved event whose date is no longer its place in the rule (a
 * monthly rule keeps counting its own days) is marked as changed on its own, like any occurrence moved by hand.
 */
export function moveFollowing(
  state: SeriesState,
  eventId: string,
  days: number,
  newSeriesId: string,
): Moved | PlanError {
  const e = state.events.find((x) => x.id === eventId);
  const s = e?.seriesId ? state.series.find((x) => x.id === e.seriesId) : undefined;
  if (!e || !s || !e.seriesDate) return { error: "That event doesn't repeat." };
  if (!Number.isInteger(days) || days === 0 || Math.abs(days) > 3660)
    return { error: "Pick another day to move to." };
  const slot = e.seriesDate;
  const idx0 = slotIndex(s.freq, s.startsOn, slot);
  if (idx0 < 0) return { error: "That event is not on its series' rule." };
  const anchor = addDaysTo(slot, days);
  const place = (d: string): string => {
    const i = slotIndex(s.freq, s.startsOn, d);
    return i < idx0 ? addDaysTo(d, days) : nthDate(s.freq, anchor, i - idx0);
  };
  const first = slot === s.startsOn;
  const endsOn = s.endsOn ? addDaysTo(s.endsOn, days) : undefined;
  const skipped = [...new Set(s.skipped.filter((d) => d >= slot).map(place))].sort();
  const target: EventSeries = first
    ? { ...s, startsOn: anchor, endsOn, skipped }
    : { ...s, id: newSeriesId, startsOn: anchor, endsOn, skipped };
  const series = first
    ? state.series.map((x) => (x.id === s.id ? target : x))
    : [
        ...state.series.map((x) => (x.id === s.id ? { ...x, endsOn: addDaysTo(slot, -1) } : x)),
        target,
      ];
  const movedIds: string[] = [];
  const events = state.events.map((x) => {
    if (x.seriesId !== s.id || x.seriesDate === undefined || x.seriesDate < slot) return x;
    movedIds.push(x.id);
    const date = addDaysTo(x.date, days);
    const seriesDate = place(x.seriesDate);
    const y: CrmEvent = { ...x, date, seriesId: target.id, seriesDate };
    if (x.endDate) y.endDate = addDaysTo(x.endDate, days);
    if (date !== seriesDate)
      y.seriesOverrides = [...new Set([...(x.seriesOverrides ?? []), "date"])].sort();
    return y;
  });
  return { state: { events, series }, movedIds };
}

/** What a move changed, as it was before: the way back. */
export interface MoveSnapshot {
  events: CrmEvent[];
  series: EventSeries[];
  /** Series the move made (the one it split off): gone once the move is undone. */
  dropSeries: string[];
}

/** The events and series that differ between two states, as they were in `before`. */
export function snapshotOf(before: SeriesState, after: SeriesState): MoveSnapshot {
  const was = (x: unknown) => JSON.stringify(x);
  const eventNow = new Map(after.events.map((e) => [e.id, was(e)]));
  const seriesNow = new Map(after.series.map((s) => [s.id, was(s)]));
  const known = new Set(before.series.map((s) => s.id));
  return {
    events: before.events.filter((e) => eventNow.has(e.id) && eventNow.get(e.id) !== was(e)),
    series: before.series.filter((s) => seriesNow.has(s.id) && seriesNow.get(s.id) !== was(s)),
    dropSeries: after.series.filter((s) => !known.has(s.id)).map((s) => s.id),
  };
}

/** Puts a snapshot back (the Undo). A series the move made goes once no event is left in it. */
export function restoreMove(state: SeriesState, snap: MoveSnapshot): SeriesState {
  const events = new Map(snap.events.map((e) => [e.id, e]));
  const series = new Map(snap.series.map((s) => [s.id, s]));
  const nextEvents = state.events.map((e) => events.get(e.id) ?? e);
  const used = new Set(nextEvents.map((e) => e.seriesId));
  const drop = new Set(snap.dropSeries.filter((id) => !used.has(id)));
  return {
    events: nextEvents,
    series: state.series.filter((s) => !drop.has(s.id)).map((s) => series.get(s.id) ?? s),
  };
}
