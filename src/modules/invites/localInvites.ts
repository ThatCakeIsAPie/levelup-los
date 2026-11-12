/**
 * Person invites in the browser-storage demo: one open invite per person,
 * kept under `<prefix>.personInvites` so "Reset demo data" clears them. With
 * real accounts this store is a memory-only cache of what the database says.
 * Pages use `usePersonInvite` (./usePersonInvite), not this store.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { storageKey } from "@/lib/brand";
import { dataStorage } from "@/stores/storage";
import type { PersonInvite } from "./personRules";

export const PERSON_INVITES_STORAGE_KEY = storageKey("personInvites");

interface State {
  /** The open invite of each person (by person id). */
  invites: Record<string, PersonInvite>;
}

export const usePersonInviteStore = create<State>()(
  persist((): State => ({ invites: {} }), {
    name: PERSON_INVITES_STORAGE_KEY,
    storage: dataStorage(),
    version: 1,
    // Anything unreadable starts over empty.
    merge: (persisted, current) => {
      const raw = (persisted as Partial<State> | undefined)?.invites;
      const invites: Record<string, PersonInvite> = {};
      if (raw && typeof raw === "object") {
        for (const [id, v] of Object.entries(raw)) {
          if (v && typeof v.token === "string" && typeof v.email === "string") invites[id] = v;
        }
      }
      return { ...current, invites };
    },
  }),
);

export function setPersonInvite(personId: string, invite: PersonInvite | null): void {
  usePersonInviteStore.setState((s) => {
    const invites = { ...s.invites };
    if (invite) invites[personId] = invite;
    else delete invites[personId];
    return { invites };
  });
}

export function localToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
