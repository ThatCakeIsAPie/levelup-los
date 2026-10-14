/**
 * What only the database knows about the library ("supabase" mode; empty in
 * the browser-storage demo, where the hooks work these out from the store):
 *  - teasers: "IBOs and leaders" channels you can't open yet (listed locked),
 *    from library_channel_teasers();
 *  - names: people behind what you can see (speakers, creators) who aren't in
 *    your CRM view or chat directory, from the library_people view.
 * Not persisted; filled by src/data/remote/hydrate.ts.
 */
import { create } from "zustand";
import type { ChannelColor } from "./types";

export interface ChannelTeaser {
  id: string;
  title: string;
  description: string | null;
  icon: string;
  color: ChannelColor;
  createdBy: string;
  lessonCount: number;
  createdAt: string;
}

export interface LibraryExtras {
  teasers: ChannelTeaser[];
  /** person id -> name */
  names: Record<string, string>;
}

export const useLibraryExtras = create<LibraryExtras>()(() => ({ teasers: [], names: {} }));
