/** Pure helpers for the Log sheet's pipeline fields (PipelineMoveField.tsx). */
import { bandIndex, type PipelineColumn, type ProspectPipeline } from "@/data";

/**
 * Columns after the card's current one (Registered is done from the board,
 * "Not interested" and "Do not contact" too).
 */
export function boardOptions(p: ProspectPipeline | null): PipelineColumn[] {
  if (!p?.onBoard || !p.column) return [];
  const i = p.columns.findIndex((c) => c.id === p.column!.id);
  return p.columns.slice(i + 1).filter((c) => c.id !== "registered" && c.kind !== "fixed");
}

/** The column "Booked a meeting" moves to: the pick, else the next column; null = don't move. */
export function boardTarget(p: ProspectPipeline | null, pick: string): string | null {
  const options = boardOptions(p);
  if (pick === "none" || options.length === 0) return null;
  return options.some((o) => o.id === pick) ? pick : options[0].id;
}

/** Will "Showed the plan" move this prospect to First plan? */
export const movesToPlan = (p: ProspectPipeline | null) =>
  !!p?.onBoard && !!p.column && bandIndex(p.column.band) < bandIndex("first_plan");
