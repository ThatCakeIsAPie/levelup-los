import { useMemo } from "react";
import { useSessionStore, type DemoUser } from "@/stores/sessionStore";
import { usePeopleStore, type CrmPerson } from "@/stores/peopleStore";
import type { Viewer } from "./access";

/** The logged-in demo user, or null on the login page. */
export function useSession(): DemoUser | null {
  return useSessionStore((s) => s.user);
}

/**
 * The logged-in user inside the app shell. Every route except /login is gated
 * by SessionGate, so pages can rely on this being non-null.
 */
export function useCurrentUser(): DemoUser {
  const user = useSessionStore((s) => s.user);
  if (!user) throw new Error("useCurrentUser() called without a session (outside the gate?)");
  return user;
}

/** The logged-in user's own person record. */
export function useMe(): CrmPerson | undefined {
  const user = useSessionStore((s) => s.user);
  const people = usePeopleStore((s) => s.people);
  return useMemo(() => people.find((p) => p.id === user?.personId), [people, user]);
}

/** Viewer for the pure access rules (stable while the session is unchanged). */
export function useViewer(): Viewer {
  const user = useSessionStore((s) => s.user);
  return useMemo(() => (user ? { personId: user.personId, role: user.role } : null), [user]);
}

/** Non-reactive viewer, for use inside event handlers / mutations. */
export function getViewer(): Viewer {
  const user = useSessionStore.getState().user;
  return user ? { personId: user.personId, role: user.role } : null;
}

/** Log in as a demo user. */
export function login(user: DemoUser): void {
  useSessionStore.getState().login(user);
}

/** Log out (the SessionGate then redirects to /login). */
export function logout(): void {
  useSessionStore.getState().logout();
}

/**
 * Wipe every `levelup.*` localStorage key (all stores, session and theme) and
 * reload at /login, which re-seeds everything relative to today.
 */
export function resetDemo(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("levelup.")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Storage unavailable: a reload still resets in-memory state.
  }
  window.location.assign("/login");
}
