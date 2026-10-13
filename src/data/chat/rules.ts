/**
 * Chat rules (pure functions: no React, no stores). The database enforces the
 * same rules with row-level security and triggers; both are tested.
 * See docs/plans/messaging-and-backend-plan-2026-10-12.md, "Chat data contract".
 */
import type { BizClass } from "@/stores/peopleStore";
import type { Role } from "@/stores/sessionStore";
import type {
  Block,
  Conversation,
  ConversationMember,
  ConversationRole,
  Mention,
  Message,
  WorkspaceRole,
} from "./types";

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Window in which a reply in the other direction makes a conversation. */
export const CHECKIN_WINDOW_MS = DAY_MS;
/** Choices offered for "Message history". */
export const RETENTION_OPTIONS: (number | null)[] = [null, 30, 90, 365];

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * Chat eligibility: people whose effective stage is apprentice or IBO, plus
 * leaders. Prospects, customers and the candidate demo role have no chat.
 * `stage` must already be the effective stage (effectiveBizClass).
 */
export function isChatEligible(input: {
  stage: BizClass | undefined;
  workspaceRole?: WorkspaceRole | null;
  sessionRole?: Role;
}): boolean {
  if (input.sessionRole === "candidate") return false;
  if (input.workspaceRole === "leader" || input.sessionRole === "leader") return true;
  return input.stage === "apprentice" || input.stage === "ibo";
}

/** Leaders and workspace moderators post announcements directly. */
export function canPostAnnouncement(role: WorkspaceRole | null | undefined): boolean {
  return role === "leader" || role === "moderator";
}

/** Everyone else's announcement becomes a draft that needs approval. */
export function needsApproval(role: WorkspaceRole | null | undefined): boolean {
  return !canPostAnnouncement(role);
}

/** Who may approve or reject announcement drafts. */
export const canReviewDrafts = canPostAnnouncement;

/** Only leaders designate workspace moderators and see reports. */
export function canManageTeam(role: WorkspaceRole | null | undefined): boolean {
  return role === "leader";
}

/** Announcements, Main chat and the pinned team groups (Daily wins, High signal). */
export function isTeamChat(c: Pick<Conversation, "kind" | "pinned">): boolean {
  return c.kind === "announcements" || c.kind === "main" || (c.kind === "group" && c.pinned);
}

/**
 * May remove other people's messages: in team chats, leaders and workspace
 * moderators; in side groups, that group's admins and moderators; in DMs,
 * nobody (you can only delete your own).
 */
export function canModerate(input: {
  conversation: Pick<Conversation, "kind" | "pinned">;
  workspaceRole: WorkspaceRole | null | undefined;
  conversationRole: ConversationRole | null | undefined;
}): boolean {
  const { conversation, workspaceRole, conversationRole } = input;
  if (conversation.kind === "dm") return false;
  if (isTeamChat(conversation)) return workspaceRole === "leader" || workspaceRole === "moderator";
  return conversationRole === "admin" || conversationRole === "moderator";
}

/** Side groups only: the admin adds/removes members and promotes moderators. */
export function canManageGroup(input: {
  conversation: Pick<Conversation, "kind" | "pinned">;
  conversationRole: ConversationRole | null | undefined;
}): boolean {
  return (
    input.conversation.kind === "group" &&
    !input.conversation.pinned &&
    input.conversationRole === "admin"
  );
}

/** You may edit your own messages (not after they were deleted). */
export function canEditMessage(meId: string, m: Pick<Message, "authorId" | "deletedAt">): boolean {
  return m.authorId === meId && !m.deletedAt;
}

/** You may delete your own messages; moderators may delete anyone's. */
export function canDeleteMessage(
  meId: string,
  m: Pick<Message, "authorId" | "deletedAt">,
  moderator: boolean,
): boolean {
  return !m.deletedAt && (m.authorId === meId || moderator);
}

/** True when either person blocked the other. */
export function isBlockedBetween(blocks: Block[], a: string, b: string): boolean {
  return blocks.some(
    (x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a),
  );
}

/** Whether two people are both members of at least one conversation. */
export function shareConversation(members: ConversationMember[], a: string, b: string): boolean {
  const mine = new Set(members.filter((m) => m.personId === a).map((m) => m.conversationId));
  return members.some((m) => m.personId === b && mine.has(m.conversationId));
}

/**
 * Direct messages are allowed between two eligible people who share at least
 * one conversation and haven't blocked each other.
 */
export function canDm(
  meId: string,
  otherId: string,
  ctx: { eligibleIds: Set<string>; members: ConversationMember[]; blocks: Block[] },
): boolean {
  return (
    meId !== otherId &&
    ctx.eligibleIds.has(meId) &&
    ctx.eligibleIds.has(otherId) &&
    shareConversation(ctx.members, meId, otherId) &&
    !isBlockedBetween(ctx.blocks, meId, otherId)
  );
}

// ---------------------------------------------------------------------------
// Conversation check-in
// ---------------------------------------------------------------------------

/**
 * A conversation counts as a contact for both people: when A posts in a DM
 * (or replies to B in a group) and B posted to A in that conversation within
 * the previous 24 hours. In a group "B posted to A" means B replied to one of
 * A's messages or mentioned A. Announcements never count. Returns the pair,
 * or null. The caller enforces "at most once per pair per local day".
 */
export function conversationCheckin(input: {
  conversation: Pick<Conversation, "id" | "kind">;
  /** The message just posted. */
  message: Pick<Message, "id" | "authorId" | "replyToId" | "createdAt">;
  /** Messages of that conversation (may include the new one). */
  messages: Message[];
  /** DMs only: the other member. */
  dmPartnerId?: string | null;
  mentions?: Mention[];
}): { a: string; b: string } | null {
  const { conversation, message, messages } = input;
  if (conversation.kind === "announcements") return null;
  const a = message.authorId;
  const now = Date.parse(message.createdAt);
  const inWindow = (m: Message) => {
    const t = Date.parse(m.createdAt);
    return t <= now && now - t <= CHECKIN_WINDOW_MS;
  };
  const live = messages.filter(
    (m) => m.conversationId === conversation.id && !m.deletedAt && m.id !== message.id,
  );

  if (conversation.kind === "dm") {
    const b = input.dmPartnerId;
    if (!b || b === a) return null;
    return live.some((m) => m.authorId === b && inWindow(m)) ? { a, b } : null;
  }

  // Groups and Main chat: only a reply to B counts as A -> B.
  if (!message.replyToId) return null;
  const target = live.find((m) => m.id === message.replyToId);
  const b = target?.authorId;
  if (!b || b === a) return null;
  const byId = new Map(live.map((m) => [m.id, m]));
  const mentioned = new Set(
    (input.mentions ?? []).filter((x) => x.personId === a).map((x) => x.messageId),
  );
  const bToA = live.some(
    (m) =>
      m.authorId === b &&
      inWindow(m) &&
      ((m.replyToId && byId.get(m.replyToId)?.authorId === a) || mentioned.has(m.id)),
  );
  return bToA ? { a, b } : null;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** Whether a message is older than its conversation's retention period. */
export function isExpired(
  m: Pick<Message, "createdAt">,
  c: Pick<Conversation, "retentionDays"> | undefined,
  now: number = Date.now(),
): boolean {
  if (!c || c.retentionDays === null) return false;
  return Date.parse(m.createdAt) < now - c.retentionDays * DAY_MS;
}

/** Messages to keep after applying every conversation's retention setting. */
export function purgeExpired(
  messages: Message[],
  conversations: Pick<Conversation, "id" | "retentionDays">[],
  now: number = Date.now(),
): { keep: Message[]; removed: Set<string> } {
  const byId = new Map(conversations.map((c) => [c.id, c]));
  const keep: Message[] = [];
  const removed = new Set<string>();
  for (const m of messages) {
    if (isExpired(m, byId.get(m.conversationId), now)) removed.add(m.id);
    else keep.push(m);
  }
  return { keep, removed };
}

// ---------------------------------------------------------------------------
// Messages, mentions, unread
// ---------------------------------------------------------------------------

/**
 * Person ids mentioned as "@Full Name" in a message body (case-insensitive,
 * longest names first so "@Ann Lee" isn't read as "@Ann").
 */
export function extractMentions(body: string, people: { id: string; name: string }[]): string[] {
  const lower = body.toLowerCase();
  const sorted = [...people].sort((a, b) => b.name.length - a.name.length);
  const taken: [number, number][] = [];
  const out: string[] = [];
  for (const p of sorted) {
    const needle = `@${p.name.toLowerCase()}`;
    let i = lower.indexOf(needle);
    while (i !== -1) {
      const end = i + needle.length;
      const next = lower[end];
      const boundary = next === undefined || !/[\p{L}\p{N}]/u.test(next);
      const overlaps = taken.some(([s, e]) => i < e && end > s);
      if (boundary && !overlaps) {
        taken.push([i, end]);
        if (!out.includes(p.id)) out.push(p.id);
      }
      i = lower.indexOf(needle, i + 1);
    }
  }
  return out;
}

/** Messages from others after the member's lastReadAt (deleted ones don't count). */
export function unreadCount(
  messages: Pick<Message, "authorId" | "createdAt" | "deletedAt">[],
  member: Pick<ConversationMember, "personId" | "lastReadAt"> | undefined,
  hiddenAuthors: Set<string> = new Set(),
): number {
  if (!member) return 0;
  const since = member.lastReadAt ?? "";
  let n = 0;
  for (const m of messages) {
    if (m.deletedAt || m.authorId === member.personId || hiddenAuthors.has(m.authorId)) continue;
    if (m.createdAt > since) n++;
  }
  return n;
}

const TEAM_ORDER: Record<string, number> = { announcements: 0, main: 1, group: 2, dm: 3 };

/**
 * Chat list order: pinned team chats first (Announcements, Main chat, then the
 * pinned groups by creation), then groups and DMs by most recent activity.
 */
export function sortConversations<
  T extends { conversation: Pick<Conversation, "kind" | "pinned" | "createdAt">; lastAt: string },
>(rows: T[]): T[] {
  return [...rows].sort((x, y) => {
    const px = isTeamChat(x.conversation);
    const py = isTeamChat(y.conversation);
    if (px !== py) return px ? -1 : 1;
    if (px && py) {
      const k = TEAM_ORDER[x.conversation.kind] - TEAM_ORDER[y.conversation.kind];
      return k || x.conversation.createdAt.localeCompare(y.conversation.createdAt);
    }
    return y.lastAt.localeCompare(x.lastAt);
  });
}

/** Sponsors above a person, nearest first (people who see their wins). */
export function uplineOf(sponsorOf: Map<string, string | null | undefined>, id: string): string[] {
  const out: string[] = [];
  const seen = new Set([id]);
  let cur = sponsorOf.get(id);
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = sponsorOf.get(cur);
  }
  return out;
}

/** "dm-<a>-<b>" with ids in a stable order, so a pair has exactly one DM. */
export function dmId(a: string, b: string): string {
  return a < b ? `dm-${a}-${b}` : `dm-${b}-${a}`;
}
