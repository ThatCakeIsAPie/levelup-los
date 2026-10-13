import { effectiveBizClass, useCurrentUser, useMe } from "@/data";

/**
 * What the navigation shows for the current user.
 * - canChat: candidates (the demo candidate role) and anyone whose effective
 *   stage is prospect don't get Chats; they get the Inbox in its place.
 * - canManageTeam: Team settings (/settings/team). Leaders for now; workspace
 *   moderators join when the chat backend knows about them.
 */
export function useNavAccess() {
  const user = useCurrentUser();
  const me = useMe();
  const isCandidate = user.role === "candidate";
  const prospect = !!me && effectiveBizClass(me) === "prospect";
  return {
    isCandidate,
    canChat: !isCandidate && !prospect,
    canManageTeam: user.role === "leader",
  };
}

/** "99+" for big counts. */
export const badgeText = (n: number) => (n > 99 ? "99+" : String(n));
