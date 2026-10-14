/**
 * Team settings writes. In the demo the store change is the save; with real
 * accounts the sync engine writes `deputies` and `feature_switches` (RLS
 * checks the same rules and stamps who made the change).
 */
import { usePeopleStore } from "@/stores/peopleStore";
import { useSessionStore } from "@/stores/sessionStore";
import { WORKSPACE_ID } from "../chat/types";
import { useTeamStore } from "./store";
import { canEditSwitches, deputyError, deputyOfIds } from "./rules";
import type { FeatureKey } from "./types";

const user = () => useSessionStore.getState().user;

/** Name a deputy (leaders only). Returns an error message, or null when added. */
export function addDeputy(deputyId: string): string | null {
  const u = user();
  if (!u) return "Sign in first.";
  const { deputies } = useTeamStore.getState();
  const err = deputyError(usePeopleStore.getState().people, deputies, u, deputyId);
  if (err) return err;
  useTeamStore.setState({
    deputies: [
      ...deputies,
      { leaderId: u.personId, deputyId, addedBy: u.personId, addedAt: new Date().toISOString() },
    ],
  });
  return null;
}

/** Remove a deputy: the leader does, or the deputy steps down. False when not allowed. */
export function removeDeputy(leaderId: string, deputyId: string): boolean {
  const u = user();
  if (!u) return false;
  const allowed = (u.personId === leaderId && u.role === "leader") || u.personId === deputyId;
  if (!allowed) return false;
  const { deputies } = useTeamStore.getState();
  useTeamStore.setState({
    deputies: deputies.filter((d) => !(d.leaderId === leaderId && d.deputyId === deputyId)),
  });
  return true;
}

/** Switch a feature on or off for the whole team (leaders and their deputies). */
export function setFeatureSwitch(feature: FeatureKey, enabled: boolean): boolean {
  const u = user();
  if (!u) return false;
  const { deputies, switches } = useTeamStore.getState();
  if (!canEditSwitches(u.role, deputyOfIds(deputies, u.personId))) return false;
  const workspaceId = useSessionStore.getState().account?.workspaceId ?? WORKSPACE_ID;
  const row = {
    workspaceId,
    feature,
    enabled,
    updatedBy: u.personId,
    updatedAt: new Date().toISOString(),
  };
  const i = switches.findIndex((s) => s.feature === feature);
  useTeamStore.setState({
    switches: i === -1 ? [...switches, row] : switches.map((s, j) => (j === i ? row : s)),
  });
  return true;
}
