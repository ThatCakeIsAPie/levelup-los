/**
 * Team settings rules (pure; mirrored by the RLS in
 * 20261014001500_unlocks_deputies_admin.sql).
 *
 *  - Only a leader names deputies, and only apprentices or IBOs in their own
 *    business downline (not themselves).
 *  - The leader removes a deputy; a deputy may step down.
 *  - Leaders and their deputies flip the team's feature switches.
 *  - No switch row means off.
 */
import type { CrmPerson } from "@/stores/peopleStore";
import type { Role } from "@/stores/sessionStore";
import { downlineIds } from "../access";
import { FEATURE_KEYS, type Deputy, type FeatureKey, type FeatureSwitch } from "./types";

/** The leaders a person is a deputy of. */
export function deputyOfIds(deputies: readonly Deputy[], personId: string): string[] {
  return deputies.filter((d) => d.deputyId === personId).map((d) => d.leaderId);
}

/** A leader's deputies, in the order they were added. */
export function deputiesOf(deputies: readonly Deputy[], leaderId: string): Deputy[] {
  return deputies.filter((d) => d.leaderId === leaderId);
}

/** Only leaders name deputies. */
export function canManageDeputies(role: Role | undefined): boolean {
  return role === "leader";
}

/** Why `deputyId` can't be named by `leaderId` (null when they can). */
export function deputyError(
  people: readonly CrmPerson[],
  deputies: readonly Deputy[],
  leader: { personId: string; role: Role },
  deputyId: string,
): string | null {
  if (!canManageDeputies(leader.role)) return "Only leaders name deputies.";
  if (deputyId === leader.personId) return "You can't be your own deputy.";
  const p = people.find((x) => x.id === deputyId);
  if (!p || !downlineIds(people as CrmPerson[], leader.personId).has(deputyId))
    return "A deputy must be on your team.";
  if (p.bizClass !== "apprentice" && p.bizClass !== "ibo")
    return "A deputy must be a registered apprentice or IBO.";
  if (deputies.some((d) => d.leaderId === leader.personId && d.deputyId === deputyId))
    return `${p.name} is already your deputy.`;
  return null;
}

/** Apprentices and IBOs on the leader's team who could be named (not already deputies). */
export function deputyCandidates(
  people: readonly CrmPerson[],
  deputies: readonly Deputy[],
  leaderId: string,
): CrmPerson[] {
  const team = downlineIds(people as CrmPerson[], leaderId);
  const taken = new Set(deputiesOf(deputies, leaderId).map((d) => d.deputyId));
  return people
    .filter(
      (p) =>
        p.id !== leaderId &&
        team.has(p.id) &&
        (p.bizClass === "apprentice" || p.bizClass === "ibo") &&
        !taken.has(p.id),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Who may flip the team's feature switches: leaders and their deputies. */
export function canEditSwitches(role: Role | undefined, deputyOf: readonly string[]): boolean {
  return role === "leader" || deputyOf.length > 0;
}

/** The team's switches as a map (no row = off). */
export function switchMap(switches: readonly FeatureSwitch[]): Record<FeatureKey, boolean> {
  const out = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Record<
    FeatureKey,
    boolean
  >;
  for (const s of switches) if (FEATURE_KEYS.includes(s.feature)) out[s.feature] = s.enabled;
  return out;
}
