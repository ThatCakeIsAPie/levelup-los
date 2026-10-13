import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { daysFromToday, localDate } from "@/lib/dates";
import {
  seedContacts,
  seedLearning,
  seedLearningGoals,
  seedSales,
  SEED_VERSION,
} from "@/data/seed";

export interface Sale {
  id: string;
  customerId: string;
  product: string;
  date: string;
  amount?: number;
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
}

/** Contacts with `source` filled in ("manual" when missing). */
const withSource = (contacts: Contact[]): Contact[] =>
  contacts.map((c) => (c.source ? c : { ...c, source: "manual" }));
export type LearningKind = "podcast" | "pages" | "workshop" | "conference";
export interface Learning {
  id: string;
  personId: string;
  kind: LearningKind;
  title: string;
  amount: number;
  date: string;
}
export interface Settings {
  customerDays: number;
  teamDays: number;
}
/** Weekly learning targets for one person. */
export interface LearningGoal {
  pages: number;
  podcasts: number;
  workshops: number;
}

export const DEFAULT_LEARNING_GOAL: LearningGoal = { pages: 60, podcasts: 3, workshops: 1 };
export const DEFAULT_SETTINGS: Settings = { customerDays: 30, teamDays: 14 };

interface CrmState {
  sales: Sale[];
  contacts: Contact[];
  learning: Learning[];
  settings: Settings;
  /** Weekly learning goals by person id; missing = DEFAULT_LEARNING_GOAL. */
  goals: Record<string, LearningGoal>;
  logSale: (s: Omit<Sale, "id">) => Sale;
  logContact: (c: Omit<Contact, "id">) => Contact;
  removeSale: (id: string) => void;
  removeContact: (id: string) => void;
  logLearning: (l: Omit<Learning, "id">) => void;
  removeLearning: (id: string) => void;
  setSettings: (s: Partial<Settings>) => void;
  setLearningGoal: (personId: string, goal: Partial<LearningGoal>) => void;
}

function freshState() {
  return {
    sales: seedSales(),
    contacts: withSource(seedContacts()),
    learning: seedLearning(),
    settings: { ...DEFAULT_SETTINGS },
    goals: seedLearningGoals(),
  };
}

export const useCrmStore = create<CrmState>()(
  persist(
    (set, get) => ({
      ...freshState(),
      logSale: (s) => {
        const sale: Sale = { ...s, id: crypto.randomUUID() };
        set({ sales: [sale, ...get().sales] });
        return sale;
      },
      logContact: (c) => {
        const contact: Contact = { source: "manual", ...c, id: crypto.randomUUID() };
        set({ contacts: [contact, ...get().contacts] });
        return contact;
      },
      removeSale: (id) => set({ sales: get().sales.filter((s) => s.id !== id) }),
      removeContact: (id) => set({ contacts: get().contacts.filter((c) => c.id !== id) }),
      logLearning: (l) => set({ learning: [{ ...l, id: crypto.randomUUID() }, ...get().learning] }),
      removeLearning: (id) => set({ learning: get().learning.filter((l) => l.id !== id) }),
      setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
      setLearningGoal: (personId, goal) =>
        set({
          goals: {
            ...get().goals,
            [personId]: { ...learningGoalFor(get().goals, personId), ...goal },
          },
        }),
    }),
    {
      name: "levelup.crm",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        sales: s.sales,
        contacts: s.contacts,
        learning: s.learning,
        settings: s.settings,
        goals: s.goals,
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

/** A person's weekly goal (falls back to DEFAULT_LEARNING_GOAL). */
export function learningGoalFor(
  goals: Record<string, LearningGoal>,
  personId: string,
): LearningGoal {
  return goals[personId] ?? DEFAULT_LEARNING_GOAL;
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
