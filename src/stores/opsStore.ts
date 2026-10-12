import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface Logistics {
  ticket: "bought" | "planned"; planDate?: string;
  mode: "fly" | "drive"; flightBooked?: boolean;
  carpool: "teammate" | "other_team" | "solo" | "van";
  vanPaid?: "yes" | "no" | "planned"; vanPayDate?: string;
}
export interface SharedCost { id: string; eventId: string; name: string; total: number; ownerId: string; members: string[]; overrides: Record<string, number> }
export interface Invoice { id: string; costId: string; personId: string; amount: number; status: "owed" | "paid"; paidAt?: string; paymentReference?: string }
export interface Campaign { id: string; ownerId: string; kind: "email" | "text" | "voice"; message: string; recipients: string[]; scheduledFor?: string; createdAt: string; status: "pending_send" }
export interface ReportSchedule { ownerId: string; frequency: "weekly" | "monthly" }

const uid = () => Math.random().toString(36).slice(2, 10);

export function splitCost(c: SharedCost): Record<string, number> {
  const fixed = Object.entries(c.overrides).filter(([p]) => c.members.includes(p));
  const fixedSum = fixed.reduce((s, [, v]) => s + v, 0);
  const rest = c.members.filter((m) => !(m in c.overrides));
  const each = rest.length ? Math.round(((c.total - fixedSum) / rest.length) * 100) / 100 : 0;
  return Object.fromEntries(c.members.map((m) => [m, m in c.overrides ? c.overrides[m] : each]));
}

interface OpsState {
  logistics: Record<string, Logistics>; // key `${eventId}:${personId}`
  costs: SharedCost[];
  payments: Record<string, { paidAt: string; ref: string }>; // key `${costId}:${personId}`
  campaigns: Campaign[];
  schedules: ReportSchedule[];
  setLogistics: (eventId: string, personId: string, l: Logistics) => void;
  addCost: (c: Omit<SharedCost, "id" | "members" | "overrides">) => void;
  toggleOptIn: (costId: string, personId: string) => void;
  setOverride: (costId: string, personId: string, amount: number | null) => void;
  pay: (costId: string, personId: string) => void;
  addCampaign: (c: Omit<Campaign, "id" | "createdAt" | "status">) => void;
  setSchedule: (s: ReportSchedule | null, ownerId: string) => void;
}

export const useOpsStore = create<OpsState>()(persist((set) => ({
  logistics: {
    "e1:2": { ticket: "bought", mode: "fly", flightBooked: true, carpool: "solo" },
    "e1:4": { ticket: "planned", planDate: "2026-10-20", mode: "drive", carpool: "van", vanPaid: "planned", vanPayDate: "2026-10-25" },
  },
  costs: [{ id: "sc1", eventId: "e1", name: "Team van rental", total: 600, ownerId: "1", members: ["1", "2", "4"], overrides: {} }],
  payments: {},
  campaigns: [],
  schedules: [],
  setLogistics: (e, p, l) => set((s) => ({ logistics: { ...s.logistics, [`${e}:${p}`]: l } })),
  addCost: (c) => set((s) => ({ costs: [...s.costs, { ...c, id: uid(), members: [c.ownerId], overrides: {} }] })),
  toggleOptIn: (id, p) => set((s) => ({ costs: s.costs.map((c) => c.id !== id ? c : { ...c, members: c.members.includes(p) ? c.members.filter((m) => m !== p) : [...c.members, p] }) })),
  setOverride: (id, p, amt) => set((s) => ({ costs: s.costs.map((c) => { if (c.id !== id) return c; const o = { ...c.overrides }; if (amt === null) delete o[p]; else o[p] = amt; return { ...c, overrides: o }; }) })),
  pay: (id, p) => set((s) => ({ payments: { ...s.payments, [`${id}:${p}`]: { paidAt: new Date().toISOString(), ref: `sandbox-${uid()}` } } })),
  addCampaign: (c) => set((s) => ({ campaigns: [{ ...c, id: uid(), createdAt: new Date().toISOString(), status: "pending_send" }, ...s.campaigns] })),
  setSchedule: (sch, ownerId) => set((s) => ({ schedules: [...s.schedules.filter((x) => x.ownerId !== ownerId), ...(sch ? [sch] : [])] })),
}), { name: "levelup.ops", storage: createJSONStorage(() => localStorage) }));

/** Invoices are derived from shared costs + payments; no card or bank data is ever stored. */
export function invoicesFor(costs: SharedCost[], payments: OpsState["payments"], personId?: string): Invoice[] {
  const out: Invoice[] = [];
  for (const c of costs) for (const [p, amount] of Object.entries(splitCost(c))) {
    if (personId && p !== personId) continue;
    const pay = payments[`${c.id}:${p}`];
    out.push({ id: `${c.id}:${p}`, costId: c.id, personId: p, amount, status: pay ? "paid" : "owed", paidAt: pay?.paidAt, paymentReference: pay?.ref });
  }
  return out;
}
