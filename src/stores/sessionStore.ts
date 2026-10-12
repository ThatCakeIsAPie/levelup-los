import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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

interface SessionState {
  user: DemoUser | null;
  login: (u: DemoUser) => void;
  logout: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      login: (user) => set({ user }),
      logout: () => set({ user: null }),
    }),
    { name: "levelup.session", storage: createJSONStorage(() => localStorage) },
  ),
);
