/**
 * Unread counts for navigation badges (sidebar, phone tab bar), backed by the
 * chat data layer (src/data/chat).
 */
import { useUnreadConversationCount, useUnreadNotificationCount } from "./chat/hooks";

/** Number of chats with unread messages for the current user (muted chats don't count). */
export function useUnreadChatsCount(): number {
  return useUnreadConversationCount();
}

/** Number of unread notifications in the inbox for the current user. */
export function useUnreadInboxCount(): number {
  return useUnreadNotificationCount();
}
