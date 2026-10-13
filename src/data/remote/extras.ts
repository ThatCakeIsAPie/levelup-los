/**
 * Server-only data the browser demo doesn't need ("supabase" mode), kept in
 * memory next to the regular stores:
 *  - the chat directory (names, stages and team roles of every chat member,
 *    including people outside your CRM visibility, so authors and DM partners
 *    have names);
 *  - team-wide totals for event cards (no identities);
 *  - where loading the data stands.
 */
import { create } from "zustand";
import type { BizClass } from "@/stores/peopleStore";
import type { WorkspaceRole } from "@/data/chat/types";

export interface DirectoryEntry {
  personId: string;
  name: string;
  stage: BizClass;
  role: WorkspaceRole | null;
}

export interface RsvpCounts {
  bought: number;
  going: number;
  maybe: number;
}

/** idle: signed out / local mode; loading: first load after sign-in; ready; error. */
export type SyncPhase = "idle" | "loading" | "ready" | "error";

interface RemoteState {
  directory: DirectoryEntry[];
  /** null until loaded (local mode never loads it). */
  rsvpCounts: Record<string, RsvpCounts> | null;
  phase: SyncPhase;
}

export const useRemoteStore = create<RemoteState>()(() => ({
  directory: [],
  rsvpCounts: null,
  phase: "idle",
}));

/** Directory entries by person id (non-reactive). */
export function directoryById(): Map<string, DirectoryEntry> {
  return new Map(useRemoteStore.getState().directory.map((d) => [d.personId, d]));
}
