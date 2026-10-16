/**
 * Event categories: hooks and writes (rules in ./rules). Same in both data
 * modes: with real accounts the store change is synced (`event_categories`),
 * and a merge goes through `merge_event_categories()`.
 */
import { useMemo } from "react";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { useEventsStore, type CrmEvent } from "@/stores/eventsStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useTeamStore } from "../team/store";
import { deputyOfIds } from "../team/rules";
import { useUnlocks } from "../team/hooks";
import { canManageEvents } from "../eventTypes/info";
import { saveFailed, scheduleRefresh, serverSide, whenIdle } from "../remote";
import { useEventCategoriesStore } from "./store";
import {
  activeCategories,
  canCreateCategories,
  canEditCategories,
  categoryLookup,
  categoryNameError,
  cleanCategoryName,
  eventCounts,
  mergeError,
  mergeEvents,
  nextPosition,
  reorderPatches,
  sortCategories,
  DEFAULT_FLAGS,
  type CategoryLookup,
} from "./rules";
import type { CategoryFlags, CategoryIcon, CategoryTone, EventCategory } from "./types";

// ---- Reads ----

/** Every category, archived ones too, in display order (for old events and Team settings). */
export function useAllEventCategories(): EventCategory[] {
  const list = useEventCategoriesStore((s) => s.categories);
  return useMemo(() => sortCategories(list), [list]);
}

/** The categories offered for new events and the Events filter: not archived, in order. */
export function useEventCategories(): EventCategory[] {
  const list = useEventCategoriesStore((s) => s.categories);
  return useMemo(() => activeCategories(list), [list]);
}

/** A lookup from an event (or category id) to its category; re-renders when categories change. */
export function useCategoryOf(): CategoryLookup {
  const list = useEventCategoriesStore((s) => s.categories);
  return useMemo(() => categoryLookup(list), [list]);
}

/** One event's category (`UNKNOWN_CATEGORY` while missing). */
export function useEventCategory(e: Pick<CrmEvent, "categoryId"> | string | undefined) {
  return useCategoryOf()(e);
}

/** Non-reactive: every category (for route loaders and writes). */
export function getEventCategories(): EventCategory[] {
  return sortCategories(useEventCategoriesStore.getState().categories);
}

/** Non-reactive: an event's category. */
export function eventCategory(e: Pick<CrmEvent, "categoryId"> | string | undefined): EventCategory {
  return categoryLookup(useEventCategoriesStore.getState().categories)(e);
}

/** How many events use each category id. */
export function useCategoryEventCounts(): Map<string, number> {
  const events = useEventsStore((s) => s.events);
  return useMemo(() => eventCounts(events), [events]);
}

/** May the viewer add a category (from the event form)? Anyone who may plan events. */
export function useCanCreateCategories(): boolean {
  const role = useSessionStore((s) => s.user?.role);
  const eventPlanning = useUnlocks().can.eventPlanning;
  return !!role && canCreateCategories(canManageEvents({ role, eventPlanning }));
}

/** May the viewer rename, change, reorder, archive and merge categories? Leaders and deputies. */
export function useCanEditCategories(): boolean {
  const user = useSessionStore((s) => s.user);
  const deputies = useTeamStore((s) => s.deputies);
  return !!user && canEditCategories(user.role, deputyOfIds(deputies, user.personId));
}

// ---- Writes ----

const store = () => useEventCategoriesStore.getState();
const setCategories = (fn: (list: EventCategory[]) => EventCategory[]) =>
  useEventCategoriesStore.setState((s) => ({ categories: fn(s.categories) }));

export interface NewCategoryInput extends Partial<CategoryFlags> {
  name: string;
  icon: CategoryIcon;
  tone?: CategoryTone;
}

export type CategoryResult = { ok: true; category: EventCategory } | { ok: false; error: string };

/** Add a category at the end of the list. Checks the name (unique among active ones). */
export function addEventCategory(input: NewCategoryInput): CategoryResult {
  const list = store().categories;
  const error = categoryNameError(input.name, list);
  if (error) return { ok: false, error };
  const { name, icon, tone, ...flags } = input;
  const category: EventCategory = {
    ...DEFAULT_FLAGS,
    ...flags,
    id: crypto.randomUUID(),
    name: cleanCategoryName(name),
    icon,
    tone: tone ?? "neutral",
    position: nextPosition(list),
    createdBy: useSessionStore.getState().user?.personId,
    createdAt: new Date().toISOString(),
  };
  setCategories((l) => [...l, category]);
  return { ok: true, category };
}

export type CategoryPatch = Partial<Pick<EventCategory, "name" | "icon" | "tone"> & CategoryFlags>;

/** Rename or change a category's icon, color or settings. Returns an error message or null. */
export function updateEventCategory(id: string, patch: CategoryPatch): string | null {
  const list = store().categories;
  const current = list.find((c) => c.id === id);
  if (!current) return "That category is gone.";
  const next = { ...patch };
  if (patch.name !== undefined) {
    const error = categoryNameError(patch.name, list, id);
    if (error) return error;
    next.name = cleanCategoryName(patch.name);
  }
  setCategories((l) => l.map((c) => (c.id === id ? { ...c, ...next } : c)));
  return null;
}

/** Put the active categories in this order (top first). */
export function reorderEventCategories(orderedIds: readonly string[]): void {
  const patches = new Map(
    reorderPatches(store().categories, orderedIds).map((p) => [p.id, p.position]),
  );
  if (!patches.size) return;
  setCategories((l) =>
    l.map((c) => (patches.has(c.id) ? { ...c, position: patches.get(c.id)! } : c)),
  );
}

/** Archive a category: old events keep it, new events can't pick it. Returns an undo. */
export function archiveEventCategory(id: string): () => void {
  const before = store().categories.find((c) => c.id === id)?.archivedAt;
  const at = new Date().toISOString();
  setCategories((l) => l.map((c) => (c.id === id ? { ...c, archivedAt: at } : c)));
  return () => setCategories((l) => l.map((c) => (c.id === id ? { ...c, archivedAt: before } : c)));
}

/** Bring an archived category back (at the end of the list). Returns an error message or null. */
export function restoreEventCategory(id: string): string | null {
  const list = store().categories;
  const c = list.find((x) => x.id === id);
  if (!c) return "That category is gone.";
  const error = categoryNameError(c.name, list, id);
  if (error) return `${error} Rename that one first.`;
  const position = nextPosition(list.filter((x) => !x.archivedAt));
  setCategories((l) => l.map((x) => (x.id === id ? { ...x, archivedAt: undefined, position } : x)));
  return null;
}

export type MergeResult = { ok: true; moved: number } | { ok: false; error: string };

/**
 * Merge `fromId` into `intoId`: every event of the first moves to the second
 * (a format the second doesn't allow becomes in person), then the first is
 * archived. One step in the database (`merge_event_categories`).
 */
export function mergeEventCategories(fromId: string, intoId: string): MergeResult {
  const list = store().categories;
  const error = mergeError(fromId, intoId, list);
  if (error) return { ok: false, error };
  const into = list.find((c) => c.id === intoId)!;
  const eventsBefore = useEventsStore.getState().events;
  const categoriesBefore = list;
  const { events, moved } = mergeEvents(eventsBefore, fromId, into);
  const at = new Date().toISOString();
  const show = () => {
    useEventsStore.setState({ events });
    setCategories((l) =>
      l.map((c) => (c.id === fromId ? { ...c, archivedAt: c.archivedAt ?? at } : c)),
    );
  };
  if (!IS_SUPABASE) {
    show();
    return { ok: true, moved: moved.length };
  }
  // Shown at once; the database does the same in one step, or it's put back.
  serverSide(show);
  void whenIdle()
    .then(() =>
      getSupabase().rpc("merge_event_categories", { p_from_id: fromId, p_into_id: intoId }),
    )
    .then(({ error: e }) => {
      if (e) throw new Error(e.message);
      // Picks up anything the database adjusted (and events added meanwhile).
      scheduleRefresh(["crm"]);
    })
    .catch((e) => {
      serverSide(() => {
        const movedSet = new Set(moved);
        const old = new Map(eventsBefore.map((x) => [x.id, x]));
        useEventsStore.setState((s) => ({
          events: s.events.map((x) => (movedSet.has(x.id) ? (old.get(x.id) ?? x) : x)),
        }));
        const prev = categoriesBefore.find((c) => c.id === fromId);
        setCategories((l) => l.map((c) => (c.id === fromId && prev ? prev : c)));
      });
      saveFailed(e);
    });
  return { ok: true, moved: moved.length };
}
