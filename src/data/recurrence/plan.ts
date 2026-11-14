/**
 * What happens to the events of a repeating series, as pure functions over `{ events, series }`: no
 * stores, no clock (today is passed in), no ids from a random source except the one the caller hands in.
 * The browser-storage demo applies these directly; with real accounts the database does the same
 * things in SQL (migration `20261020000100_recurring_events`), and both follow the same rules:
 *
 *  - Every occurrence is a real event with its own id; a series only holds the rule and what a new
 *    occurrence is made from. An occurrence is identified in its series by `seriesDate`, the date of
 *    its place in the rule, which never changes even when the event itself is moved.
 *  - A series is kept filled ahead (`slotsToFill`). Filling is idempotent and never makes two
 *    occurrences for one `seriesDate`. Occurrence ids are `<series id>-<seriesDate>`, so two copies of
 *    the app that fill at once make the very same event.
 *  - An occurrence deleted by itself keeps its date in `series.skipped`; it is never made again.
 *  - A field changed on one occurrence is remembered on it (`seriesOverrides`). A later "This and
 *    following" edit that starts at an EARLIER occurrence leaves that field on that occurrence as it
 *    is (it still changes the fields that occurrence did not set itself). An edit that starts at the
 *    occurrence itself does overwrite its own fields, because the person chose to change from there.
 *  - "This and following" changes the series from the chosen occurrence on and never touches an
 *    earlier occurrence. Changing the schedule (the date, Repeats or Ends) splits the series there:
 *    later occurrences that are untouched and have nothing hanging off them are dropped and made
 *    again by the new rule; later occurrences with attendance (or anything else hanging off them) or
 *    their own edits are never deleted: they stay in the series if their date still fits the new rule
 *    and are otherwise kept as single events.
 */
import type { CrmEvent, EventSeries } from "@/stores/eventsStore";
import {
  addDaysTo,
  daysBetween,
  isSlot,
  repeatFits,
  slotsToFill,
  type RepeatFreq,
  type SlotRule,
} from "./rule";

export interface SeriesState {
  events: CrmEvent[];
  series: EventSeries[];
}

/** A rule as the form states it: a frequency and, optionally, the last date. */
export interface Rule {
  freq: RepeatFreq;
  endsOn?: string;
}

/** The fields a single occurrence can have changed on its own, named like the database columns. */
export const SERIES_FIELDS = [
  "name",
  "category_id",
  "location",
  "notes",
  "format",
  "ticket_url",
  "date",
  "end_date",
] as const;
export type SeriesField = (typeof SERIES_FIELDS)[number];

/** The fields of a `CrmEvent` that an edit can carry, and the column each one is. */
export type EventPatch = Partial<
  Pick<
    CrmEvent,
    "name" | "categoryId" | "location" | "notes" | "format" | "ticketUrl" | "date" | "endDate"
  >
>;
const FIELD_OF: Record<keyof EventPatch, SeriesField> = {
  name: "name",
  categoryId: "category_id",
  location: "location",
  notes: "notes",
  format: "format",
  ticketUrl: "ticket_url",
  date: "date",
  endDate: "end_date",
};

export type PlanError = { error: string };
export const isPlanError = (x: unknown): x is PlanError =>
  typeof x === "object" && x !== null && "error" in x;

/** The id of the occurrence on a date of a series (the same wherever it is made). */
export const slotId = (seriesId: string, slot: string): string => `${seriesId}-${slot}`;

const norm = (v: unknown) => (v === "" || v === undefined || v === null ? null : v);
const same = (a: unknown, b: unknown) => norm(a) === norm(b);
const finished = (e: CrmEvent, today: string) => (e.endDate ?? e.date) < today;
const detach = (e: CrmEvent): CrmEvent => {
  const { seriesId: _s, seriesDate: _d, seriesOverrides: _o, ...rest } = e;
  return rest;
};
const lengthOf = (e: Pick<CrmEvent, "date" | "endDate">) =>
  e.endDate && e.endDate > e.date ? daysBetween(e.date, e.endDate) : 0;

/** The rule part of a series. */
const slotRule = (s: EventSeries): SlotRule => ({
  freq: s.freq,
  startsOn: s.startsOn,
  endsOn: s.endsOn,
  skipped: s.skipped,
});

/** A new occurrence of a series, made from its template. */
export function occurrenceOf(s: EventSeries, slot: string): CrmEvent {
  const e: CrmEvent = {
    id: slotId(s.id, slot),
    name: s.name,
    categoryId: s.categoryId,
    date: slot,
    format: s.format ?? "in_person",
    seriesId: s.id,
    seriesDate: slot,
  };
  if (s.lengthDays > 0) e.endDate = addDaysTo(slot, s.lengthDays);
  if (s.location) e.location = s.location;
  if (s.notes) e.notes = s.notes;
  if (s.ticketUrl) e.ticketUrl = s.ticketUrl;
  return e;
}

/**
 * Two occurrences for one place in a series can not both stay: keeps the first and drops the rest
 * (a second line of defence; filling never makes a second one). Returns the same array when there
 * is nothing to drop.
 */
export function dedupeOccurrences(events: CrmEvent[]): CrmEvent[] {
  const seen = new Set<string>();
  const out = events.filter((e) => {
    if (!e.seriesId || !e.seriesDate) return true;
    const key = `${e.seriesId}\u0001${e.seriesDate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return out.length === events.length ? events : out;
}

/**
 * Makes the occurrences every series is missing for `today` (see `slotsToFill`). Does nothing for a
 * series whose rule is up to date, however often it runs; returns the same object when nothing changed.
 */
export function fillSeries(state: SeriesState, today: string): SeriesState {
  const events = dedupeOccurrences(state.events);
  const have = new Set(
    events.filter((e) => e.seriesId).map((e) => `${e.seriesId}\u0001${e.seriesDate}`),
  );
  const added: CrmEvent[] = [];
  for (const s of state.series) {
    if (s.endsOn && s.endsOn < today) continue;
    for (const slot of slotsToFill(slotRule(s), today)) {
      const key = `${s.id}\u0001${slot}`;
      if (have.has(key)) continue;
      have.add(key);
      added.push(occurrenceOf(s, slot));
    }
  }
  if (!added.length && events === state.events) return state;
  return { ...state, events: [...events, ...added] };
}

/** Makes `eventId` the first occurrence of a new series (the event becomes its own first date). */
export function startSeries(
  state: SeriesState,
  eventId: string,
  rule: Rule,
  seriesId: string,
  today: string,
  createdBy?: string,
): SeriesState | PlanError {
  const e = state.events.find((x) => x.id === eventId);
  if (!e) return { error: "That event is gone." };
  if (e.seriesId) return { error: "That event already repeats." };
  if (!repeatFits(rule.freq, e.date, e.endDate))
    return { error: "A multi-day event can only repeat less often than it is long." };
  if (rule.endsOn && rule.endsOn < e.date)
    return { error: "The series can't end before it starts." };
  const series: EventSeries = {
    id: seriesId,
    freq: rule.freq,
    startsOn: e.date,
    endsOn: rule.endsOn,
    skipped: [],
    createdBy,
    name: e.name,
    categoryId: e.categoryId,
    location: e.location,
    notes: e.notes,
    format: e.format,
    ticketUrl: e.ticketUrl,
    lengthDays: lengthOf(e),
  };
  return fillSeries(
    {
      series: [...state.series, series],
      events: state.events.map((x) =>
        x.id === eventId ? { ...x, seriesId, seriesDate: e.date } : x,
      ),
    },
    today,
  );
}

/** What changing one occurrence on its own leaves on it: the fields it now sets itself. */
export function markOverrides(e: CrmEvent, patch: EventPatch): { seriesOverrides?: string[] } {
  if (!e.seriesId) return {};
  const fresh = (Object.keys(patch) as (keyof EventPatch)[])
    .filter((k) => k in FIELD_OF && !same(patch[k], e[k]))
    .map((k) => FIELD_OF[k]);
  if (!fresh.length) return {};
  return { seriesOverrides: [...new Set([...(e.seriesOverrides ?? []), ...fresh])].sort() };
}

/** The series with this occurrence's date added to its skipped dates (when it is one). */
export function tombstone(series: EventSeries[], gone: CrmEvent): EventSeries[] {
  if (!gone.seriesId || !gone.seriesDate) return series;
  return series.map((s) =>
    s.id === gone.seriesId && !s.skipped.includes(gone.seriesDate!)
      ? { ...s, skipped: [...s.skipped, gone.seriesDate!].sort() }
      : s,
  );
}

export interface Hooks {
  today: string;
  /** Whether anything hangs off the event: attendance, logistics, costs, follow-up notes, chat posts. */
  hasDependents: (eventId: string) => boolean;
  /** The id for a series that has to be split off. */
  newSeriesId: () => string;
}

export interface Outcome {
  state: SeriesState;
  /** Events the operation deleted (the caller removes whatever hangs off them). */
  removedIds: string[];
}

/** The series fields that follow the changed event fields. */
function templateWith(s: EventSeries, changed: Set<keyof EventPatch>, e: CrmEvent, len: number) {
  const t = { ...s, lengthDays: len };
  if (changed.has("name")) t.name = e.name;
  if (changed.has("categoryId")) t.categoryId = e.categoryId;
  if (changed.has("location")) t.location = e.location;
  if (changed.has("notes")) t.notes = e.notes;
  if (changed.has("format")) t.format = e.format;
  if (changed.has("ticketUrl")) t.ticketUrl = e.ticketUrl;
  return t;
}

/**
 * "This and following events": applies an edit made on `eventId` to that occurrence and the later ones
 * of its series, and plans the schedule again if the date, `repeat` or its end changed. `repeat` is
 * undefined when Repeats and Ends are as they were, "none" to stop repeating here.
 */
export function editFollowing(
  state: SeriesState,
  eventId: string,
  patch: EventPatch,
  repeat: Rule | "none" | undefined,
  hooks: Hooks,
): Outcome | PlanError {
  const e = state.events.find((x) => x.id === eventId);
  const s = e?.seriesId ? state.series.find((x) => x.id === e.seriesId) : undefined;
  if (!e || !s || !e.seriesDate) return { error: "That event doesn't repeat." };
  const slot = e.seriesDate;

  const keys = (Object.keys(patch) as (keyof EventPatch)[]).filter((k) => k in FIELD_OF);
  const edited: CrmEvent = { ...e };
  for (const k of keys) (edited as unknown as Record<string, unknown>)[k] = patch[k];
  const changed = new Set(keys.filter((k) => !same(patch[k], e[k])));
  const dateChanged = edited.date !== e.date;
  const oldLen = lengthOf(e);
  const newLen = lengthOf(edited);

  const current: Rule = { freq: s.freq, endsOn: s.endsOn };
  const next: Rule | "none" = repeat ?? current;
  const ruleChanged =
    next === "none" || next.freq !== current.freq || !same(next.endsOn, current.endsOn);
  if (next !== "none") {
    if (!repeatFits(next.freq, edited.date, edited.endDate))
      return { error: "A multi-day event can only repeat less often than it is long." };
    if (next.endsOn && next.endsOn < edited.date)
      return { error: "The series can't end before it starts." };
  }

  const ownFields = new Set<string>([...changed].map((k) => FIELD_OF[k]));
  const stripOwn = (o: string[] | undefined) => {
    const left = (o ?? []).filter((f) => !ownFields.has(f));
    return left.length ? left : undefined;
  };

  // The occurrence itself, and the fields that move on to the later ones that haven't set them.
  const later = state.events.filter(
    (x) => x.seriesId === s.id && x.seriesDate !== undefined && x.seriesDate > slot,
  );
  const spread = (x: CrmEvent): CrmEvent => {
    const o = x.seriesOverrides ?? [];
    const y = { ...x };
    for (const k of changed) {
      const f = FIELD_OF[k];
      if (f === "date" || f === "end_date" || o.includes(f)) continue;
      (y as unknown as Record<string, unknown>)[k] = edited[k];
    }
    if (newLen !== oldLen && !o.includes("end_date")) {
      if (newLen > 0) y.endDate = addDaysTo(y.date, newLen);
      else delete y.endDate;
    }
    return y;
  };
  const template = templateWith(s, changed, edited, newLen);

  if (!dateChanged && !ruleChanged) {
    const laterIds = new Set(later.map((x) => x.id));
    return {
      removedIds: [],
      state: {
        series: state.series.map((x) => (x.id === s.id ? template : x)),
        events: state.events.map((x) =>
          x.id === e.id
            ? { ...edited, seriesOverrides: stripOwn(e.seriesOverrides) }
            : laterIds.has(x.id)
              ? spread(x)
              : x,
        ),
      },
    };
  }

  // Schedule changed: the series is planned again from this occurrence, on its (new) date.
  const anchor = edited.date;
  const firstOfSeries = slot === s.startsOn;
  const stopped = next === "none";
  let target: EventSeries | null = null;
  let series = state.series;
  if (!stopped) {
    const rule = next as Rule;
    if (firstOfSeries) {
      target = { ...template, freq: rule.freq, startsOn: anchor, endsOn: rule.endsOn };
      series = series.map((x) => (x.id === s.id ? target! : x));
    } else {
      target = {
        ...template,
        id: hooks.newSeriesId(),
        freq: rule.freq,
        startsOn: anchor,
        endsOn: rule.endsOn,
        skipped: s.skipped.filter((d) => d >= slot),
      };
      series = [
        ...series.map((x) => (x.id === s.id ? { ...template, endsOn: addDaysTo(slot, -1) } : x)),
        target,
      ];
    }
  } else {
    series = series.map((x) => (x.id === s.id ? { ...template, endsOn: addDaysTo(slot, -1) } : x));
  }

  const removedIds: string[] = [];
  const replaced = new Map<string, CrmEvent | null>();
  // The occurrence itself first, so a later one never takes its place.
  const taken = new Set<string>();
  if (target) taken.add(anchor);
  replaced.set(
    e.id,
    target
      ? {
          ...edited,
          seriesId: target.id,
          seriesDate: anchor,
          seriesOverrides: stripOwn(e.seriesOverrides),
        }
      : detach(edited),
  );
  const ordered = [...later].sort(
    (a, b) => a.date.localeCompare(b.date) || a.seriesDate!.localeCompare(b.seriesDate!),
  );
  for (const x of ordered) {
    const y = spread(x);
    const fits =
      !!target &&
      !taken.has(y.date) &&
      isSlot(target.freq, target.startsOn, y.date) &&
      (!target.endsOn || y.date <= target.endsOn);
    if (fits) {
      taken.add(y.date);
      replaced.set(x.id, { ...y, seriesId: target!.id, seriesDate: y.date });
    } else if (
      !(x.seriesOverrides?.length ?? 0) &&
      !hooks.hasDependents(x.id) &&
      !finished(y, hooks.today)
    ) {
      replaced.set(x.id, null);
      removedIds.push(x.id);
    } else {
      replaced.set(x.id, detach(y));
    }
  }
  const events = state.events.flatMap((x) => {
    if (!replaced.has(x.id)) return [x];
    const r = replaced.get(x.id);
    return r ? [r] : [];
  });
  return { removedIds, state: fillSeries({ series, events }, hooks.today) };
}

/**
 * Deletes one occurrence by itself: the event goes, its date is kept on the series so it is not made
 * again. (What hangs off the event is removed by the caller, as for any deleted event.)
 */
export function removeOne(state: SeriesState, eventId: string): SeriesState {
  const e = state.events.find((x) => x.id === eventId);
  if (!e) return state;
  return {
    events: state.events.filter((x) => x.id !== eventId),
    series: tombstone(state.series, e),
  };
}

/**
 * "This and following events" on delete: this occurrence and every later one go and the series stops
 * just before this date. Later occurrences that are already over are history and stay as single
 * events; earlier ones are never touched.
 */
export function removeFollowing(
  state: SeriesState,
  eventId: string,
  hooks: Pick<Hooks, "today">,
): Outcome | PlanError {
  const e = state.events.find((x) => x.id === eventId);
  const s = e?.seriesId ? state.series.find((x) => x.id === e.seriesId) : undefined;
  if (!e || !s || !e.seriesDate) return { error: "That event doesn't repeat." };
  const slot = e.seriesDate;
  const removedIds: string[] = [];
  const events = state.events.flatMap((x) => {
    if (x.seriesId !== s.id || x.seriesDate === undefined || x.seriesDate < slot) return [x];
    if (x.id === e.id || !finished(x, hooks.today)) {
      removedIds.push(x.id);
      return [];
    }
    return [detach(x)];
  });
  const stop = addDaysTo(slot, -1);
  return {
    removedIds,
    state: {
      events,
      series: state.series.map((x) =>
        x.id === s.id ? { ...x, endsOn: x.endsOn && x.endsOn < stop ? x.endsOn : stop } : x,
      ),
    },
  };
}

/** How many occurrences a series has on each of its dates (a test and a debugging aid: all 1). */
export function occurrencesPerDate(state: SeriesState, seriesId: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of state.events)
    if (e.seriesId === seriesId && e.seriesDate)
      m.set(e.seriesDate, (m.get(e.seriesDate) ?? 0) + 1);
  return m;
}

/** Whether a series needs filling for `today` (the cheap check before asking the database). */
export function needsFill(state: SeriesState, today: string): boolean {
  return fillSeries(state, today) !== state;
}
