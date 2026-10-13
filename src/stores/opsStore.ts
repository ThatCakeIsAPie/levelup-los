import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dataStorage, seedOr } from "./storage";
import { seedOps, SEED_VERSION } from "@/data/seed";
import { opsWithoutEvent, opsWithoutPerson } from "@/data/cascade";

export interface Logistics {
  ticket: "bought" | "planned";
  planDate?: string;
  mode: "fly" | "drive";
  flightBooked?: boolean;
  carpool: "teammate" | "other_team" | "solo" | "van";
  vanPaid?: "yes" | "no" | "planned";
  vanPayDate?: string;
}
export interface SharedCost {
  id: string;
  eventId: string;
  name: string;
  total: number;
  ownerId: string;
  members: string[];
  overrides: Record<string, number>;
}
/**
 * A sandbox payment. `amount` and `costName` are what was paid, frozen at
 * payment time (older saved payments may lack them; the live share is used).
 */
export interface Payment {
  paidAt: string;
  ref: string;
  amount?: number;
  costName?: string;
}
export interface Invoice {
  id: string;
  costId: string;
  personId: string;
  /** Owed: the current share. Paid: the amount actually paid. */
  amount: number;
  /** Cost name at payment time (paid invoices). */
  costName?: string;
  status: "owed" | "paid";
  paidAt?: string;
  paymentReference?: string;
}
export interface Campaign {
  id: string;
  ownerId: string;
  kind: "email" | "text" | "voice";
  message: string;
  recipients: string[];
  scheduledFor?: string;
  createdAt: string;
  status: "pending_send";
}
export interface ReportSchedule {
  ownerId: string;
  frequency: "weekly" | "monthly";
}

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Each member's share. Paid members are fixed at what they paid, then the
 * organizer's overrides; everyone else splits the rest evenly.
 */
export function splitCost(
  c: SharedCost,
  paid: Record<string, number> = {},
): Record<string, number> {
  const fixedOf = (m: string) => (m in paid ? paid[m] : m in c.overrides ? c.overrides[m] : null);
  const fixedSum = c.members.reduce((s, m) => s + (fixedOf(m) ?? 0), 0);
  const rest = c.members.filter((m) => fixedOf(m) === null);
  const each = rest.length ? Math.round(((c.total - fixedSum) / rest.length) * 100) / 100 : 0;
  return Object.fromEntries(c.members.map((m) => [m, fixedOf(m) ?? each]));
}

/** Amounts already paid on a cost, by member (payments without a stored amount are skipped). */
export function paidShares(
  c: SharedCost,
  payments: Record<string, Payment>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of c.members) {
    const amount = payments[`${c.id}:${m}`]?.amount;
    if (amount !== undefined) out[m] = amount;
  }
  return out;
}

/** True when `personId` has paid their share of `costId`. */
export const hasPaid = (payments: Record<string, Payment>, costId: string, personId: string) =>
  !!payments[`${costId}:${personId}`];

interface OpsState {
  logistics: Record<string, Logistics>; // key `${eventId}:${personId}`
  costs: SharedCost[];
  payments: Record<string, Payment>; // key `${costId}:${personId}`
  campaigns: Campaign[];
  schedules: ReportSchedule[];
  setLogistics: (eventId: string, personId: string, l: Logistics) => void;
  addCost: (c: Omit<SharedCost, "id" | "members" | "overrides">) => void;
  toggleOptIn: (costId: string, personId: string) => void;
  setOverride: (costId: string, personId: string, amount: number | null) => void;
  pay: (costId: string, personId: string) => void;
  /** Cascade for a deleted person (costs they organized pass to `heirId`). */
  removePerson: (personId: string, heirId: string | null) => void;
  /** Cascade for a deleted event: travel plans, shared costs and their payments. */
  removeEvent: (eventId: string) => void;
  addCampaign: (c: Omit<Campaign, "id" | "createdAt" | "status">) => void;
  setSchedule: (s: ReportSchedule | null, ownerId: string) => void;
}

export const useOpsStore = create<OpsState>()(
  persist(
    (set) => ({
      ...seedOr(seedOps, { logistics: {}, costs: [] }),
      payments: {},
      campaigns: [],
      schedules: [],
      setLogistics: (e, p, l) => set((s) => ({ logistics: { ...s.logistics, [`${e}:${p}`]: l } })),
      addCost: (c) =>
        set((s) => ({
          costs: [...s.costs, { ...c, id: uid(), members: [c.ownerId], overrides: {} }],
        })),
      toggleOptIn: (id, p) =>
        set((s) => ({
          costs: s.costs.map((c) => {
            if (c.id !== id) return c;
            // Paid members can't opt out (the organizer would have to refund them).
            if (c.members.includes(p) && hasPaid(s.payments, id, p)) return c;
            return {
              ...c,
              members: c.members.includes(p) ? c.members.filter((m) => m !== p) : [...c.members, p],
            };
          }),
        })),
      setOverride: (id, p, amt) =>
        set((s) => ({
          costs: s.costs.map((c) => {
            // A paid share is fixed at what was paid.
            if (c.id !== id || hasPaid(s.payments, id, p)) return c;
            const o = { ...c.overrides };
            if (amt === null) delete o[p];
            else o[p] = amt;
            return { ...c, overrides: o };
          }),
        })),
      pay: (id, p) =>
        set((s) => {
          const c = s.costs.find((x) => x.id === id);
          if (!c || !c.members.includes(p) || hasPaid(s.payments, id, p)) return s;
          const amount = splitCost(c, paidShares(c, s.payments))[p] ?? 0;
          return {
            payments: {
              ...s.payments,
              [`${id}:${p}`]: {
                paidAt: new Date().toISOString(),
                ref: `sandbox-${uid()}`,
                amount,
                costName: c.name,
              },
            },
          };
        }),
      removePerson: (personId, heirId) => set((s) => opsWithoutPerson(s, personId, heirId)),
      removeEvent: (eventId) => set((s) => opsWithoutEvent(s, eventId)),
      addCampaign: (c) =>
        set((s) => ({
          campaigns: [
            { ...c, id: uid(), createdAt: new Date().toISOString(), status: "pending_send" },
            ...s.campaigns,
          ],
        })),
      setSchedule: (sch, ownerId) =>
        set((s) => ({
          schedules: [...s.schedules.filter((x) => x.ownerId !== ownerId), ...(sch ? [sch] : [])],
        })),
    }),
    {
      name: "levelup.ops",
      storage: dataStorage(),
      // Payments gained `amount` + `costName` in seed version 3; older saved
      // data is replaced by the fresh seed (like every other store).
      version: SEED_VERSION,
      migrate: () =>
        ({ ...seedOps(), payments: {}, campaigns: [], schedules: [] }) as unknown as OpsState,
    },
  ),
);

/** Invoices are derived from shared costs + payments; no card or bank data is ever stored. */
export function invoicesFor(
  costs: SharedCost[],
  payments: Record<string, Payment>,
  personId?: string,
): Invoice[] {
  const out: Invoice[] = [];
  for (const c of costs)
    for (const [p, share] of Object.entries(splitCost(c, paidShares(c, payments)))) {
      if (personId && p !== personId) continue;
      const pay = payments[`${c.id}:${p}`];
      out.push({
        id: `${c.id}:${p}`,
        costId: c.id,
        personId: p,
        amount: pay?.amount ?? share,
        costName: pay ? (pay.costName ?? c.name) : undefined,
        status: pay ? "paid" : "owed",
        paidAt: pay?.paidAt,
        paymentReference: pay?.ref,
      });
    }
  return out;
}
