/**
 * Chat data contract (docs/plans/messaging-and-backend-plan-2026-10-12.md,
 * "Chat data contract"). Field for field the same as the Postgres tables of
 * the same names (camelCase here, snake_case there). Ids are text; timestamps
 * are ISO strings; person ids are CRM person ids. Nullable columns are `| null`
 * (never omitted) so rows round-trip through the database unchanged.
 */

/** The single demo workspace (the partner's team). */
export const WORKSPACE_ID = "w1";

export type WorkspaceRole = "leader" | "moderator" | "member";

/** `members` table. (`userId`, the auth user, exists only in the database.) */
export interface WorkspaceMember {
  workspaceId: string;
  personId: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export type ConversationKind = "announcements" | "main" | "group" | "dm";

/** `conversations` table. */
export interface Conversation {
  id: string;
  workspaceId: string;
  kind: ConversationKind;
  /** null for DMs (the other person's name is shown). */
  title: string | null;
  description: string | null;
  /** lucide icon name (kebab-case), optional. */
  icon: string | null;
  /**
   * Team chats (Announcements, Main chat, Daily wins, High signal). They start
   * pinned in everyone's list (ConversationMember.pinnedAt), and each person may
   * unpin them.
   */
  pinned: boolean;
  /** null = keep forever; otherwise messages older than this are deleted. */
  retentionDays: number | null;
  createdBy: string;
  createdAt: string;
  /** The message pinned to the top of this chat, or null. */
  pinnedMessageId: string | null;
}

export type ConversationRole = "admin" | "moderator" | "member";

/** `conversation_members` table. */
export interface ConversationMember {
  conversationId: string;
  personId: string;
  role: ConversationRole;
  lastReadAt: string | null;
  /** Muted = no unread badge and only mentions notify ("Mentions only"). */
  muted: boolean;
  joinedAt: string;
  /**
   * When this member pinned the chat to the top of their own list (null = not
   * pinned). Personal; team chats start pinned for everyone.
   */
  pinnedAt: string | null;
}

export type WinKind = "sale" | "contact" | "plan" | "ticket" | "rank" | "other";

export type LinkTargetKind = "message" | "event" | "person" | "material";

/** `messages.card` / `announcement_drafts.card` JSON. */
export type MessageCard =
  | { type: "event"; eventId: string }
  | {
      type: "win";
      winKind: WinKind;
      /** Id of the logged record (sale, contact, person, attendance, ...). */
      refId: string;
      title: string;
      detail?: string;
    }
  | { type: "learning"; learningId: string; title: string }
  | { type: "link"; target: { kind: LinkTargetKind; id: string } };

/** `messages` table. A deleted message keeps its row with `deletedAt` set and an empty body. */
export interface Message {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  replyToId: string | null;
  card: MessageCard | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export type AttachmentKind = "image" | "voice" | "file";

/** `attachments` table. `storagePath` is resolved by useAttachmentUrl(). */
export interface Attachment {
  id: string;
  messageId: string;
  kind: AttachmentKind;
  storagePath: string;
  mime: string;
  size: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

/** `reactions` table. */
export interface Reaction {
  messageId: string;
  personId: string;
  emoji: string;
  createdAt: string;
}

/** `mentions` table. */
export interface Mention {
  messageId: string;
  personId: string;
}

export type DraftStatus = "pending" | "approved" | "rejected";

/** `announcement_drafts` table. */
export interface AnnouncementDraft {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  card: MessageCard | null;
  status: DraftStatus;
  reviewerId: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export type NotificationType =
  | "mention"
  | "reply"
  | "announcement_draft"
  | "announcement_posted"
  | "report"
  | "event_post"
  | "win"
  | "checkin_logged"
  | "reaction"
  | "stat_request"
  | "stat_request_answered";

/**
 * `notifications` table. `refId` depends on the type: draft id
 * (announcement_draft), report id (report), event id (event_post), contact id
 * (checkin_logged), the emoji (reaction), the stat request id (stat_request,
 * stat_request_answered; see src/data/pipeline).
 */
export interface Notification {
  id: string;
  recipientId: string;
  type: NotificationType;
  actorId: string | null;
  conversationId: string | null;
  messageId: string | null;
  refId: string | null;
  createdAt: string;
  readAt: string | null;
}
/** Alias that doesn't shadow the DOM `Notification` type. */
export type ChatNotification = Notification;

/** `reports` table. */
export interface Report {
  id: string;
  messageId: string;
  reporterId: string;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

/** `blocks` table. */
export interface Block {
  blockerId: string;
  blockedId: string;
  createdAt: string;
}

/** Every chat table, as the browser store keeps it. */
export interface ChatData {
  members: WorkspaceMember[];
  conversations: Conversation[];
  conversationMembers: ConversationMember[];
  messages: Message[];
  attachments: Attachment[];
  reactions: Reaction[];
  mentions: Mention[];
  drafts: AnnouncementDraft[];
  notifications: Notification[];
  reports: Report[];
  blocks: Block[];
}
