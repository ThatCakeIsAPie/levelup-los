/**
 * Hooks for team settings and unlocks: who the viewer is a deputy for, the
 * team's feature switches, and what the viewer has unlocked
 * (src/data/unlocks.ts).
 */
import { useMemo } from "react";
import { usePeopleStore, effectiveBizClass, type CrmPerson } from "@/stores/peopleStore";
import { useCrmStore } from "@/stores/crmStore";
import { useSessionStore, type DemoUser } from "@/stores/sessionStore";
import { localDate } from "@/lib/dates";
import { hasEverReachedMilestone, type GrowthInput } from "../growth/engine";
import { computeUnlocks, type Unlocks } from "../unlocks";
import { useTeamStore } from "./store";
import {
  canEditSwitches,
  canManageDeputies,
  deputiesOf,
  deputyCandidates,
  deputyOfIds,
  switchMap,
} from "./rules";
import type { Deputy, FeatureKey, FeatureSwitch } from "./types";

// ---------------------------------------------------------------------------
// Milestones the unlocks need: one engine run per data change, shared by
// every component that asks.
// ---------------------------------------------------------------------------

let cache: {
  input: GrowthInput;
  personId: string;
  today: string;
  value: { firstSponsor: boolean; threeTen: boolean };
} | null = null;

function reachedFor(input: GrowthInput, personId: string) {
  const today = localDate();
  const c = cache;
  if (
    c &&
    c.personId === personId &&
    c.today === today &&
    c.input.people === input.people &&
    c.input.sales === input.sales &&
    c.input.overrides === input.overrides &&
    c.input.marks === input.marks &&
    c.input.history === input.history
  )
    return c.value;
  // Unlocks go by "ever reached", not "held now": dropping below 3/10 keeps
  // event planning (src/data/unlocks.ts).
  const value = {
    firstSponsor: hasEverReachedMilestone(input, personId, "first_sponsor", today),
    threeTen: hasEverReachedMilestone(input, personId, "3_10", today),
  };
  cache = { input, personId, today, value };
  return value;
}

function canChatAs(user: DemoUser, people: CrmPerson[]): boolean {
  if (user.role === "candidate") return false;
  const me = people.find((p) => p.id === user.personId);
  return !me || effectiveBizClass(me) !== "prospect";
}

function unlocksFor(
  user: DemoUser | null,
  input: GrowthInput,
  deputies: Deputy[],
  switches: Record<FeatureKey, boolean>,
): Unlocks {
  if (!user) {
    return computeUnlocks({
      role: "candidate",
      firstSponsor: false,
      threeTen: false,
      switches: {},
      canChat: false,
    });
  }
  const reached =
    user.role === "candidate"
      ? { firstSponsor: false, threeTen: false }
      : reachedFor(input, user.personId);
  return computeUnlocks({
    role: user.role,
    admin: !!user.admin,
    deputyOf: deputyOfIds(deputies, user.personId),
    ...reached,
    switches,
    canChat: canChatAs(user, input.people),
  });
}

/** What the signed-in person has unlocked (stage, areas, features, the next unlock). */
export function useUnlocks(): Unlocks {
  const user = useSessionStore((s) => s.user);
  const people = usePeopleStore((s) => s.people);
  const sales = useCrmStore((s) => s.sales);
  const overrides = useCrmStore((s) => s.pvOverrides);
  const marks = useCrmStore((s) => s.milestoneMarks);
  const history = useCrmStore((s) => s.milestoneHistory);
  const deputies = useTeamStore((s) => s.deputies);
  const switches = useTeamStore((s) => s.switches);
  return useMemo(
    () =>
      unlocksFor(user, { people, sales, overrides, marks, history }, deputies, switchMap(switches)),
    [user, people, sales, overrides, marks, history, deputies, switches],
  );
}

/** Non-reactive `useUnlocks` (event handlers, mutations). */
export function getUnlocks(): Unlocks {
  const crm = useCrmStore.getState();
  const team = useTeamStore.getState();
  return unlocksFor(
    useSessionStore.getState().user,
    {
      people: usePeopleStore.getState().people,
      sales: crm.sales,
      overrides: crm.pvOverrides,
      marks: crm.milestoneMarks,
      history: crm.milestoneHistory,
    },
    team.deputies,
    switchMap(team.switches),
  );
}

/** Is a phase 2/3 feature on for the viewer (the team's switch, or admin)? */
export function useFeature(key: FeatureKey): boolean {
  const admin = useSessionStore((s) => !!s.user?.admin);
  const on = useTeamStore((s) => s.switches.some((x) => x.feature === key && x.enabled));
  return admin || on;
}

/** Non-reactive `useFeature`. */
export function isFeatureOn(key: FeatureKey): boolean {
  if (useSessionStore.getState().user?.admin) return true;
  return switchMap(useTeamStore.getState().switches)[key];
}

/** The team's switches (what Team settings shows; admins see the real values here). */
export function useFeatureSwitches(): Record<FeatureKey, boolean> {
  const switches = useTeamStore((s) => s.switches);
  return useMemo(() => switchMap(switches), [switches]);
}

/** The team's switch rows (who flipped each one last, and when). */
export function useFeatureSwitchRows(): FeatureSwitch[] {
  return useTeamStore((s) => s.switches);
}

/** May the viewer flip the team's switches (leaders and their deputies)? */
export function useCanEditSwitches(): boolean {
  const user = useSessionStore((s) => s.user);
  const deputies = useTeamStore((s) => s.deputies);
  return !!user && canEditSwitches(user.role, deputyOfIds(deputies, user.personId));
}

/** The leaders the viewer is a deputy for (people they can see), for "Acting for Maria". */
export function useActingFor(): CrmPerson[] {
  const me = useSessionStore((s) => s.user?.personId ?? "");
  const deputies = useTeamStore((s) => s.deputies);
  const people = usePeopleStore((s) => s.people);
  return useMemo(() => {
    const ids = new Set(deputyOfIds(deputies, me));
    return people.filter((p) => ids.has(p.id));
  }, [deputies, people, me]);
}

export interface DeputyRow {
  deputy: Deputy;
  person: CrmPerson | undefined;
}

/**
 * The Deputies section of Team settings: the viewer's own deputies (leaders),
 * who could be added, and whether the viewer may change them.
 */
export function useDeputies(): {
  canManage: boolean;
  rows: DeputyRow[];
  candidates: CrmPerson[];
} {
  const user = useSessionStore((s) => s.user);
  const deputies = useTeamStore((s) => s.deputies);
  const people = usePeopleStore((s) => s.people);
  return useMemo(() => {
    if (!user || !canManageDeputies(user.role))
      return { canManage: false, rows: [], candidates: [] };
    const byId = new Map(people.map((p) => [p.id, p]));
    return {
      canManage: true,
      rows: deputiesOf(deputies, user.personId).map((d) => ({
        deputy: d,
        person: byId.get(d.deputyId),
      })),
      candidates: deputyCandidates(people, deputies, user.personId),
    };
  }, [user, deputies, people]);
}
