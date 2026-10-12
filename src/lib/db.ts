/**
 * Single data-access layer. Every page reads/writes through these named
 * functions. Today they are backed by browser storage (Zustand + localStorage);
 * later each function can be swapped for a real backend call.
 */
import { usePeopleStore, type CrmPerson } from "@/stores/peopleStore";
import { useEventsStore } from "@/stores/eventsStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import { useSessionStore, type DemoUser } from "@/stores/sessionStore";

export const STORAGE_KEYS = [
  "levelup.people",
  "levelup.events",
  "levelup.attendance",
  "levelup.activity",
  "levelup.session",
  "levelup.crm",
  "levelup.ops",
];

/** All ids in a person's downline, including themselves (business path only). */
export function downlineIds(people: CrmPerson[], rootId: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const p of people) {
    if (p.bizClass === "customer" || !p.sponsorId) continue;
    const arr = kids.get(p.sponsorId) ?? [];
    arr.push(p.id);
    kids.set(p.sponsorId, arr);
  }
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

/**
 * Visibility rules:
 *  - candidate: only themselves
 *  - apprentice / ibo / leader: themselves + their downline
 *  - customers: only the ones the logged-in person owns (never another IBO's)
 */
export function visiblePeople(people: CrmPerson[], user: DemoUser | null): CrmPerson[] {
  if (!user) return [];
  if (user.role === "candidate") return people.filter((p) => p.id === user.personId);
  const team = downlineIds(people, user.personId);
  return people.filter((p) =>
    p.bizClass === "customer" ? p.ownerId === user.personId : team.has(p.id),
  );
}

export function visibleCustomers(people: CrmPerson[], user: DemoUser | null): CrmPerson[] {
  if (!user || user.role === "candidate") return [];
  return people.filter((p) => p.bizClass === "customer" && p.ownerId === user.personId);
}

// ---- Named accessors (non-reactive) ----
export const getSession = () => useSessionStore.getState().user;
export const getPeople = () => visiblePeople(usePeopleStore.getState().people, getSession());
export const getPerson = (id: string) => getPeople().find((p) => p.id === id);
export const getCustomers = () => visibleCustomers(usePeopleStore.getState().people, getSession());
export const savePerson = (id: string, patch: Partial<CrmPerson>) =>
  usePeopleStore.getState().update(id, patch);
export const getEvents = () => useEventsStore.getState().events;
export const getAttendances = () => useAttendanceStore.getState().attendances;

// ---- Reactive hooks ----
export function useSession() {
  return useSessionStore((s) => s.user);
}
export function useVisiblePeople(): CrmPerson[] {
  const people = usePeopleStore((s) => s.people);
  const user = useSessionStore((s) => s.user);
  return visiblePeople(people, user);
}
export function useVisibleIds(): Set<string> {
  return new Set(useVisiblePeople().map((p) => p.id));
}

/** Restore the seed dataset (keeps nobody logged in). */
export function resetDemo() {
  STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
  window.location.href = "/login";
}
