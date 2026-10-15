import { useEffect, useMemo } from "react";
import { useCrmStore } from "@/stores/crmStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { useSessionStore } from "@/stores/sessionStore";
import { localDate } from "@/lib/dates";
import { visibleIdSet, type Viewer } from "../access";
import { getViewer, useViewer } from "../session";
import { useVisibleIds } from "../people";
import {
  growthPath,
  hasEverReachedMilestone,
  isMilestoneHeld,
  monthOfDate,
  monthPv,
  type GrowthInput,
} from "./engine";
import { recordMilestoneHistory } from "./mutations";
import type { GrowthMilestoneCode, GrowthPath, PvOverride } from "./types";

/** Everything the engine reads, from the stores (non-reactive). */
function currentInput(): GrowthInput {
  const crm = useCrmStore.getState();
  return {
    people: usePeopleStore.getState().people,
    sales: crm.sales,
    overrides: crm.pvOverrides,
    marks: crm.milestoneMarks,
    history: crm.milestoneHistory,
  };
}

function useGrowthInput(): GrowthInput {
  const people = usePeopleStore((s) => s.people);
  const sales = useCrmStore((s) => s.sales);
  const overrides = useCrmStore((s) => s.pvOverrides);
  const marks = useCrmStore((s) => s.milestoneMarks);
  const history = useCrmStore((s) => s.milestoneHistory);
  return useMemo(
    () => ({ people, sales, overrides, marks, history }),
    [people, sales, overrides, marks, history],
  );
}

/**
 * A person's growth path (milestones reached with dates and how long each
 * took, the next one with live progress, this month's PV). Undefined when the
 * person is missing or not visible.
 */
export function useGrowthPath(personId: string | undefined): GrowthPath | undefined {
  const input = useGrowthInput();
  const ids = useVisibleIds();
  const today = localDate();
  return useMemo(
    () => (personId && ids.has(personId) ? growthPath(input, personId, today) : undefined),
    [input, ids, personId, today],
  );
}

/** The signed-in person's own growth path. */
export function useMyGrowthPath(): GrowthPath | undefined {
  const me = useSessionStore((s) => s.user?.personId);
  return useGrowthPath(me);
}

/** Non-reactive `useGrowthPath` (route loaders, event handlers). */
export function getGrowthPath(personId: string): GrowthPath | undefined {
  const input = currentInput();
  if (!visibleIdSet(input.people, getViewer()).has(personId)) return undefined;
  return growthPath(input, personId, localDate());
}

/**
 * True once the person has ever reached the milestone (from the data, the
 * recorded history or a hand mark), whether or not it's held now
 * (non-reactive). False for anyone the viewer can't see. For unlocks:
 * `hasEverReached(me, "first_sponsor")`, `hasEverReached(me, "3_10")`
 * (dropping below 3/10 keeps event planning).
 */
export function hasEverReached(personId: string, code: GrowthMilestoneCode): boolean {
  const input = currentInput();
  if (!visibleIdSet(input.people, getViewer()).has(personId)) return false;
  return hasEverReachedMilestone(input, personId, code, localDate());
}

/** Reactive `hasEverReached`. */
export function useHasEverReached(
  personId: string | undefined,
  code: GrowthMilestoneCode,
): boolean {
  const path = useGrowthPath(personId);
  return !!path?.milestones.find((m) => m.code === code)?.firstReachedOn;
}

/**
 * True when the milestone is held today: checked on the path (permanent once
 * reached, live while the numbers meet it, monthly when met this month or
 * last). Non-reactive; false for anyone the viewer can't see.
 */
export function isHeld(personId: string, code: GrowthMilestoneCode): boolean {
  const input = currentInput();
  if (!visibleIdSet(input.people, getViewer()).has(personId)) return false;
  return isMilestoneHeld(input, personId, code, localDate());
}

/** Reactive `isHeld`. */
export function useIsHeld(personId: string | undefined, code: GrowthMilestoneCode): boolean {
  const path = useGrowthPath(personId);
  return !!path?.milestones.find((m) => m.code === code)?.held;
}

/**
 * Keeps the milestone history up to date for the signed-in person and the
 * team they coach: mount once (the app shell). Writes only when the data
 * shows something new (see `recordMilestoneHistory`).
 */
export function useRecordMilestoneHistory(): void {
  const input = useGrowthInput();
  const ids = useVisibleIds();
  const viewer = useViewer();
  const today = localDate();
  useEffect(() => {
    if (!viewer || viewer.role === "candidate") return;
    recordMilestoneHistory();
  }, [input, ids, viewer, today]);
}

/** One month's PV for a person: the logged total, the upline's figure (if any) and what counts. */
export function useMonthPv(
  personId: string | undefined,
  month: string,
): { logged: number; override: PvOverride | null; pv: number } {
  const input = useGrowthInput();
  const today = localDate();
  return useMemo(
    () =>
      personId ? monthPv(input, personId, month, today) : { logged: 0, override: null, pv: 0 },
    [input, personId, month, today],
  );
}

/**
 * Everyone's PV for the current month (logged sales, or the upline's figure),
 * by person id. Same numbers as each growth path's "PV this month".
 */
export function useMonthPvById(): Map<string, number> {
  const input = useGrowthInput();
  const today = localDate();
  return useMemo(() => {
    const month = monthOfDate(today);
    return new Map(input.people.map((p) => [p.id, monthPv(input, p.id, month, today).pv]));
  }, [input, today]);
}

/**
 * An upline of the person: they're in the viewer's business downline, and not
 * the viewer. A deputy coaches their leader's team, but not the leader.
 */
export function isUplineOf(
  people: { id: string; bizClass: string }[],
  visible: Set<string>,
  viewer: Viewer,
  personId: string,
): boolean {
  if (!viewer || viewer.role === "candidate" || viewer.personId === personId) return false;
  if (viewer.deputyOf?.includes(personId)) return false;
  const p = people.find((x) => x.id === personId);
  return !!p && p.bizClass !== "customer" && visible.has(personId);
}

/**
 * The viewer may set this person's monthly PV and mark their milestones:
 * they're on the viewer's team (an upline is anyone above them).
 */
export function useCanCoach(personId: string | undefined): boolean {
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  const viewer = useViewer();
  return !!personId && isUplineOf(people, ids, viewer, personId);
}

/** Non-reactive `useCanCoach`. */
export function canCoach(personId: string): boolean {
  const people = usePeopleStore.getState().people;
  const viewer = getViewer();
  return isUplineOf(people, visibleIdSet(people, viewer), viewer, personId);
}
