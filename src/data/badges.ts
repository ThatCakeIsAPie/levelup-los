/**
 * Unread counts for navigation badges (sidebar, phone tab bar).
 * Placeholder returning 0 — the chat feature replaces these implementations
 * without changing the signatures.
 */

/** Number of chats with unread messages for the current user. */
export function useUnreadChatsCount(): number {
  return 0;
}

/** Number of unread notifications in the inbox for the current user. */
export function useUnreadInboxCount(): number {
  return 0;
}
