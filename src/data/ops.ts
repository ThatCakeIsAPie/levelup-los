import { useMemo } from "react";
import {
  useOpsStore,
  invoicesFor,
  paidShares,
  splitCost,
  type Campaign,
  type Invoice,
  type Logistics,
  type Payment,
  type ReportSchedule,
  type SharedCost,
} from "@/stores/opsStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useVisibleIds } from "./people";

/** Shared costs (optionally for one event). Everyone sees the cost list. */
export function useSharedCosts(eventId?: string): SharedCost[] {
  const costs = useOpsStore((s) => s.costs);
  return useMemo(
    () => (eventId ? costs.filter((c) => c.eventId === eventId) : costs),
    [costs, eventId],
  );
}

/**
 * Current share of every member of a cost, by person id. Members who already
 * paid are fixed at what they paid; the rest follows the organizer's
 * overrides, then an even split.
 */
export function useCostSplit(cost: SharedCost): Record<string, number> {
  const payments = useOpsStore((s) => s.payments);
  return useMemo(() => splitCost(cost, paidShares(cost, payments)), [cost, payments]);
}

/**
 * How to name a cost's organizer: "You", their name when the current user may
 * see them, otherwise "a team leader" (an upline outside the viewer's view).
 */
export function useCostOrganizerName(cost: SharedCost): string {
  const me = useSessionStore((s) => s.user?.personId);
  const ids = useVisibleIds();
  const name = usePeopleStore((s) =>
    ids.has(cost.ownerId) ? s.people.find((p) => p.id === cost.ownerId)?.name : undefined,
  );
  if (cost.ownerId === me) return "You";
  return name ?? "a team leader";
}

/** Invoices for the current user (derived from shared costs + sandbox payments). */
export function useMyInvoices(): Invoice[] {
  const costs = useOpsStore((s) => s.costs);
  const payments = useOpsStore((s) => s.payments);
  const me = useSessionStore((s) => s.user?.personId);
  return useMemo(() => (me ? invoicesFor(costs, payments, me) : []), [costs, payments, me]);
}

/** Invoices for every visible person (leader/team views). */
export function useVisibleInvoices(): Invoice[] {
  const costs = useOpsStore((s) => s.costs);
  const payments = useOpsStore((s) => s.payments);
  const ids = useVisibleIds();
  return useMemo(
    () => invoicesFor(costs, payments).filter((i) => ids.has(i.personId)),
    [costs, payments, ids],
  );
}

/** Travel plans for an event, keyed by personId, visible people only. */
export function useLogistics(eventId: string | undefined): Record<string, Logistics> {
  const logistics = useOpsStore((s) => s.logistics);
  const ids = useVisibleIds();
  return useMemo(() => {
    const out: Record<string, Logistics> = {};
    if (!eventId) return out;
    for (const [key, l] of Object.entries(logistics)) {
      const [e, p] = key.split(":");
      if (e === eventId && ids.has(p)) out[p] = l;
    }
    return out;
  }, [logistics, ids, eventId]);
}

/** Campaigns the current user created, newest first. */
export function useMyCampaigns(): Campaign[] {
  const campaigns = useOpsStore((s) => s.campaigns);
  const me = useSessionStore((s) => s.user?.personId);
  return useMemo(() => campaigns.filter((c) => c.ownerId === me), [campaigns, me]);
}

/** The current user's "send reports to my upline" schedule, if any. */
export function useMyReportSchedule(): ReportSchedule | undefined {
  const schedules = useOpsStore((s) => s.schedules);
  const me = useSessionStore((s) => s.user?.personId);
  return useMemo(() => schedules.find((s) => s.ownerId === me), [schedules, me]);
}

// ---- Mutations ----

/** Save a person's travel plan for an event. */
export function setLogistics(eventId: string, personId: string, l: Logistics): void {
  useOpsStore.getState().setLogistics(eventId, personId, l);
}
/** Create a shared cost (owner is auto-opted in). */
export function addSharedCost(c: Omit<SharedCost, "id" | "members" | "overrides">): void {
  useOpsStore.getState().addCost(c);
}
/** Opt a person in/out of a shared cost (no-op for a member who has already paid). */
export function toggleCostOptIn(costId: string, personId: string): void {
  useOpsStore.getState().toggleOptIn(costId, personId);
}
/** Override one person's share (null clears it; no-op once they have paid). */
export function setCostOverride(costId: string, personId: string, amount: number | null): void {
  useOpsStore.getState().setOverride(costId, personId, amount);
}
/**
 * Mark an invoice paid (sandbox only; never stores card or bank data). The
 * amount and cost name are frozen at payment time.
 */
export function paySandbox(costId: string, personId: string): void {
  useOpsStore.getState().pay(costId, personId);
}
/** Queue a campaign ("pending send" until a provider is connected). */
export function addCampaign(c: Omit<Campaign, "id" | "createdAt" | "status">): void {
  useOpsStore.getState().addCampaign(c);
}
/** Set or clear (null) the current owner's report schedule. */
export function setReportSchedule(s: ReportSchedule | null, ownerId: string): void {
  useOpsStore.getState().setSchedule(s, ownerId);
}

export { splitCost, invoicesFor };
export type { Campaign, Invoice, Logistics, Payment, ReportSchedule, SharedCost };
