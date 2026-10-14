import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { IS_SUPABASE, storageKey } from "@/lib/config";

export type Role = "leader" | "ibo" | "apprentice" | "candidate";

export interface DemoUser {
  personId: string;
  name: string;
  role: Role;
  /**
   * The admin ("experimental") account: every feature regardless of the
   * team's switches, plus a debug card in Settings. With real accounts this
   * comes from the database (`is_app_admin()`), never from the client.
   */
  admin?: boolean;
  /** Demo picker only: a label and a line on what this login shows. */
  label?: string;
  sees?: string;
}

/**
 * The demo cast (docs/frontend-guide.md "Seed data"): one login per unlock
 * stage, a deputy and the admin.
 */
export const DEMO_USERS: DemoUser[] = [
  {
    personId: "1",
    name: "Maria Reyes",
    role: "leader",
    sees: "sees everything: the whole team, team settings and targets",
  },
  {
    personId: "2",
    name: "Anita Patel",
    role: "ibo",
    label: "IBO · 3/10",
    sees: "her team, the recruiting pipeline and event planning",
  },
  {
    personId: "4",
    name: "Jamal Brown",
    role: "apprentice",
    label: "Apprentice · first sponsor",
    sees: "his team, the recruiting pipeline and reports; attends events",
  },
  {
    personId: "700",
    name: "Tasha Greene",
    role: "apprentice",
    label: "New apprentice",
    sees: "just the basics: customers, learning, events and wallet",
  },
  {
    personId: "6",
    name: "Marcus Hill",
    role: "ibo",
    label: "IBO · Maria's deputy",
    sees: "everything Maria sees, acting for her",
  },
  { personId: "20", name: "Beau Foster", role: "candidate" },
  {
    personId: "800",
    name: "Admin Tester",
    role: "ibo",
    admin: true,
    label: "Admin",
    sees: "every feature, switched on or not, plus debug tools",
  },
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
      name: storageKey(IS_SUPABASE ? "session.remote" : "session"),
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => (IS_SUPABASE ? {} : { user: s.user }),
    },
  ),
);
