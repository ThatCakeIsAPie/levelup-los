import type { GrowthPath, MilestoneStatus } from "./types";

/**
 * Which milestones of a growth path the viewer may see. The one place that
 * decides: every surface that draws a path (the profile's row and detail, the
 * Home card's strip) takes its list from here, so none can drift.
 *
 *  - Your OWN path (`own`): every milestone you have reached or hold now
 *    (`state` held or lost, including one beyond your next, since milestones
 *    are not strictly in order) plus your NEXT milestone. Every other
 *    milestone beyond the next one is hidden: not drawn, not named, not
 *    selectable, its detail never shown. Nothing marks the gap (no
 *    placeholder, no count, no teaser): the list simply ends at the last
 *    milestone you may see. When you reach the next one, the one after it
 *    becomes the next and appears; nothing else changes.
 *  - Anyone else's path (an upline on their team, a deputy on their leader's
 *    path): everything.
 *
 * Presentation only: the milestone definitions ship in the client bundle.
 *
 * Returns the milestones in path order; each keeps its original `index` in
 * the full path (`path.nextIndex` is an original index too), so selection,
 * ids and "is this the next one" work on the visible list without remapping.
 */
export function visibleMilestones(
  path: Pick<GrowthPath, "milestones" | "nextIndex">,
  { own }: { own: boolean },
): MilestoneStatus[] {
  if (!own) return path.milestones;
  // Up to the next one is all held by definition of "next"; past it only what
  // was reached. (No next, nothing left to earn: everything is held.)
  return path.milestones.filter((m) => m.index <= path.nextIndex || m.held || m.state !== "never");
}
