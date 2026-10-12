import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { daysFromToday, localDate } from "@/lib/dates";

export interface Sale {
  id: string;
  customerId: string;
  product: string;
  date: string;
  amount?: number;
}
export interface Contact {
  id: string;
  personId: string;
  byId: string;
  date: string;
  note?: string;
}
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

const daysAgo = (n: number) => daysFromToday(-n);

const seedSales: Sale[] = [
  ["c1", "Nutrilite Double X", 5],
  ["c2", "Artistry Skin Set", 20],
  ["c3", "XS Energy (case)", 40],
  ["c4", "eSpring Filter", 70],
  ["c5", "Nutrilite Daily", 3],
  ["c6", "SA8 Laundry", 45],
  ["c7", "Protein Powder", 12],
  ["c8", "XS Energy (case)", 33],
  ["c9", "Artistry Serum", 8],
  ["c10", "Glister Toothpaste", 60],
].map(([customerId, product, d], i) => ({
  id: `s${i}`,
  customerId: customerId as string,
  product: product as string,
  date: daysAgo(d as number),
}));

const customerContactAge: Record<string, [string, number]> = {
  c1: ["1", 4],
  c2: ["1", 36],
  c3: ["1", 12],
  c4: ["1", 52],
  c5: ["2", 9],
  c6: ["2", 41],
  c7: ["3", 18],
  c8: ["4", 31],
  c9: ["8", 6],
  c10: ["13", 44],
};
const teamContactAge: Record<string, number> = {
  "2": 3,
  "3": 20,
  "4": 9,
  "5": 16,
  "6": 2,
  "7": 25,
  "8": 11,
  "9": 30,
  "10": 5,
};

const seedContacts: Contact[] = [
  ...Object.entries(customerContactAge).map(([pid, [by, d]]) => ({
    id: `k-${pid}`,
    personId: pid,
    byId: by,
    date: daysAgo(d),
  })),
  ...Object.entries(teamContactAge).map(([pid, d]) => ({
    id: `t-${pid}`,
    personId: pid,
    byId: "1",
    date: daysAgo(d),
  })),
];

const seedLearning: Learning[] = [
  { personId: "1", kind: "podcast", title: "Leadership Hour #42", amount: 1, date: daysAgo(0) },
  { personId: "1", kind: "pages", title: "Go-Givers Sell More", amount: 25, date: daysAgo(1) },
  { personId: "1", kind: "pages", title: "Go-Givers Sell More", amount: 20, date: daysAgo(2) },
  {
    personId: "1",
    kind: "workshop",
    title: "Spring Leadership Workshop",
    amount: 1,
    date: daysAgo(12),
  },
  { personId: "2", kind: "podcast", title: "Momentum Daily", amount: 1, date: daysAgo(0) },
  { personId: "2", kind: "pages", title: "The Slight Edge", amount: 15, date: daysAgo(3) },
  { personId: "4", kind: "podcast", title: "Momentum Daily", amount: 1, date: daysAgo(6) },
  { personId: "3", kind: "conference", title: "Summer Conference", amount: 1, date: daysAgo(25) },
].map((l, i) => ({ ...l, id: `l${i}` }) as Learning);

interface CrmState {
  sales: Sale[];
  contacts: Contact[];
  learning: Learning[];
  settings: Settings;
  logSale: (s: Omit<Sale, "id">) => void;
  logContact: (c: Omit<Contact, "id">) => void;
  logLearning: (l: Omit<Learning, "id">) => void;
  removeLearning: (id: string) => void;
  setSettings: (s: Partial<Settings>) => void;
}

export const useCrmStore = create<CrmState>()(
  persist(
    (set, get) => ({
      sales: seedSales,
      contacts: seedContacts,
      learning: seedLearning,
      settings: { customerDays: 30, teamDays: 14 },
      logSale: (s) => set({ sales: [{ ...s, id: crypto.randomUUID() }, ...get().sales] }),
      logContact: (c) => set({ contacts: [{ ...c, id: crypto.randomUUID() }, ...get().contacts] }),
      logLearning: (l) => set({ learning: [{ ...l, id: crypto.randomUUID() }, ...get().learning] }),
      removeLearning: (id) => set({ learning: get().learning.filter((l) => l.id !== id) }),
      setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
    }),
    { name: "levelup.crm", storage: createJSONStorage(() => localStorage) },
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
