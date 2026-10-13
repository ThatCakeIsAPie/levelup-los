import { useMemo } from "react";
import { useSessionStore, type DemoUser } from "@/stores/sessionStore";
import { usePeopleStore, type CrmPerson } from "@/stores/peopleStore";
import { IS_SUPABASE } from "@/lib/config";
import { signOut } from "@/modules/login/auth";
import type { Viewer } from "./access";
import { useTeamStore } from "./team/store";
import { deputyOfIds } from "./team/rules";

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

/** Build the viewer for the access rules (with the leaders they deputize for). */
function viewerOf(user: DemoUser | null, deputyOf: string[]): Viewer {
  if (!user) return null;
  return deputyOf.length
    ? { personId: user.personId, role: user.role, deputyOf }
    : { personId: user.personId, role: user.role };
}

/** The leaders the signed-in person is a deputy of (stable string key for memos). */
function useDeputyOfKey(): string {
  const me = useSessionStore((s) => s.user?.personId ?? "");
  return useTeamStore((s) => (me ? deputyOfIds(s.deputies, me).sort().join(",") : ""));
}

/** Viewer for the pure access rules (stable while the session and deputies are unchanged). */
export function useViewer(): Viewer {
  const user = useSessionStore((s) => s.user);
  const key = useDeputyOfKey();
  return useMemo(() => viewerOf(user, key ? key.split(",") : []), [user, key]);
}

/** Non-reactive viewer, for use inside event handlers / mutations. */
export function getViewer(): Viewer {
  const user = useSessionStore.getState().user;
  const deputyOf = user ? deputyOfIds(useTeamStore.getState().deputies, user.personId) : [];
  return viewerOf(user, deputyOf);
}

/** Log in as a demo user (local mode; real accounts sign in on the login page). */
export function login(user: DemoUser): void {
  useSessionStore.getState().login(user);
}

/**
 * Log out (the SessionGate then redirects to /login). With real accounts this
 * signs out of Supabase on this device.
 */
export function logout(): void {
  if (IS_SUPABASE) {
    void signOut();
    return;
  }
  useSessionStore.getState().logout();
}

/**
 * Wipe every `levelup.*` localStorage key (all stores, session and theme) and
 * reload at /login, which re-seeds everything relative to today.
 *
 * Demo only: with real accounts ("supabase" mode) this does nothing; check
 * `IS_LOCAL_DEMO` from `@/lib/config` to hide the control.
 */
export function resetDemo(): void {
  if (IS_SUPABASE) {
    console.warn("resetDemo() is only available in the browser-storage demo.");
    return;
  }
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
  window.location.assign(`${import.meta.env.BASE_URL}login`);
}
