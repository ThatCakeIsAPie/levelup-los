/**
 * What deleting a person or an event does to the rest of the data (pure
 * functions, no React, no stores; the stores and src/data call these).
 *
 * Deleting a person:
 *  - their direct business downline moves up to the deleted person's sponsor,
 *    so nobody drops out of their upline's view;
 *  - customers they own move to the same sponsor;
 *  - their attendance rows, travel plans and shared-cost memberships (and
 *    sandbox payments) go away; shared costs they organized pass to the sponsor.
 *
 * Deleting an event removes its attendance rows, travel plans, shared costs
 * and the sandbox payments for those costs.
 */
import type { CrmPerson } from "@/stores/peopleStore";
import type { Logistics, Payment, SharedCost } from "@/stores/opsStore";

export interface RosterRemoval {
  people: CrmPerson[];
  removed?: CrmPerson;
  /** Where the downline and customers went (the removed person's sponsor). */
  heirId: string | null;
  /** Business people whose sponsor changed. */
  moved: string[];
  /** Customers whose owner changed. */
  reassigned: string[];
}

/** The roster without `id`, with their downline and customers moved to their sponsor. */
export function rosterWithout(people: CrmPerson[], id: string): RosterRemoval {
  const removed = people.find((p) => p.id === id);
  if (!removed) return { people, heirId: null, moved: [], reassigned: [] };
  const heirId = removed.bizClass === "customer" ? null : (removed.sponsorId ?? null);
  const moved: string[] = [];
  const reassigned: string[] = [];
  const out: CrmPerson[] = [];
  for (const p of people) {
    if (p.id === id) continue;
    if (p.bizClass !== "customer" && p.sponsorId === id) {
      moved.push(p.id);
      out.push({ ...p, sponsorId: heirId });
    } else if (p.bizClass === "customer" && p.ownerId === id) {
      reassigned.push(p.id);
      out.push({ ...p, ownerId: heirId });
    } else {
      out.push(p);
    }
  }
  return { people: out, removed, heirId, moved, reassigned };
}

export interface OpsData {
  logistics: Record<string, Logistics>;
  costs: SharedCost[];
  payments: Record<string, Payment>;
}

const keyParts = (key: string) => {
  const i = key.indexOf(":");
  return [key.slice(0, i), key.slice(i + 1)] as const;
};

/**
 * Ops data without a person: their travel plans, cost memberships, share
 * overrides and payments are dropped; costs they organized pass to `heirId`
 * (left as-is when there is no heir).
 */
export function opsWithoutPerson(ops: OpsData, personId: string, heirId: string | null): OpsData {
  const logistics = Object.fromEntries(
    Object.entries(ops.logistics).filter(([k]) => keyParts(k)[1] !== personId),
  );
  const payments = Object.fromEntries(
    Object.entries(ops.payments).filter(([k]) => keyParts(k)[1] !== personId),
  );
  const costs = ops.costs.map((c) => {
    const overrides = { ...c.overrides };
    delete overrides[personId];
    // The heir only takes over managing the cost; they are not opted in.
    const ownerId = c.ownerId === personId && heirId ? heirId : c.ownerId;
    return { ...c, ownerId, members: c.members.filter((m) => m !== personId), overrides };
  });
  return { logistics, costs, payments };
}

/** Ops data without an event: its travel plans, shared costs and their payments. */
export function opsWithoutEvent(ops: OpsData, eventId: string): OpsData {
  const gone = new Set(ops.costs.filter((c) => c.eventId === eventId).map((c) => c.id));
  return {
    logistics: Object.fromEntries(
      Object.entries(ops.logistics).filter(([k]) => keyParts(k)[0] !== eventId),
    ),
    costs: ops.costs.filter((c) => !gone.has(c.id)),
    payments: Object.fromEntries(
      Object.entries(ops.payments).filter(([k]) => !gone.has(keyParts(k)[0])),
    ),
  };
}
