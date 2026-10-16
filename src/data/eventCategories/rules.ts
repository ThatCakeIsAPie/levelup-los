/**
 * Event categories: the pure rules (docs/plans/mvp-plan-2026-10-13.md
 * "Events"; tested in rules.test.ts).
 *
 * Every team starts with the six categories below (the old fixed event
 * types) and then adds, renames, reorders, archives and merges its own. What
 * an event page looks like follows its category's settings:
 *
 *   | Starting category    | Online | Tickets | Travel | Customers welcome |
 *   | Night Owls           |        |         |        |                   |
 *   | Work session         |        |         |        |                   |
 *   | Info session         | ✓      |         |        | ✓                 |
 *   | Training             | ✓      |         |        | ✓                 |
 *   | Monthly team meeting | ✓      | ✓       |        | ✓                 |
 *   | Conference           | ✓      | ✓       | ✓      |                   |
 *
 * All six remind uplines about misses. Tickets and travel decide how heavy the
 * event page is: travel keeps the whole ticket / travel / shared-cost /
 * qualification toolkit, tickets keep the ticket board, and the rest get a
 * light roster (who's coming, who came, in person or online).
 *
 * The database seeds the same six for every workspace with the same ids
 * (`<workspace>-<key>`; migration 20261016002000_event_categories), so the
 * demo, the database seed and old links agree.
 */
import type { CrmEvent, EventFormat } from "@/stores/eventsStore";
import type { AttendMode } from "@/stores/attendanceStore";
import type { Role } from "@/stores/sessionStore";
import { WORKSPACE_ID } from "@/data/chat/types";
import type { CategoryFlags, CategoryIcon, CategoryTone, EventCategory } from "./types";

/** The old fixed type codes, kept only to convert old data and old links. */
export const STARTER_KEYS = [
  "night_owls",
  "work_session",
  "info_session",
  "training",
  "monthly_meeting",
  "conference",
] as const;
export type StarterKey = (typeof STARTER_KEYS)[number];

export interface StarterCategory extends CategoryFlags {
  key: StarterKey;
  name: string;
  icon: CategoryIcon;
  tone: CategoryTone;
}

/** The six every team starts with, in display order (same as the migration). */
export const STARTING_CATEGORIES: readonly StarterCategory[] = [
  {
    key: "night_owls",
    name: "Night Owls",
    icon: "moon",
    tone: "neutral",
    allowsVirtual: false,
    usesTickets: false,
    usesTravel: false,
    countsForMissed: true,
    welcomesCustomers: false,
  },
  {
    key: "work_session",
    name: "Work session",
    icon: "briefcase",
    tone: "neutral",
    allowsVirtual: false,
    usesTickets: false,
    usesTravel: false,
    countsForMissed: true,
    welcomesCustomers: false,
  },
  {
    key: "info_session",
    name: "Info session",
    icon: "lightbulb",
    tone: "neutral",
    allowsVirtual: true,
    usesTickets: false,
    usesTravel: false,
    countsForMissed: true,
    welcomesCustomers: true,
  },
  {
    key: "training",
    name: "Training",
    icon: "graduation",
    tone: "neutral",
    allowsVirtual: true,
    usesTickets: false,
    usesTravel: false,
    countsForMissed: true,
    welcomesCustomers: true,
  },
  {
    key: "monthly_meeting",
    name: "Monthly team meeting",
    icon: "users",
    tone: "neutral",
    allowsVirtual: true,
    usesTickets: true,
    usesTravel: false,
    countsForMissed: true,
    welcomesCustomers: true,
  },
  {
    key: "conference",
    name: "Conference",
    icon: "ticket",
    tone: "neutral",
    allowsVirtual: true,
    usesTickets: true,
    usesTravel: true,
    countsForMissed: true,
    welcomesCustomers: false,
  },
];

/** A starting category's id in a workspace (the demo's workspace by default). */
export const starterCategoryId = (key: StarterKey, workspaceId: string = WORKSPACE_ID) =>
  `${workspaceId}-${key}`;

/** The six starting categories for a workspace. */
export function startingCategories(
  workspaceId: string = WORKSPACE_ID,
  createdAt = "2026-01-01T00:00:00.000Z",
): EventCategory[] {
  return STARTING_CATEGORIES.map(({ key, ...c }, position) => ({
    ...c,
    id: starterCategoryId(key, workspaceId),
    position,
    createdAt,
  }));
}

/** An old type code (`team_meeting` became the monthly meeting) as a starter key. */
export function legacyStarterKey(type: unknown): StarterKey | undefined {
  if (type === "team_meeting") return "monthly_meeting";
  return typeof type === "string" && (STARTER_KEYS as readonly string[]).includes(type)
    ? (type as StarterKey)
    : undefined;
}

/**
 * A saved event from before categories (`type` instead of `categoryId`) in
 * the new shape. Unknown types become the monthly meeting (the old default).
 */
export function convertLegacyEvent(
  e: CrmEvent | (Omit<CrmEvent, "categoryId"> & { categoryId?: string; type?: unknown }),
  workspaceId: string = WORKSPACE_ID,
): CrmEvent {
  const { type, ...rest } = e as CrmEvent & { type?: unknown };
  if (rest.categoryId) return rest;
  const key = legacyStarterKey(type) ?? "monthly_meeting";
  return { ...rest, categoryId: starterCategoryId(key, workspaceId) };
}

export function convertLegacyEvents(list: unknown, workspaceId?: string): CrmEvent[] {
  return Array.isArray(list) ? list.map((e) => convertLegacyEvent(e as CrmEvent, workspaceId)) : [];
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/**
 * Stands in for a category that isn't loaded (or was never shared with the
 * viewer): a plain event, joinable however it was set up, no tickets.
 */
export const UNKNOWN_CATEGORY: EventCategory = {
  id: "",
  name: "Event",
  icon: "calendar",
  tone: "neutral",
  allowsVirtual: true,
  usesTickets: false,
  usesTravel: false,
  countsForMissed: true,
  welcomesCustomers: false,
  position: 0,
  createdAt: "",
};

const byPosition = (a: EventCategory, b: EventCategory) =>
  a.position - b.position || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** Every category in display order (archived ones included). */
export function sortCategories(list: readonly EventCategory[]): EventCategory[] {
  return [...list].sort(byPosition);
}

/** The categories offered for new events: not archived, in display order. */
export function activeCategories(list: readonly EventCategory[]): EventCategory[] {
  return sortCategories(list.filter((c) => !c.archivedAt));
}

export type CategoryLookup = (
  e: Pick<CrmEvent, "categoryId"> | string | undefined,
) => EventCategory;

/** A lookup from an event (or a category id) to its category, `UNKNOWN_CATEGORY` if missing. */
export function categoryLookup(list: readonly EventCategory[]): CategoryLookup {
  const index = new Map(list.map((c) => [c.id, c]));
  return (e) => {
    const id = typeof e === "string" ? e : e?.categoryId;
    return (id && index.get(id)) || UNKNOWN_CATEGORY;
  };
}

/**
 * The categories to offer in the event form: the active ones, plus the
 * event's own category when it has been archived since (so editing an old
 * event doesn't change its category).
 */
export function categoryChoices(
  list: readonly EventCategory[],
  currentId?: string,
): EventCategory[] {
  const active = activeCategories(list);
  const current = currentId ? list.find((c) => c.id === currentId) : undefined;
  return current?.archivedAt ? [...active, current] : active;
}

/**
 * The category an old `?type=` link means: the starting category with that
 * key (by id, in any workspace), else an active category with its starting
 * name. Undefined when there's no match.
 */
export function categoryForLegacyType(
  type: unknown,
  list: readonly EventCategory[],
): EventCategory | undefined {
  const key = legacyStarterKey(type);
  if (!key) return undefined;
  const byId = list.find((c) => c.id.endsWith(`-${key}`));
  if (byId) return byId;
  const name = STARTING_CATEGORIES.find((s) => s.key === key)!.name.toLowerCase();
  return activeCategories(list).find((c) => c.name.trim().toLowerCase() === name);
}

// ---------------------------------------------------------------------------
// What the settings mean
// ---------------------------------------------------------------------------

type Flag<K extends keyof CategoryFlags> = Pick<EventCategory, K> | undefined;

export const allowsVirtual = (c: Flag<"allowsVirtual">) => !!c?.allowsVirtual;
export const usesTickets = (c: Flag<"usesTickets">) => !!c?.usesTickets;
export const usesTravel = (c: Flag<"usesTravel">) => !!c?.usesTravel;
export const welcomesCustomers = (c: Flag<"welcomesCustomers">) => !!c?.welcomesCustomers;
/** Unknown categories count (the safe default: an upline hears about a miss). */
export const countsForMissed = (c: Flag<"countsForMissed">) => c?.countsForMissed ?? true;

/**
 * The event's format, made valid for its category: in person unless set, and
 * never virtual for a category that is in person only.
 */
export function eventFormat(
  e: Pick<CrmEvent, "format">,
  category: Flag<"allowsVirtual">,
): EventFormat {
  const f = e.format ?? "in_person";
  return allowsVirtual(category) ? f : "in_person";
}

/** The ways an event can be attended, in person first. */
export function eventModes(
  e: Pick<CrmEvent, "format">,
  category: Flag<"allowsVirtual">,
): AttendMode[] {
  const f = eventFormat(e, category);
  return f === "both" ? ["in_person", "virtual"] : [f];
}

/** One plain line about a category's settings, for pickers: "Online too · Tickets". */
export function categorySummary(c: CategoryFlags): string {
  const parts = [
    c.allowsVirtual ? "In person or online" : "In person",
    c.usesTickets && "Tickets",
    c.usesTravel && "Travel",
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * The yes/no questions, in plain words, in order. `quick` ones are asked when
 * a category is added from the event form; Team settings shows them all.
 */
export const CATEGORY_QUESTIONS: readonly {
  flag: keyof CategoryFlags;
  question: string;
  hint: string;
  quick: boolean;
}[] = [
  {
    flag: "allowsVirtual",
    question: "Can people join online?",
    hint: "Lets you set each event to in person, online or both.",
    quick: true,
  },
  {
    flag: "usesTickets",
    question: "Do people buy tickets?",
    hint: "Adds ticket tracking, buy-by dates and ticket reminders.",
    quick: true,
  },
  {
    flag: "usesTravel",
    question: "Is there travel?",
    hint: "Adds travel plans, shared costs and qualifications.",
    quick: true,
  },
  {
    flag: "countsForMissed",
    question: "Remind uplines when someone misses one?",
    hint: "If someone came last time and misses the next one, their uplines get a follow-up.",
    quick: true,
  },
  {
    flag: "welcomesCustomers",
    question: "Are customers welcome?",
    hint: "Home suggests inviting your customers to the next ones.",
    quick: false,
  },
];

/** Settings for a brand-new category: in person, no tickets, misses remind uplines. */
export const DEFAULT_FLAGS: CategoryFlags = {
  allowsVirtual: false,
  usesTickets: false,
  usesTravel: false,
  countsForMissed: true,
  welcomesCustomers: false,
};

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export const MAX_CATEGORY_NAME = 40;

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** What's wrong with a category name (null when fine). Names are unique among active categories. */
export function categoryNameError(
  name: string,
  list: readonly EventCategory[],
  exceptId?: string,
): string | null {
  const clean = name.trim();
  if (!clean) return "Give the category a name.";
  if (clean.length > MAX_CATEGORY_NAME) return `Keep it under ${MAX_CATEGORY_NAME + 1} characters.`;
  const taken = list.find(
    (c) => !c.archivedAt && c.id !== exceptId && norm(c.name) === norm(clean),
  );
  return taken ? `There's already a category called ${taken.name}.` : null;
}

/** A tidy name: trimmed, single spaces. */
export const cleanCategoryName = (name: string) => name.trim().replace(/\s+/g, " ");

/** The position for a new category: after every other one. */
export const nextPosition = (list: readonly EventCategory[]) =>
  list.reduce((max, c) => Math.max(max, c.position + 1), 0);

/**
 * New positions after a reorder of the active categories (`orderedIds`, top
 * first). Archived ones keep theirs. Only the changed ones are returned.
 */
export function reorderPatches(
  list: readonly EventCategory[],
  orderedIds: readonly string[],
): { id: string; position: number }[] {
  const out: { id: string; position: number }[] = [];
  orderedIds.forEach((id, position) => {
    const c = list.find((x) => x.id === id);
    if (c && c.position !== position) out.push({ id, position });
  });
  return out;
}

/** Why a merge can't happen (null when it can). */
export function mergeError(
  fromId: string,
  intoId: string,
  list: readonly EventCategory[],
): string | null {
  const from = list.find((c) => c.id === fromId);
  const into = list.find((c) => c.id === intoId);
  if (!from || !into) return "Pick a category to merge into.";
  if (from.id === into.id) return "Pick a different category.";
  if (into.archivedAt) return `${into.name} is archived. Bring it back first.`;
  return null;
}

/**
 * Merge: every event of `fromId` moves to `into` (a format the new category
 * doesn't allow becomes in person). The caller archives `fromId`. Returns the
 * new event list and the ids that moved.
 */
export function mergeEvents(
  events: readonly CrmEvent[],
  fromId: string,
  into: EventCategory,
): { events: CrmEvent[]; moved: string[] } {
  const moved: string[] = [];
  const next = events.map((e) => {
    if (e.categoryId !== fromId) return e;
    moved.push(e.id);
    return { ...e, categoryId: into.id, format: eventFormat(e, into) };
  });
  return { events: next, moved };
}

/** How many events use each category. */
export function eventCounts(events: readonly Pick<CrmEvent, "categoryId">[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) out.set(e.categoryId, (out.get(e.categoryId) ?? 0) + 1);
  return out;
}

// ---------------------------------------------------------------------------
// Who may
// ---------------------------------------------------------------------------

/**
 * Who may add a category: anyone who may plan events (`canManageEvents`:
 * leaders, their deputies and 3/10 and up in the app; the database lets
 * anyone who isn't a candidate, like adding events).
 */
export function canCreateCategories(canManageEvents: boolean): boolean {
  return canManageEvents;
}

/**
 * Who may rename, change settings, reorder, archive and merge: leaders and
 * their deputies (the database checks `acts_as_leader()`).
 */
export function canEditCategories(role: Role | undefined, deputyOf: readonly string[]): boolean {
  return role === "leader" || deputyOf.length > 0;
}
