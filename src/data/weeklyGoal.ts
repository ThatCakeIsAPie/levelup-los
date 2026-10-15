/**
 * The weekly goal ("This week's goal" on Home and /learning): an ordered list
 * of items, each a category with a target (and a unit for reading and
 * podcasts). Everything about a category lives in GOAL_CATEGORIES, once: its
 * label, icon, units, how it is counted and its target when added, so adding
 * a category is one entry there. Pure: the hooks pass the rows in
 * (`useWeeklyGoal` in ./crm).
 *
 * "This week" is the rolling last 7 days (today and the 6 days before), so the
 * goal never resets to zero on a Monday morning.
 *
 * Stored as `LearningGoal.items` (table `learning_goals.items`, jsonb). Rows
 * written before lists existed have no items: their goal comes from the old
 * reading / podcast / workshop targets (`itemsFromLegacy`), and saving keeps
 * those columns in step (`legacyGoalColumns`) for older clients.
 */
import { addDays } from "date-fns";
import {
  BookOpen,
  CalendarCheck,
  Handshake,
  Headphones,
  MessageCircle,
  Presentation,
  TrendingUp,
  UserRoundPlus,
  type LucideIcon,
} from "lucide-react";
import { localDate, parseDate } from "@/lib/dates";
import type { Attendance } from "@/stores/attendanceStore";
import type {
  Contact,
  Learning,
  LearningGoal,
  LearningUnit,
  PodcastUnit,
  ReadingUnit,
  Sale,
} from "@/stores/crmStore";
import type { CrmEvent } from "@/stores/eventsStore";
import type { CrmPerson } from "@/stores/peopleStore";
import type { CustomerMove } from "./customerPipeline/types";
import { saleSellerId } from "./growth/engine";
import { dayOf, reachesOf, type MoveLike } from "./pipeline/rules";

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

/** First and last day ("YYYY-MM-DD") of the rolling week that ends on `today`. */
export function goalWeek(today: string): { from: string; to: string } {
  return { from: localDate(addDays(parseDate(today), -6)), to: today };
}

const inWeek = (day: string | undefined, w: { from: string; to: string }): boolean =>
  !!day && day >= w.from && day <= w.to;

// ---------------------------------------------------------------------------
// What gets counted
// ---------------------------------------------------------------------------

/**
 * Everything a category may count. Rows can be broader than one person (the
 * hook passes what the viewer can see); each category picks `personId`'s own.
 */
export interface GoalInput {
  personId: string;
  today: string;
  learning: readonly Learning[];
  contacts: readonly Contact[];
  /** People (customers with their owner and joined date; buyers for PV). */
  people: readonly CrmPerson[];
  sales: readonly Sale[];
  attendances: readonly Attendance[];
  events: readonly CrmEvent[];
  /** Recruiting pipeline moves. */
  pipelineMoves: readonly MoveLike[];
  /** Customer pipeline moves (the First sale move that made a customer). */
  customerMoves: readonly Pick<CustomerMove, "createdCustomerId" | "movedAt">[];
}

/** What a category needs unlocked before it's offered (an item already in a goal always shows). */
export type GoalRequirement = "pipeline";

export interface GoalUnitOption<U extends LearningUnit = LearningUnit> {
  value: U;
  label: string;
}

export interface GoalCategory {
  label: string;
  /** One line under the name in the editor. */
  hint: string;
  icon: LucideIcon;
  /** Ways it can be measured, first = default (reading and podcasts only). */
  units?: readonly GoalUnitOption[];
  /** Target when it's added to a goal. */
  defaultTarget: number;
  /** The card row: "Pages", "Reading (min)", "PV". */
  rowLabel: (unit?: LearningUnit) => string;
  /** After "12 of 20": "pages", "min reading", "contacts". */
  words: (unit?: LearningUnit) => string;
  requires?: GoalRequirement;
  /** This week's total for `input.personId`, in `unit` when the category has units. */
  count: (input: GoalInput, unit?: LearningUnit) => number;
}

const READING_UNITS: readonly GoalUnitOption<ReadingUnit>[] = [
  { value: "pages", label: "Pages" },
  { value: "chapters", label: "Chapters" },
  { value: "minutes", label: "Minutes" },
];
const PODCAST_UNITS: readonly GoalUnitOption<PodcastUnit>[] = [
  { value: "episodes", label: "Episodes" },
  { value: "minutes", label: "Minutes" },
];

/** Sum of learning amounts of `kinds` this week, in `unit` (entries without one: `fallback`). */
function learningTotal(
  input: GoalInput,
  kinds: readonly Learning["kind"][],
  unit?: LearningUnit,
  fallback?: LearningUnit,
): number {
  const w = goalWeek(input.today);
  let n = 0;
  for (const e of input.learning) {
    if (e.personId !== input.personId || !kinds.includes(e.kind) || !inWeek(e.date, w)) continue;
    if (unit && (e.unit ?? fallback) !== unit) continue;
    n += e.amount;
  }
  return n;
}

/**
 * The day someone became a customer: their joined date (the "acquired" day
 * when added by hand; the day of the First sale move when the customer
 * pipeline made them), else the day of the move that created them.
 */
export function becameCustomerOn(
  p: CrmPerson,
  createdBy: ReadonlyMap<string, string>,
): string | undefined {
  return p.joinedDate || createdBy.get(p.id);
}

/** Customer id → day of the customer pipeline move that created them (earliest). */
function createdCustomerDays(moves: GoalInput["customerMoves"]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of moves) {
    if (!m.createdCustomerId) continue;
    const day = dayOf(m.movedAt);
    const prev = out.get(m.createdCustomerId);
    if (!prev || day < prev) out.set(m.createdCustomerId, day);
  }
  return out;
}

/**
 * Every category, in the order the Add menu offers them. The key is the kind
 * stored in `learning_goals.items` (lower_snake_case; never rename one).
 */
export const GOAL_CATEGORIES = {
  reading: {
    label: "Reading",
    hint: "Books you log, in the unit you pick",
    icon: BookOpen,
    units: READING_UNITS,
    defaultTarget: 60,
    rowLabel: (u) => (u === "minutes" ? "Reading (min)" : u === "chapters" ? "Chapters" : "Pages"),
    words: (u) => (u === "minutes" ? "min reading" : u === "chapters" ? "chapters" : "pages"),
    count: (input, unit) => learningTotal(input, ["pages"], unit ?? "pages", "pages"),
  },
  podcasts: {
    label: "Podcasts",
    hint: "Audios and podcasts, in the unit you pick",
    icon: Headphones,
    units: PODCAST_UNITS,
    defaultTarget: 3,
    rowLabel: (u) => (u === "minutes" ? "Podcasts (min)" : "Podcasts"),
    words: (u) => (u === "minutes" ? "min listening" : "podcasts"),
    count: (input, unit) => learningTotal(input, ["podcast"], unit ?? "episodes", "episodes"),
  },
  workshops: {
    label: "Workshops",
    hint: "Workshops and conferences you log",
    icon: Presentation,
    defaultTarget: 1,
    rowLabel: () => "Workshops",
    words: () => "workshops",
    count: (input) => learningTotal(input, ["workshop", "conference"]),
  },
  contacts: {
    label: "Contacts",
    hint: "Check-ins you log with your team and customers",
    icon: MessageCircle,
    defaultTarget: 10,
    rowLabel: () => "Contacts",
    words: () => "contacts",
    count: (input) => {
      const w = goalWeek(input.today);
      return input.contacts.filter((c) => c.byId === input.personId && inWeek(c.date, w)).length;
    },
  },
  new_customers: {
    label: "New customers",
    hint: "Customers you gain, added by hand or from your pipeline",
    icon: UserRoundPlus,
    defaultTarget: 2,
    rowLabel: () => "New customers",
    words: () => "new customers",
    count: (input) => {
      const w = goalWeek(input.today);
      const created = createdCustomerDays(input.customerMoves);
      return input.people.filter(
        (p) =>
          p.bizClass === "customer" &&
          p.ownerId === input.personId &&
          inWeek(becameCustomerOn(p, created), w),
      ).length;
    },
  },
  pv: {
    label: "PV",
    hint: "Point value of sales that count toward you",
    icon: TrendingUp,
    defaultTarget: 100,
    rowLabel: () => "PV",
    words: () => "PV",
    count: (input) => {
      const w = goalWeek(input.today);
      const byId = new Map(input.people.map((p) => [p.id, p]));
      let n = 0;
      for (const s of input.sales) {
        if (inWeek(s.date, w) && saleSellerId(s, byId) === input.personId) n += s.pv ?? 0;
      }
      return n;
    },
  },
  events: {
    label: "Events attended",
    hint: "Events you came to, in person or online",
    icon: CalendarCheck,
    defaultTarget: 1,
    rowLabel: () => "Events attended",
    words: () => "events",
    count: (input) => {
      const w = goalWeek(input.today);
      const dates = new Map(input.events.map((e) => [e.id, e.date]));
      return input.attendances.filter(
        (a) =>
          a.personId === input.personId && a.attended === true && inWeek(dates.get(a.eventId), w),
      ).length;
    },
  },
  first_meetings: {
    label: "First meetings",
    hint: "Prospects on your board reaching First meeting",
    icon: Handshake,
    defaultTarget: 3,
    rowLabel: () => "First meetings",
    words: () => "first meetings",
    requires: "pipeline",
    count: (input) => {
      const w = goalWeek(input.today);
      // Only prospects that were ever on this person's board, with all their moves.
      const mine = new Set(
        input.pipelineMoves.filter((m) => m.ownerId === input.personId).map((m) => m.personId),
      );
      const moves = input.pipelineMoves.filter((m) => mine.has(m.personId));
      return reachesOf(moves).filter(
        (r) => r.milestone === "first_meeting" && r.ownerId === input.personId && inWeek(r.day, w),
      ).length;
    },
  },
} satisfies Record<string, GoalCategory>;

export type GoalKind = keyof typeof GOAL_CATEGORIES;
export const GOAL_KINDS = Object.keys(GOAL_CATEGORIES) as GoalKind[];

export interface GoalItem {
  kind: GoalKind;
  /** Whole number, at least 1. */
  target: number;
  /** Reading and podcasts only (always set for them once normalised). */
  unit?: LearningUnit;
}

/** Biggest target the editor (and the database) accepts. */
export const MAX_GOAL_TARGET = 100_000;

export const isGoalKind = (k: unknown): k is GoalKind =>
  typeof k === "string" && Object.prototype.hasOwnProperty.call(GOAL_CATEGORIES, k);

export const goalCategory = (kind: GoalKind): GoalCategory => GOAL_CATEGORIES[kind];

export const validTarget = (n: number): boolean =>
  Number.isInteger(n) && n >= 1 && n <= MAX_GOAL_TARGET;

/** An item with the unit its category expects (the first unit when missing or wrong; none otherwise). */
export function normalizeItem(item: GoalItem): GoalItem {
  const units = goalCategory(item.kind).units;
  if (!units) return { kind: item.kind, target: item.target };
  const unit = units.some((u) => u.value === item.unit) ? item.unit! : units[0].value;
  return { kind: item.kind, target: item.target, unit };
}

/**
 * Items from stored JSON: known kinds only, first of each kind, whole
 * targets of at least 1, units fitted to the category. Anything else is
 * dropped (a newer client's kind, or a malformed entry).
 */
export function parseGoalItems(json: unknown): GoalItem[] {
  if (!Array.isArray(json)) return [];
  const seen = new Set<GoalKind>();
  const out: GoalItem[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== "object") continue;
    const { kind, target, unit } = raw as Record<string, unknown>;
    if (!isGoalKind(kind) || seen.has(kind)) continue;
    const n = Number(target);
    if (!validTarget(n)) continue;
    seen.add(kind);
    out.push(normalizeItem({ kind, target: n, unit: unit as LearningUnit | undefined }));
  }
  return out;
}

/** The goal before lists: reading, podcasts and workshop targets (0 = not in the goal). */
export interface LegacyGoal {
  pages: number;
  podcasts: number;
  workshops: number;
  readingUnit?: ReadingUnit | null;
  podcastUnit?: PodcastUnit | null;
}

/** Items for a goal saved before lists (a target of 0 was "not counted"). */
export function itemsFromLegacy(g: LegacyGoal): GoalItem[] {
  const out: GoalItem[] = [];
  if (g.pages > 0) out.push({ kind: "reading", target: g.pages, unit: g.readingUnit ?? "pages" });
  if (g.podcasts > 0)
    out.push({ kind: "podcasts", target: g.podcasts, unit: g.podcastUnit ?? "episodes" });
  if (g.workshops > 0) out.push({ kind: "workshops", target: g.workshops });
  return out.map(normalizeItem);
}

/** The old columns for a list: each target or 0 when it isn't in the goal, and the units. */
export function legacyGoalColumns(items: readonly GoalItem[]): {
  pages: number;
  podcasts: number;
  workshops: number;
  readingUnit: ReadingUnit | null;
  podcastUnit: PodcastUnit | null;
} {
  const find = (k: GoalKind) => items.find((i) => i.kind === k);
  const reading = find("reading");
  const podcasts = find("podcasts");
  return {
    pages: reading?.target ?? 0,
    podcasts: podcasts?.target ?? 0,
    workshops: find("workshops")?.target ?? 0,
    readingUnit: reading ? ((reading.unit as ReadingUnit | undefined) ?? "pages") : null,
    podcastUnit: podcasts ? ((podcasts.unit as PodcastUnit | undefined) ?? "episodes") : null,
  };
}

/** The unit an item of `kind` counts in, if the goal has one (for the learning log form). */
export function goalUnit(goal: LearningGoal, kind: "reading"): ReadingUnit | undefined;
export function goalUnit(goal: LearningGoal, kind: "podcasts"): PodcastUnit | undefined;
export function goalUnit(
  goal: LearningGoal,
  kind: "reading" | "podcasts",
): LearningUnit | undefined {
  const item = goal.items.find((i) => i.kind === kind);
  return item ? normalizeItem(item).unit : undefined;
}

/** Categories that can still be added: not in the goal, and unlocked. */
export function addableCategories(
  items: readonly GoalItem[],
  unlocked: Partial<Record<GoalRequirement, boolean>>,
): GoalKind[] {
  const used = new Set(items.map((i) => i.kind));
  return GOAL_KINDS.filter((k) => {
    const req = goalCategory(k).requires;
    return !used.has(k) && (!req || !!unlocked[req]);
  });
}

/** A new item of `kind` with its default target and unit. */
export const newGoalItem = (kind: GoalKind): GoalItem =>
  normalizeItem({ kind, target: goalCategory(kind).defaultTarget });

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface GoalItemProgress {
  item: GoalItem;
  category: GoalCategory;
  /** This week's total. */
  done: number;
  /** 0..1, capped. */
  progress: number;
}

export interface WeeklyGoalView {
  items: GoalItemProgress[];
  /** The average of each item's capped progress; 0 for an empty goal. */
  progress: number;
}

/** Combined progress 0..1: the average of each item's progress, each capped at 100%. */
export function goalProgress(items: readonly { done: number; target: number }[]): number {
  const parts = items.filter((i) => i.target > 0).map((i) => Math.min(1, i.done / i.target));
  if (parts.length === 0) return 0;
  return parts.reduce((s, x) => s + x, 0) / parts.length;
}

/** Each item's total this week and the combined progress. */
export function weeklyGoalView(goal: LearningGoal, input: GoalInput): WeeklyGoalView {
  const items = goal.items.map((raw) => {
    const item = normalizeItem(raw);
    const category = goalCategory(item.kind);
    const done = category.count(input, item.unit);
    return { item, category, done, progress: Math.min(1, done / item.target) };
  });
  return {
    items,
    progress: goalProgress(items.map((i) => ({ done: i.done, target: i.item.target }))),
  };
}

/** "35 of 60 pages", "40 of 120 min reading", "1 of 2 new customers". */
export function itemLine(p: Pick<GoalItemProgress, "item" | "category" | "done">): string {
  return `${p.done} of ${p.item.target} ${p.category.words(p.item.unit)}`;
}
