/**
 * Visibility rules (pure functions, no React, no stores).
 *
 * From docs/plans/sandbox-erp-extension-plan-2026-09-25.md:
 *  - leader, ibo, apprentice: themselves + their downline on the business
 *    path, plus ONLY the customers they own (never another person's customers).
 *  - candidate: only themselves.
 *  - a leader's deputy (viewer.deputyOf): also the leader and the leader's
 *    business downline; never the leader's customers (customers stay private
 *    to their owner).
 *  - Events: everyone sees the event list; attendance rows / rosters are
 *    filtered to visible people.
 *  - A person id that is not visible behaves as "not found".
 *
 * The hooks in src/data/*.ts apply these; a future Supabase backend should
 * enforce the same rules server-side (RLS) and keep these as the client mirror.
 */
import type { CrmPerson } from "@/stores/peopleStore";
import type { Attendance } from "@/stores/attendanceStore";
import type { Role } from "@/stores/sessionStore";

/**
 * Who is looking. `null` = nobody logged in (sees nothing). `deputyOf` lists
 * the leaders this person is a deputy of (src/data/team).
 */
export type Viewer = { personId: string; role: Role; deputyOf?: readonly string[] } | null;

/** Business-path children by sponsor id (customers never have a downline). */
function childrenIndex(people: CrmPerson[]): Map<string, string[]> {
  const kids = new Map<string, string[]>();
  for (const p of people) {
    if (p.bizClass === "customer" || !p.sponsorId) continue;
    const arr = kids.get(p.sponsorId) ?? [];
    arr.push(p.id);
    kids.set(p.sponsorId, arr);
  }
  return kids;
}

/** All ids in `rootId`'s business-path downline, including `rootId` itself. */
export function downlineIds(people: CrmPerson[], rootId: string): Set<string> {
  const kids = childrenIndex(people);
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of kids.get(id) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

/** Ids of every person (business + customers) the viewer may see. */
export function visibleIdSet(people: CrmPerson[], viewer: Viewer): Set<string> {
  if (!viewer) return new Set();
  if (viewer.role === "candidate") return new Set([viewer.personId]);
  const team = downlineIds(people, viewer.personId);
  // A deputy also sees their leader and the leader's business downline.
  for (const leaderId of viewer.deputyOf ?? []) {
    for (const id of downlineIds(people, leaderId)) team.add(id);
  }
  const out = new Set<string>();
  for (const p of people) {
    if (p.bizClass === "customer" ? p.ownerId === viewer.personId : team.has(p.id)) out.add(p.id);
  }
  return out;
}

/** People (business + owned customers) the viewer may see, in roster order. */
export function visiblePeople(people: CrmPerson[], viewer: Viewer): CrmPerson[] {
  const ids = visibleIdSet(people, viewer);
  return people.filter((p) => ids.has(p.id));
}

/** Customers the viewer owns (candidates have none). */
export function visibleCustomers(people: CrmPerson[], viewer: Viewer): CrmPerson[] {
  if (!viewer || viewer.role === "candidate") return [];
  return people.filter((p) => p.bizClass === "customer" && p.ownerId === viewer.personId);
}

/** True when `id` is visible to the viewer. */
export function canSeePerson(people: CrmPerson[], viewer: Viewer, id: string): boolean {
  return visibleIdSet(people, viewer).has(id);
}

/** Attendance rows whose person is visible. */
export function filterAttendances(
  attendances: Attendance[],
  visibleIds: Set<string>,
): Attendance[] {
  return attendances.filter((a) => visibleIds.has(a.personId));
}

/**
 * Sponsor chain above `personId`, root-first, stopping at the first sponsor
 * the viewer cannot see (so an IBO never sees their upline's upline).
 * Excludes the person themselves. `max` limits how many levels are returned.
 */
export function sponsorChain(
  people: CrmPerson[],
  visibleIds: Set<string>,
  personId: string,
  max = Infinity,
): CrmPerson[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const chain: CrmPerson[] = [];
  let cur = byId.get(personId);
  const seen = new Set<string>();
  while (cur?.sponsorId && chain.length < max && !seen.has(cur.sponsorId)) {
    seen.add(cur.sponsorId);
    const sp = byId.get(cur.sponsorId);
    if (!sp || !visibleIds.has(sp.id)) break;
    chain.unshift(sp);
    cur = sp;
  }
  return chain;
}

/**
 * Business-path downline of `personId` (excluding them), filtered to visible
 * people. `directOnly` returns just their first level.
 */
export function downlineOf(
  people: CrmPerson[],
  visibleIds: Set<string>,
  personId: string,
  directOnly = false,
): CrmPerson[] {
  if (directOnly) {
    return people.filter(
      (p) => p.bizClass !== "customer" && p.sponsorId === personId && visibleIds.has(p.id),
    );
  }
  const ids = downlineIds(people, personId);
  ids.delete(personId);
  return people.filter((p) => ids.has(p.id) && visibleIds.has(p.id));
}
