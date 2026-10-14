import { useChatAccess, useFeature } from "@/data";

/**
 * Wins go to Daily wins, a chat: only for people who can chat, and only when
 * Chats is switched on for the team (or for the admin).
 */
export function useCanShareWins(): boolean {
  const { eligible } = useChatAccess();
  const chats = useFeature("chats");
  return eligible && chats;
}
