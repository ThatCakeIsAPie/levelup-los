/**
 * Unread counts for navigation badges (sidebar, phone tab bar), backed by the
 * chat data layer (src/data/chat).
 */
import { useMemo } from "react";
import {
  useNotifications,
  useUnreadConversationCount,
  useUnreadNotificationCount,
} from "./chat/hooks";
import { usePendingStatRequests } from "./pipeline/hooks";

/** Number of chats with unread messages for the current user (muted chats don't count). */
export function useUnreadChatsCount(): number {
  return useUnreadConversationCount();
}

/**
 * Number of unread notifications in the inbox for the current user, plus
 * requests to see their pipeline numbers that still wait for an answer (even
 * after the notification was read).
 */
export function useUnreadInboxCount(): number {
  const unread = useUnreadNotificationCount();
  const pending = usePendingStatRequests();
  const notes = useNotifications();
  return useMemo(() => {
    const unreadRefs = new Set(
      notes.filter((n) => n.type === "stat_request" && !n.readAt).map((n) => n.refId),
    );
    return unread + pending.filter((r) => !unreadRefs.has(r.id)).length;
  }, [unread, pending, notes]);
}
