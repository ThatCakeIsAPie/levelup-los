import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { IS_SUPABASE } from "@/lib/config";

export type Role = "leader" | "ibo" | "apprentice" | "candidate";

export interface DemoUser {
  personId: string;
  name: string;
  role: Role;
}

export const DEMO_USERS: DemoUser[] = [
  { personId: "1", name: "Maria Reyes", role: "leader" },
  { personId: "2", name: "Anita Patel", role: "ibo" },
  { personId: "4", name: "Jamal Brown", role: "apprentice" },
  { personId: "20", name: "Beau Foster", role: "candidate" },
];

export const roleLabel: Record<Role, string> = {
  leader: "Leader",
  ibo: "IBO",
  apprentice: "Apprentice",
  candidate: "Candidate",
};

/** Team role in the workspace (separate from business stage). */
export type WorkspaceRole = "leader" | "moderator" | "member";

/**
 * Where the signed-in account stands ("supabase" mode only; local mode stays
 * "ready" and only `user` matters):
 *  - loading: restoring the saved auth session / loading the member row
 *  - signedOut: no auth session
 *  - noTeam: signed in, but no member row (signed up without an invite)
 *  - error: signed in, but the member row couldn't be loaded (network, …)
 *  - ready: signed in with a member row; `user` is set
 */
export type AuthStatus = "loading" | "signedOut" | "noTeam" | "error" | "ready";

/** The real account behind the session ("supabase" mode only). */
export interface Account {
  userId: string;
  email: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceRole?: WorkspaceRole;
}

interface SessionState {
  user: DemoUser | null;
  status: AuthStatus;
  account: Account | null;
  error: string | null;
  login: (u: DemoUser) => void;
  logout: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      status: IS_SUPABASE ? "loading" : "ready",
      account: null,
      error: null,
      login: (user) => set({ user }),
      logout: () => set({ user: null, account: null, error: null }),
    }),
    {
      // In "supabase" mode the auth client keeps its own session and the user
      // is rebuilt from the database on every start, so nothing is stored here
      // (and a demo user saved by the local build is never picked up).
      name: IS_SUPABASE ? "levelup.session.remote" : "levelup.session",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => (IS_SUPABASE ? {} : { user: s.user }),
    },
  ),
);
