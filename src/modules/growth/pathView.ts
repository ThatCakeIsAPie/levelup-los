import type { GrowthPath, MilestoneStatus } from "@/data";
import { visibleMilestones } from "@/data";

/**
 * What the path surfaces draw and how they move, as pure functions of the one
 * visibility rule (`visibleMilestones`, src/data/growth/visible.ts). Selection
 * is by a milestone's original `index` in the full path; positions are places
 * in the visible list. Nothing here ever looks at `path.milestones` directly.
 */

export type PathKey = "ArrowRight" | "ArrowLeft" | "Home" | "End";

/**
 * Where a navigation key lands: the original index of the milestone to select,
 * moving over the visible list only (clamped at both ends); null for any
 * other key. Hidden milestones are not in the list, so no key can reach them.
 */
export function pathKeyTarget(
  list: readonly MilestoneStatus[],
  selected: number,
  key: string,
): number | null {
  if (!list.length) return null;
  const at = Math.max(
    0,
    list.findIndex((m) => m.index === selected),
  );
  const to: Record<PathKey, number> = {
    ArrowRight: at + 1,
    ArrowLeft: at - 1,
    Home: 0,
    End: list.length - 1,
  };
  if (!(key in to)) return null;
  return list[Math.max(0, Math.min(list.length - 1, to[key as PathKey]))].index;
}

/**
 * The profile row: the milestones to draw, the place of the next one (the
 * progress line fills up to it; the whole row when there is none) and the
 * selected one (the given index when it is drawn, else the next, else the
 * last).
 */
export function pathRowView(
  path: GrowthPath,
  { own, selected }: { own: boolean; selected: number },
) {
  const list = visibleMilestones(path, { own });
  const nextAt = list.findIndex((m) => m.index === path.nextIndex);
  const fillAt = nextAt === -1 ? list.length - 1 : nextAt;
  const status = list.find((m) => m.index === selected) ?? list[fillAt];
  return { list, fillAt, status };
}

/**
 * Home's strip around the next milestone: up to two steps behind it and two
 * ahead, from the visible list only (so ahead of the next one there are only
 * milestones already reached).
 */
export function homeStrip(path: GrowthPath): MilestoneStatus[] {
  const list = visibleMilestones(path, { own: true });
  const at = list.findIndex((m) => m.index === path.nextIndex);
  if (at === -1) return [];
  return list.slice(Math.max(0, at - 2), at + 3);
}
