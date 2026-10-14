import { useUnlocks, type Unlocks } from "@/data";

/**
 * What the navigation shows for the current user, from what they've
 * unlocked (src/data/unlocks.ts):
 * - canChat: Chats is switched on for the team (or the admin) and the person
 *   can chat (not a candidate or prospect).
 * - canManageTeam: Team settings (/settings/team): leaders, their deputies
 *   and the admin.
 * - starter: the new apprentice's shell (until First sponsor): a short
 *   sidebar and the Home · Customers · + · Events · Me phone tabs.
 */
export function useNavAccess(): {
  unlocks: Unlocks;
  isCandidate: boolean;
  canChat: boolean;
  canManageTeam: boolean;
  starter: boolean;
} {
  const unlocks = useUnlocks();
  return {
    unlocks,
    isCandidate: unlocks.stage === "candidate",
    canChat: unlocks.can.chats,
    canManageTeam: unlocks.can.teamSettings,
    starter: unlocks.stage === "new_apprentice" && !unlocks.admin,
  };
}

/** "99+" for big counts. */
export const badgeText = (n: number) => (n > 99 ? "99+" : String(n));
