/**
 * The writes and hooks of repeating events, the same for both data sources:
 *
 *  - browser-storage demo: the pure rules in ./plan.ts are applied to the events store directly;
 *  - real accounts: the database does it in one step (functions in the migration
 *    `20261020000100_recurring_events`), and the rows it hands back are shown at once.
 *
 * `removeEvent()` / `updateEvent()` in ../events.ts are "This event": they change one occurrence, and
 * the store (and in the database a trigger) remember that it was deleted or edited on its own.
 */
import { useMemo } from "react";
import { IS_SUPABASE } from "@/lib/config";
import { localDate } from "@/lib/dates";
import { storageKey } from "@/lib/brand";
import { getSupabase } from "@/lib/supabase";
import { useEventsStore, type CrmEvent, type EventSeries } from "@/stores/eventsStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import { useOpsStore } from "@/stores/opsStore";
import { useChatStore } from "@/data/chat/store";
import { useLibraryStore } from "@/data/library/store";
import { serverSide, whenIdle } from "../remote/engine";
import { saveFailed } from "../remote/feedback";
import { eventFromRow, seriesFromRow, type Row } from "../remote/rows";
import {
  editFollowing,
  fillSeries,
  isPlanError,
  needsFill,
  removeFollowing,
  startSeries,
  type EventPatch,
  type Rule,
  type SeriesState,
} from "./plan";

export type SeriesResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): SeriesResult => ({ ok: false, error });

/** What a form states about repeating: nothing changed (undefined), stop here ("none"), or a rule. */
export type RepeatChoice = Rule | "none" | undefined;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The rule behind a repeating event, or undefined for one that doesn't repeat. */
export function useEventSeries(
  event: Pick<CrmEvent, "seriesId"> | undefined,
): EventSeries | undefined {
  const series = useEventsStore((s) => s.series);
  return useMemo(
    () => (event?.seriesId ? series.find((x) => x.id === event.seriesId) : undefined),
    [series, event?.seriesId],
  );
}

/** The team's series (a new list arrives whenever events are loaded or changed). */
export function useEventSeriesList(): EventSeries[] {
  return useEventsStore((s) => s.series);
}

// ---------------------------------------------------------------------------
// Browser-storage path
// ---------------------------------------------------------------------------

const stateOf = (): SeriesState => {
  const s = useEventsStore.getState();
  return { events: s.events, series: s.series };
};
const commit = (next: SeriesState) =>
  useEventsStore.setState({ events: next.events, series: next.series });

/** Whether anything hangs off an event that must not be thrown away with a plain re-plan. */
function hasDependentsLocal(id: string): boolean {
  if (useAttendanceStore.getState().attendances.some((a) => a.eventId === id)) return true;
  if (useAttendanceStore.getState().missedNotes.some((n) => n.eventId === id)) return true;
  const ops = useOpsStore.getState();
  if (Object.keys(ops.logistics).some((k) => k.startsWith(`${id}:`))) return true;
  if (ops.costs.some((c) => c.eventId === id)) return true;
  if (useLibraryStore.getState().items.some((i) => i.eventId === id)) return true;
  return useChatStore
    .getState()
    .messages.some((m) => m.card?.type === "event" && m.card.eventId === id && !m.deletedAt);
}

/** What deleting an event takes with it in the demo (the database cascades by itself). */
function cascadeRemoved(ids: string[]) {
  if (!ids.length) return;
  const gone = new Set(ids);
  useAttendanceStore.getState().removeWhere((a) => gone.has(a.eventId));
  for (const id of ids) useOpsStore.getState().removeEvent(id);
}

// ---------------------------------------------------------------------------
// Database path
// ---------------------------------------------------------------------------

interface RpcResult {
  events?: Row[];
  deleted?: string[];
  series?: Row[];
}

/** Shows what a series function changed (without sending it back to the database). */
function applyResult(r: RpcResult) {
  const upserts = (r.events ?? []).map((row) => eventFromRow(row as never));
  const gone = new Set(r.deleted ?? []);
  const series = (r.series ?? []).map((row) => seriesFromRow(row as never));
  serverSide(() =>
    useEventsStore.setState((s) => {
      const byId = new Map(upserts.map((e) => [e.id, e]));
      const events = s.events.filter((e) => !gone.has(e.id)).map((e) => byId.get(e.id) ?? e);
      const known = new Set(events.map((e) => e.id));
      for (const e of upserts) if (!known.has(e.id) && !gone.has(e.id)) events.push(e);
      const sById = new Map(series.map((x) => [x.id, x]));
      const merged = s.series.map((x) => sById.get(x.id) ?? x);
      for (const x of series) if (!s.series.some((y) => y.id === x.id)) merged.push(x);
      return { events, series: merged };
    }),
  );
}

async function call(fn: string, args: Record<string, unknown>): Promise<SeriesResult> {
  try {
    // Writes still on their way (the event this is about, made a moment ago) go first.
    await whenIdle();
    const { data, error } = await getSupabase().rpc(fn as never, args as never);
    if (error) return fail(error.message);
    applyResult((data ?? {}) as RpcResult);
    return { ok: true };
  } catch (e) {
    saveFailed(e);
    return fail("Couldn't save. Check your connection and try again.");
  }
}

const COLUMN: Record<keyof EventPatch, string> = {
  name: "name",
  categoryId: "category_id",
  location: "location",
  notes: "notes",
  format: "format",
  ticketUrl: "ticket_url",
  date: "date",
  endDate: "end_date",
};
const patchJson = (patch: EventPatch) =>
  Object.fromEntries(
    (Object.keys(patch) as (keyof EventPatch)[]).map((k) => [COLUMN[k], patch[k] ?? null]),
  );
const repeatJson = (r: RepeatChoice) =>
  r === undefined
    ? null
    : r === "none"
      ? { freq: "none" }
      : { freq: r.freq, ends_on: r.endsOn ?? null };

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Makes an existing event repeat: it becomes the first occurrence and the next ones are made. */
export async function makeEventRepeat(eventId: string, rule: Rule): Promise<SeriesResult> {
  if (IS_SUPABASE)
    return call("make_event_repeat", {
      p_event_id: eventId,
      p_freq: rule.freq,
      p_ends_on: rule.endsOn ?? null,
    });
  const next = startSeries(stateOf(), eventId, rule, crypto.randomUUID(), localDate());
  if (isPlanError(next)) return fail(next.error);
  commit(next);
  return { ok: true };
}

/**
 * "This and following events" on save: applies the changes to this occurrence and the later ones
 * and, if the date, Repeats or Ends changed, plans the later occurrences again.
 */
export async function saveEventFollowing(
  eventId: string,
  patch: EventPatch,
  repeat: RepeatChoice,
): Promise<SeriesResult> {
  if (IS_SUPABASE)
    return call("update_event_series_following", {
      p_event_id: eventId,
      p_patch: patchJson(patch),
      p_repeat: repeatJson(repeat),
    });
  const out = editFollowing(stateOf(), eventId, patch, repeat, {
    today: localDate(),
    hasDependents: hasDependentsLocal,
    newSeriesId: () => crypto.randomUUID(),
  });
  if (isPlanError(out)) return fail(out.error);
  commit(out.state);
  cascadeRemoved(out.removedIds);
  return { ok: true };
}

/** "This and following events" on delete: this occurrence and every later one, and the series stops. */
export async function removeEventFollowing(eventId: string): Promise<SeriesResult> {
  if (IS_SUPABASE) return call("delete_event_following", { p_event_id: eventId });
  const out = removeFollowing(stateOf(), eventId, { today: localDate() });
  if (isPlanError(out)) return fail(out.error);
  commit(out.state);
  cascadeRemoved(out.removedIds);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Keeping series filled
// ---------------------------------------------------------------------------

let filling: Promise<void> | null = null;

/**
 * Makes the occurrences a series is missing for today. Safe to call as often as you like, from as many
 * tabs as you like: filling never makes a second occurrence for a date (same ids in the demo, a unique
 * index and a lock in the database), and a call while another is running shares it.
 */
export function topUpSeries(): Promise<void> {
  if (filling) return filling;
  const run = IS_SUPABASE ? topUpRemote() : topUpLocal();
  filling = run.finally(() => {
    filling = null;
  });
  return filling;
}

async function topUpLocal(): Promise<void> {
  const fill = async () => {
    // Another tab may have filled meanwhile: start from what is saved, not from this tab's copy.
    await useEventsStore.persist.rehydrate();
    const now = stateOf();
    const next = fillSeries(now, localDate());
    if (next !== now) commit(next);
  };
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks) await locks.request(storageKey("series-topup"), fill);
  else await fill();
}

async function topUpRemote(): Promise<void> {
  // Nothing missing as far as this screen can tell: no need to ask.
  if (!needsFill(stateOf(), localDate())) return;
  await call("topup_event_series", {});
}
