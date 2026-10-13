import { useMemo } from "react";
import { usePeopleStore, type CrmPerson, type LosSyncEntry } from "@/stores/peopleStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import { useOpsStore } from "@/stores/opsStore";
import { downlineOf, sponsorChain, visibleCustomers, visibleIdSet, type Viewer } from "./access";
import { getViewer, useViewer } from "./session";

// One shared computation per (people, viewer) pair, so many components calling
// useVisibleIds() in the same render don't each walk the tree.
let cache: { people: CrmPerson[]; viewer: Viewer; ids: Set<string> } | null = null;
function cachedVisibleIds(people: CrmPerson[], viewer: Viewer): Set<string> {
  if (cache && cache.people === people && cache.viewer === viewer) return cache.ids;
  const ids = visibleIdSet(people, viewer);
  cache = { people, viewer, ids };
  return ids;
}

/** Ids of everyone the current user may see (business people + own customers). */
export function useVisibleIds(): Set<string> {
  const people = usePeopleStore((s) => s.people);
  const viewer = useViewer();
  return cachedVisibleIds(people, viewer);
}

/** Everyone the current user may see: self, business downline, own customers. */
export function useVisiblePeople(): CrmPerson[] {
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  return useMemo(() => people.filter((p) => ids.has(p.id)), [people, ids]);
}

/** Visible business-path people only (no customers). */
export function useVisibleTeam(): CrmPerson[] {
  const visible = useVisiblePeople();
  return useMemo(() => visible.filter((p) => p.bizClass !== "customer"), [visible]);
}

/** One person, or undefined when missing OR not visible (treat both as "not found"). */
export function usePerson(id: string | undefined): CrmPerson | undefined {
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  return useMemo(
    () => (id && ids.has(id) ? people.find((p) => p.id === id) : undefined),
    [people, ids, id],
  );
}

/** Customers the current user owns, highest monthly volume first. */
export function useVisibleCustomers(): CrmPerson[] {
  const people = usePeopleStore((s) => s.people);
  const viewer = useViewer();
  return useMemo(
    () =>
      visibleCustomers(people, viewer).sort(
        (a, b) => (b.monthlyVolume ?? 0) - (a.monthlyVolume ?? 0),
      ),
    [people, viewer],
  );
}

/**
 * Customers owned by `personId` that the current user may see. Because users
 * only see their own customers, this is empty for anyone but the current user.
 * Use useCustomerCounts() for team-level numbers.
 */
export function useCustomersOf(personId: string | undefined): CrmPerson[] {
  const customers = useVisibleCustomers();
  return useMemo(
    () => (personId ? customers.filter((c) => c.ownerId === personId) : []),
    [customers, personId],
  );
}

/**
 * Number of customers owned by each visible business person (aggregate only;
 * no customer identities). Keys are owner person ids.
 */
export function useCustomerCounts(): Record<string, number> {
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of people) {
      if (p.bizClass === "customer" && p.ownerId && ids.has(p.ownerId)) {
        out[p.ownerId] = (out[p.ownerId] ?? 0) + 1;
      }
    }
    return out;
  }, [people, ids]);
}

/**
 * Sponsors above `personId`, root-first, limited to people the current user
 * may see (so it stops at the viewer). Empty if the person is not visible.
 */
export function useSponsorChain(personId: string | undefined, max?: number): CrmPerson[] {
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  return useMemo(
    () => (personId && ids.has(personId) ? sponsorChain(people, ids, personId, max) : []),
    [people, ids, personId, max],
  );
}

/**
 * Business-path downline of `personId` (not including them), visible people
 * only. Pass `{ directOnly: true }` for the first level.
 */
export function useDownline(
  personId: string | undefined,
  opts: { directOnly?: boolean } = {},
): CrmPerson[] {
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  const directOnly = !!opts.directOnly;
  return useMemo(
    () => (personId && ids.has(personId) ? downlineOf(people, ids, personId, directOnly) : []),
    [people, ids, personId, directOnly],
  );
}

/**
 * Non-reactive lookup for code outside React (e.g. a route loader building the
 * page title): the person, or undefined when missing or not visible.
 */
export function getPerson(id: string): CrmPerson | undefined {
  const people = usePeopleStore.getState().people;
  return visibleIdSet(people, getViewer()).has(id) ? people.find((p) => p.id === id) : undefined;
}

// ---- Mutations ----

/** Add a person (business or customer). Logs to the activity timeline. */
export function addPerson(p: Omit<CrmPerson, "id"> & { id?: string }): CrmPerson {
  return usePeopleStore.getState().add(p);
}

/** Patch a person. Stage changes are recorded in stageHistory + activity. */
export function updatePerson(id: string, patch: Partial<CrmPerson>): void {
  usePeopleStore.getState().update(id, patch);
}

/**
 * Delete a person. Their direct downline and any customers they own move to
 * their sponsor (so nobody drops out of view); their attendance rows, travel
 * plans and shared-cost memberships are removed, and shared costs they
 * organized pass to that sponsor. Rules: src/data/cascade.ts.
 */
export function removePerson(id: string): void {
  if (!usePeopleStore.getState().getById(id)) return;
  const heirId = usePeopleStore.getState().remove(id);
  useAttendanceStore.getState().removeWhere((a) => a.personId === id);
  useOpsStore.getState().removePerson(id, heirId);
}

// ---- Mind map sync (non-reactive; used by the mind map's tree store) ----

/**
 * Upsert mind-map members into the roster: match by losUid, then by a unique
 * unclaimed name, else create (rules in src/data/losSync.ts).
 */
export function syncPeopleFromLos(entries: LosSyncEntry[]): void {
  usePeopleStore.getState().syncFromLos(entries);
}

/** The roster person linked to a mind-map uid, if any (not visibility-filtered). */
export function getPersonByLosUid(uid: string): CrmPerson | undefined {
  return usePeopleStore.getState().getByLosUid(uid);
}
