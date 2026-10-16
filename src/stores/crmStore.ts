import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dataStorage, seedOr } from "./storage";
import { daysFromToday, localDate } from "@/lib/dates";
import {
  seedContacts,
  seedLearning,
  seedLearningGoals,
  seedMilestoneMarks,
  seedPvOverrides,
  seedSales,
  SEED_VERSION,
} from "@/data/seed";
import type {
  GrowthMilestoneCode,
  MilestoneHistory,
  MilestoneMark,
  PvOverride,
} from "@/data/growth/types";
import type { GoalItem } from "@/data/weeklyGoal";

export interface Sale {
  id: string;
  /** Who bought: a customer, or a business person buying for themselves (personal order). */
  customerId: string;
  product: string;
  date: string;
  amount?: number;
  /** Point value: counts toward `personId`'s monthly PV (src/data/growth). */
  pv?: number;
  /**
   * Whose PV it is: the customer's owner, or the buyer for a personal order.
   * Set by logSale; older sales without it fall back to the same rule.
   */
  personId?: string;
  /** When it was logged (ISO); missing on older and seeded rows. */
  createdAt?: string;
}
/** How a contact was recorded: by hand, from a chat conversation, or at an event. */
export type ContactSource = "manual" | "message" | "event";
export interface Contact {
  id: string;
  personId: string;
  byId: string;
  date: string;
  note?: string;
  /**
   * Always set by the store ("manual" when not given; older saved data is
   * normalised on load). Optional in the type only because the CRM seed
   * builds contacts without it.
   */
  source?: ContactSource;
  /** When it was logged (ISO); missing on older and seeded rows. */
  createdAt?: string;
}

/** Contacts with `source` filled in ("manual" when missing). */
const withSource = (contacts: Contact[]): Contact[] =>
  contacts.map((c) => (c.source ? c : { ...c, source: "manual" }));
/** "pages" is reading (the name predates the other reading units). */
export type LearningKind = "podcast" | "pages" | "workshop" | "conference";
/** How reading is measured. */
export type ReadingUnit = "minutes" | "pages" | "chapters";
/** How podcast listening is measured. */
export type PodcastUnit = "minutes" | "episodes";
export type LearningUnit = ReadingUnit | PodcastUnit;
export interface Learning {
  id: string;
  personId: string;
  kind: LearningKind;
  title: string;
  /** In `unit` for reading and podcasts; 1 for workshops and conferences. */
  amount: number;
  /**
   * Reading and podcasts only. Missing (entries logged before units existed,
   * and library completions) means pages for reading and episodes for podcasts.
   */
  unit?: LearningUnit;
  date: string;
  /** When it was logged (ISO); missing on older and seeded rows. */
  createdAt?: string;
}
export interface Settings {
  customerDays: number;
  teamDays: number;
}
/**
 * A person's weekly goal: an ordered list of targets ("Reading 60 pages",
 * "Contacts 10", "PV 150"), each kind at most once. Categories, units and how
 * each is counted: src/data/weeklyGoal.ts. Empty = no goal.
 */
export interface LearningGoal {
  items: GoalItem[];
}

/** The goal for people who haven't set one: Reading 60 pages · Podcasts 3 · Workshops 1. */
export const DEFAULT_LEARNING_GOAL: LearningGoal = {
  items: [
    { kind: "reading", target: 60, unit: "pages" },
    { kind: "podcasts", target: 3, unit: "episodes" },
    { kind: "workshops", target: 1 },
  ],
};
export const DEFAULT_SETTINGS: Settings = { customerDays: 30, teamDays: 14 };

interface CrmState {
  sales: Sale[];
  contacts: Contact[];
  learning: Learning[];
  settings: Settings;
  /** Weekly learning goals by person id; missing = DEFAULT_LEARNING_GOAL. */
  goals: Record<string, LearningGoal>;
  /** Monthly PV set by uplines (one per person and month). */
  pvOverrides: PvOverride[];
  /** Milestones marked as reached by hand (one per person and milestone). */
  milestoneMarks: MilestoneMark[];
  /** Milestone history the app recorded (one per person and milestone; src/data/growth). */
  milestoneHistory: MilestoneHistory[];
  logSale: (s: Omit<Sale, "id">) => Sale;
  logContact: (c: Omit<Contact, "id">) => Contact;
  removeSale: (id: string) => void;
  removeContact: (id: string) => void;
  logLearning: (l: Omit<Learning, "id">) => void;
  removeLearning: (id: string) => void;
  setSettings: (s: Partial<Settings>) => void;
  setLearningGoal: (personId: string, goal: LearningGoal) => void;
  /** Set (or with `null`, clear) a person's PV for a month. */
  setPvOverride: (
    personId: string,
    month: string,
    value: Omit<PvOverride, "personId" | "month"> | null,
  ) => void;
  /** Mark (or with `null`, unmark) a milestone as reached by hand. */
  setMilestoneMark: (
    personId: string,
    code: GrowthMilestoneCode,
    value: Omit<MilestoneMark, "personId" | "code"> | null,
  ) => void;
  /**
   * Merge recorded milestone history: per person and milestone the earlier
   * first-reached day and the later last-met day win (as in the database).
   */
  recordMilestoneHistory: (rows: MilestoneHistory[]) => void;
}

/** The demo seed ("local" mode) or nothing until the database loads ("supabase" mode). */
function freshState() {
  return seedOr(
    () => ({
      sales: seedSales(),
      contacts: withSource(seedContacts()),
      learning: seedLearning(),
      settings: { ...DEFAULT_SETTINGS },
      goals: seedLearningGoals(),
      pvOverrides: seedPvOverrides(),
      milestoneMarks: seedMilestoneMarks(),
      milestoneHistory: [] as MilestoneHistory[],
    }),
    {
      sales: [],
      contacts: [],
      learning: [],
      settings: { ...DEFAULT_SETTINGS },
      goals: {},
      pvOverrides: [],
      milestoneMarks: [],
      milestoneHistory: [] as MilestoneHistory[],
    },
  );
}

export const useCrmStore = create<CrmState>()(
  persist(
    (set, get) => ({
      ...freshState(),
      logSale: (s) => {
        const sale: Sale = { createdAt: new Date().toISOString(), ...s, id: crypto.randomUUID() };
        set({ sales: [sale, ...get().sales] });
        return sale;
      },
      logContact: (c) => {
        const contact: Contact = {
          source: "manual",
          createdAt: new Date().toISOString(),
          ...c,
          id: crypto.randomUUID(),
        };
        set({ contacts: [contact, ...get().contacts] });
        return contact;
      },
      removeSale: (id) => set({ sales: get().sales.filter((s) => s.id !== id) }),
      removeContact: (id) => set({ contacts: get().contacts.filter((c) => c.id !== id) }),
      logLearning: (l) =>
        set({
          learning: [
            { createdAt: new Date().toISOString(), ...l, id: crypto.randomUUID() },
            ...get().learning,
          ],
        }),
      removeLearning: (id) => set({ learning: get().learning.filter((l) => l.id !== id) }),
      setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
      setLearningGoal: (personId, goal) =>
        set({ goals: { ...get().goals, [personId]: { items: [...goal.items] } } }),
      setPvOverride: (personId, month, value) => {
        const rest = get().pvOverrides.filter(
          (o) => !(o.personId === personId && o.month === month),
        );
        set({ pvOverrides: value ? [...rest, { personId, month, ...value }] : rest });
      },
      setMilestoneMark: (personId, code, value) => {
        const rest = get().milestoneMarks.filter(
          (m) => !(m.personId === personId && m.code === code),
        );
        set({ milestoneMarks: value ? [...rest, { personId, code, ...value }] : rest });
      },
      recordMilestoneHistory: (rows) => {
        if (!rows.length) return;
        const key = (h: { personId: string; code: string }) => `${h.personId}|${h.code}`;
        const byKey = new Map(get().milestoneHistory.map((h) => [key(h), h]));
        for (const r of rows) {
          const old = byKey.get(key(r));
          byKey.set(
            key(r),
            old
              ? {
                  ...r,
                  firstReachedOn:
                    old.firstReachedOn < r.firstReachedOn ? old.firstReachedOn : r.firstReachedOn,
                  lastMetOn: old.lastMetOn > r.lastMetOn ? old.lastMetOn : r.lastMetOn,
                }
              : r,
          );
        }
        set({ milestoneHistory: [...byKey.values()] });
      },
    }),
    {
      name: "levelup.crm",
      storage: dataStorage(),
      partialize: (s) => ({
        sales: s.sales,
        contacts: s.contacts,
        learning: s.learning,
        settings: s.settings,
        goals: s.goals,
        pvOverrides: s.pvOverrides,
        milestoneMarks: s.milestoneMarks,
        milestoneHistory: s.milestoneHistory,
      }),
      version: SEED_VERSION,
      migrate: () => freshState() as unknown as CrmState,
      // Contacts saved before `source` existed count as manual.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CrmState>;
        return { ...current, ...p, contacts: withSource(p.contacts ?? current.contacts) };
      },
    },
  ),
);

export const today = () => localDate();

export function lastContactDate(contacts: Contact[], personId: string): string | undefined {
  let best: string | undefined;
  for (const c of contacts) if (c.personId === personId && (!best || c.date > best)) best = c.date;
  return best;
}
export function lastSale(sales: Sale[], customerId: string): Sale | undefined {
  let best: Sale | undefined;
  for (const s of sales) if (s.customerId === customerId && (!best || s.date > best.date)) best = s;
  return best;
}
export { daysSince } from "@/lib/dates";

/** A person's weekly goal (falls back to DEFAULT_LEARNING_GOAL when they have none). */
export function learningGoalFor(
  goals: Record<string, LearningGoal>,
  personId: string,
): LearningGoal {
  const goal = goals[personId];
  // Anything saved without a list (an older demo store) reads as the default.
  return goal && Array.isArray(goal.items) ? goal : DEFAULT_LEARNING_GOAL;
}

/** The unit an entry is measured in (undefined for workshops and conferences). */
export function learningUnit(l: Pick<Learning, "kind" | "unit">): LearningUnit | undefined {
  if (l.kind === "pages") return l.unit ?? "pages";
  if (l.kind === "podcast") return l.unit ?? "episodes";
  return undefined;
}

const UNIT_WORDS: Record<LearningUnit, [string, string]> = {
  minutes: ["minute", "minutes"],
  pages: ["page", "pages"],
  chapters: ["chapter", "chapters"],
  episodes: ["episode", "episodes"],
};

/** "1 page", "3 chapters", "45 minutes", "2 episodes". */
export function unitAmount(amount: number, unit: LearningUnit): string {
  const [one, many] = UNIT_WORDS[unit];
  return `${amount} ${amount === 1 ? one : many}`;
}

/**
 * One line for a learning entry, as the profile's activity and Home's "What
 * you did today" show it: "Read 20 pages of Atomic Habits", "Listened to a
 * podcast: …", "Went to a workshop: …".
 */
export function learningLine(l: Pick<Learning, "kind" | "unit" | "amount" | "title">): string {
  if (l.kind === "pages") {
    return learningUnit(l) === "minutes"
      ? `Read ${l.title} for ${unitAmount(l.amount, "minutes")}`
      : `Read ${unitAmount(l.amount, learningUnit(l)!)} of ${l.title}`;
  }
  if (l.kind === "podcast") {
    return learningUnit(l) === "minutes"
      ? `Listened to ${l.title} for ${unitAmount(l.amount, "minutes")}`
      : l.amount === 1
        ? `Listened to a podcast: ${l.title}`
        : `Listened to ${unitAmount(l.amount, "episodes")}: ${l.title}`;
  }
  return l.kind === "workshop"
    ? `Went to a workshop: ${l.title}`
    : `Went to a conference: ${l.title}`;
}

/** Consecutive days (ending today or yesterday) with any learning logged. */
export function learningStreak(entries: Learning[]): number {
  const days = new Set(entries.map((e) => e.date));
  let offset = days.has(daysFromToday(0)) ? 0 : -1;
  let n = 0;
  while (days.has(daysFromToday(offset))) {
    n++;
    offset--;
  }
  return n;
}

/** Longest run of consecutive days with any learning logged (personal best). */
export function bestLearningStreak(entries: Learning[]): number {
  const days = [...new Set(entries.map((e) => e.date))].sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;
    run = prev !== null && t - prev === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}
