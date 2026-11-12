/**
 * Real accounts only: the custom stage names set by people above the signed-in
 * person, as `effective_stage_names(false)` returns them (the nearest upline
 * who set each one, with their name). The people above you aren't all in your
 * CRM view, so the database walks the sponsor line for you. Kept in memory,
 * refreshed with the pipeline tables (src/data/remote). The demo never fills
 * it: it resolves through its own sponsor tree.
 */
import { create } from "zustand";
import type { StagePipeline } from "./rules";

export interface InheritedStageName {
  pipeline: StagePipeline;
  stage: string;
  name: string;
  fromId: string;
  fromName: string;
}

interface InheritedState {
  rows: InheritedStageName[];
}

export const useInheritedStageNames = create<InheritedState>()(() => ({ rows: [] }));
