/**
 * Chat read hooks. Everything returned is something the current user may
 * see: conversations they belong to (leaders never see other people's DMs),
 * their own notifications, and the report queue only for leaders.
 */
import { useEffect, useMemo } from "react";
import { usePeopleStore, effectiveBizClass, type BizClass } from "@/stores/peopleStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useAttendanceStore, type Attendance } from "@/stores/attendanceStore";
import { useEventsStore, type CrmEvent } from "@/stores/eventsStore";
import { useCrmStore } from "@/stores/crmStore";
import { visibleIdSet } from "../access";
import { getViewer } from "../session";
import { useChatStore, chat } from "./store";
import { chatPersonName } from "./people";
import { useRemoteStore } from "@/data/remote/extras";
import { IS_SUPABASE } from "@/lib/config";
import {
  canDm,
  canModerate,
  canReviewDrafts,
  chatTab,
  isChatEligible,
  isExpired,
  isTeamChat,
  sortConversations,
  unreadCount,
  type ChatTab,
} from "./rules";
import type {
  AnnouncementDraft,
  Attachment,
  Conversation,
  ConversationMember,
  ConversationRole,
  LibraryItem,
  Message,
  MessageCard,
  Notification,
  Report,
  WorkspaceRole,
} from "./types";
import { joinWorkspace } from "./mutations";

// ---------------------------------------------------------------------------
// People in chat
// ---------------------------------------------------------------------------

/** A workspace member as chat shows them (name, effective stage, team role). */
export interface ChatPerson {
  id: string;
  name: string;
  stage: BizClass;
  role: WorkspaceRole | null;
}

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  leader: "Leader",
  moderator: "Moderator",
  member: "Member",
};
/** "Leader" / "Moderator" / "Member". */
export const workspaceRoleLabel = (r: WorkspaceRole) => ROLE_LABEL[r];

/**
 * Everyone in the workspace by id (names and stages are visible to people
 * who share a chat, independent of CRM visibility). Includes former members
 * so old messages keep their author's name.
 */
export function useChatPeople(): Map<string, ChatPerson> {
  const people = usePeopleStore((s) => s.people);
  const members = useChatStore((s) => s.members);
  // Real accounts: chat members outside your CRM view come from the directory.
  const directory = useRemoteStore((s) => s.directory);
  return useMemo(() => {
    const role = new Map(members.map((m) => [m.personId, m.role]));
    const out = new Map<string, ChatPerson>();
    for (const p of people) {
      if (p.bizClass === "customer") continue;
      out.set(p.id, {
        id: p.id,
        name: p.name,
        stage: effectiveBizClass(p),
        role: role.get(p.id) ?? null,
      });
    }
    for (const d of directory) {
      if (out.has(d.personId)) continue;
      out.set(d.personId, {
        id: d.personId,
        name: d.name,
        stage: d.stage,
        role: role.get(d.personId) ?? d.role,
      });
    }
    return out;
  }, [people, members, directory]);
}

/** Workspace members (sorted by name) with their person details. */
export function useWorkspaceMembers(): ChatPerson[] {
  const people = useChatPeople();
  const members = useChatStore((s) => s.members);
  return useMemo(
    () =>
      members
        .map((m) => people.get(m.personId))
        .filter((p): p is ChatPerson => !!p)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [members, people],
  );
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

export interface ChatAccess {
  personId: string;
  /** May use chats (apprentices, IBOs and leaders). */
  eligible: boolean;
  /** Why not, when not eligible. */
  reason: "candidate" | "prospect" | null;
  role: WorkspaceRole | null;
  /** Leader or workspace moderator: posts announcements, reviews drafts. */
  canReview: boolean;
  /** Leader: designates moderators, sees reports. */
  isLeader: boolean;
}

/** The current user's chat access. Joins the workspace when newly eligible. */
export function useChatAccess(): ChatAccess {
  const user = useSessionStore((s) => s.user);
  const people = usePeopleStore((s) => s.people);
  const members = useChatStore((s) => s.members);
  const personId = user?.personId ?? "";
  const access = useMemo<ChatAccess>(() => {
    const me = people.find((p) => p.id === personId);
    const role = members.find((m) => m.personId === personId)?.role ?? null;
    const eligible = isChatEligible({
      stage: me ? effectiveBizClass(me) : undefined,
      workspaceRole: role,
      sessionRole: user?.role,
    });
    return {
      personId,
      eligible,
      reason: eligible ? null : user?.role === "candidate" ? "candidate" : "prospect",
      role: eligible ? (role ?? "member") : null,
      canReview: eligible && canReviewDrafts(role),
      isLeader: eligible && role === "leader",
    };
  }, [people, members, personId, user?.role]);
  const isMember = members.some((m) => m.personId === personId);
  useEffect(() => {
    if (access.eligible && !isMember && personId) joinWorkspace(personId);
  }, [access.eligible, isMember, personId]);
  return access;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  id: string;
  conversation: Conversation;
  /** Display title (a DM shows the other person's name). */
  title: string;
  /** DMs: the other person. */
  other?: ChatPerson;
  me: ConversationMember;
  myRole: ConversationRole;
  memberCount: number;
  lastMessage?: Message;
  /** "You", the author's first name, or undefined for DMs from the other person. */
  lastAuthor?: string;
  /** One-line preview of the last message. */
  preview: string;
  /** Last activity (last message, else creation). */
  lastAt: string;
  unread: number;
  muted: boolean;
  /** Announcements, for reviewers: drafts waiting for approval. */
  pendingDrafts: number;
  /** Announcements, Main chat and the pinned groups. */
  team: boolean;
  /** The chat list tab it belongs to (DMs: "direct"; everything else: "groups"). */
  tab: ChatTab;
  /** Pinned to the top of your own list (personal). */
  pinned: boolean;
  /** When you pinned it (null = not pinned); pinned chats are listed in this order. */
  pinnedAt: string | null;
  /** May remove other people's messages here. */
  canModerate: boolean;
  /** DMs: "me" when you blocked the other person, "them" when they blocked you. */
  blocked: "me" | "them" | null;
}

const firstName = (n: string) => n.split(" ")[0];

function fmtDuration(ms: number | null): string {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** One-line text for a message (list previews, quotes, notifications). */
export function messagePreview(
  m: Pick<Message, "body" | "card" | "deletedAt"> | undefined,
  attachments: Attachment[] = [],
  eventName?: (id: string) => string | undefined,
): string {
  if (!m) return "No messages yet";
  if (m.deletedAt) return "Message deleted";
  const body = m.body.trim();
  if (body) return body.replace(/\s+/g, " ");
  const voice = attachments.find((a) => a.kind === "voice");
  if (voice) return `Voice note (${fmtDuration(voice.durationMs)})`;
  if (attachments.some((a) => a.kind === "image")) return "Photo";
  return cardPreview(m.card, eventName);
}

function cardPreview(card: MessageCard | null, eventName?: (id: string) => string | undefined) {
  if (!card) return "";
  switch (card.type) {
    case "win":
      return card.detail ? `${card.title} · ${card.detail}` : card.title;
    case "event":
      return `Event: ${eventName?.(card.eventId) ?? "an event"}`;
    case "learning":
      return `Finished ${card.title}`;
    case "link":
      return "Shared a link";
  }
}

/** Shared derivation for useConversations / useConversation. */
function useSummaries(): ConversationSummary[] {
  const data = useChatStore();
  const people = useChatPeople();
  const events = useEventsStore((s) => s.events);
  const access = useChatAccess();
  const me = access.personId;
  return useMemo(() => {
    if (!access.eligible) return [];
    const now = Date.now();
    const blocked = new Set(data.blocks.filter((b) => b.blockerId === me).map((b) => b.blockedId));
    const convById = new Map(data.conversations.map((c) => [c.id, c]));
    const byConv = new Map<string, Message[]>();
    for (const m of data.messages) {
      if (isExpired(m, convById.get(m.conversationId), now)) continue;
      const arr = byConv.get(m.conversationId) ?? [];
      arr.push(m);
      byConv.set(m.conversationId, arr);
    }
    const attByMsg = new Map<string, Attachment[]>();
    for (const a of data.attachments) {
      const arr = attByMsg.get(a.messageId) ?? [];
      arr.push(a);
      attByMsg.set(a.messageId, arr);
    }
    const membersOf = new Map<string, ConversationMember[]>();
    for (const cm of data.conversationMembers) {
      const arr = membersOf.get(cm.conversationId) ?? [];
      arr.push(cm);
      membersOf.set(cm.conversationId, arr);
    }
    const pending = data.drafts.filter((d) => d.status === "pending");
    const eventName = (id: string) => events.find((e) => e.id === id)?.name;

    const rows: ConversationSummary[] = [];
    for (const c of data.conversations) {
      const cms = membersOf.get(c.id) ?? [];
      const mine = cms.find((x) => x.personId === me);
      if (!mine) continue;
      const msgs = (byConv.get(c.id) ?? []).filter((m) => !blocked.has(m.authorId));
      const last = msgs.reduce<Message | undefined>(
        (a, m) => (!a || m.createdAt > a.createdAt ? m : a),
        undefined,
      );
      const otherId = c.kind === "dm" ? cms.find((x) => x.personId !== me)?.personId : undefined;
      const other = otherId ? people.get(otherId) : undefined;
      const author = last ? people.get(last.authorId) : undefined;
      rows.push({
        id: c.id,
        conversation: c,
        title: c.kind === "dm" ? (other?.name ?? "Former member") : (c.title ?? "Chat"),
        other,
        me: mine,
        myRole: mine.role,
        memberCount: cms.length,
        lastMessage: last,
        lastAuthor: !last
          ? undefined
          : last.authorId === me
            ? "You"
            : c.kind === "dm"
              ? undefined
              : author && firstName(author.name),
        preview: messagePreview(last, last ? attByMsg.get(last.id) : [], eventName),
        lastAt: last?.createdAt ?? c.createdAt,
        unread: unreadCount(msgs, mine, blocked),
        muted: mine.muted,
        pendingDrafts:
          c.kind === "announcements" && access.canReview
            ? pending.filter((d) => d.conversationId === c.id).length
            : 0,
        team: isTeamChat(c),
        tab: chatTab(c),
        pinned: !!mine.pinnedAt,
        pinnedAt: mine.pinnedAt ?? null,
        canModerate: canModerate({
          conversation: c,
          workspaceRole: access.role,
          conversationRole: mine.role,
        }),
        blocked: !otherId
          ? null
          : blocked.has(otherId)
            ? "me"
            : data.blocks.some((b) => b.blockerId === otherId && b.blockedId === me)
              ? "them"
              : null,
      });
    }
    return sortConversations(rows);
  }, [data, people, events, access, me]);
}

/** The current user's conversations: their pinned chats first, then by latest message. */
export function useConversations(): ConversationSummary[] {
  return useSummaries();
}

export interface ChatTabs {
  /** Announcements, Main chat, team groups and side groups (pinned first). */
  groups: ConversationSummary[];
  /** Direct messages (pinned first). */
  direct: ConversationSummary[];
  /** Chats with unread messages per tab (muted chats don't count, like the nav badge). */
  unread: Record<ChatTab, number>;
}

/** The chat list split into its two tabs, each in list order. */
export function useChatTabs(): ChatTabs {
  const all = useSummaries();
  return useMemo(() => {
    const groups = all.filter((c) => c.tab === "groups");
    const direct = all.filter((c) => c.tab === "direct");
    const unread = (rows: ConversationSummary[]) =>
      rows.filter((c) => c.unread > 0 && !c.muted).length;
    return { groups, direct, unread: { groups: unread(groups), direct: unread(direct) } };
  }, [all]);
}

/** One conversation the current user belongs to, or undefined. */
export function useConversation(id: string | undefined): ConversationSummary | undefined {
  const all = useSummaries();
  return useMemo(() => all.find((c) => c.id === id), [all, id]);
}

/** Non-reactive title for route `head()` (undefined if not a member). */
export function getConversationTitle(id: string): string | undefined {
  const me = useSessionStore.getState().user?.personId;
  const s = chat();
  const c = s.conversations.find((x) => x.id === id);
  if (!c || !s.conversationMembers.some((m) => m.conversationId === id && m.personId === me)) {
    return undefined;
  }
  if (c.kind !== "dm") return c.title ?? "Chat";
  const otherId = s.conversationMembers.find(
    (m) => m.conversationId === id && m.personId !== me,
  )?.personId;
  return chatPersonName(otherId);
}

export interface MemberView extends ChatPerson {
  conversationRole: ConversationRole;
  muted: boolean;
  joinedAt: string;
}

/** Members of a conversation the current user belongs to (admins first). */
export function useConversationMembers(id: string | undefined): MemberView[] {
  const cms = useChatStore((s) => s.conversationMembers);
  const people = useChatPeople();
  const conv = useConversation(id);
  return useMemo(() => {
    if (!conv) return [];
    const order: Record<ConversationRole, number> = { admin: 0, moderator: 1, member: 2 };
    return cms
      .filter((m) => m.conversationId === id)
      .map((m) => {
        const p = people.get(m.personId);
        return p
          ? { ...p, conversationRole: m.role, muted: m.muted, joinedAt: m.joinedAt }
          : undefined;
      })
      .filter((m): m is MemberView => !!m)
      .sort(
        (a, b) =>
          order[a.conversationRole] - order[b.conversationRole] || a.name.localeCompare(b.name),
      );
  }, [cms, people, conv, id]);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
  names: string[];
}

export interface MessageView extends Message {
  author?: ChatPerson;
  mine: boolean;
  attachments: Attachment[];
  reactions: ReactionSummary[];
  mentionIds: string[];
  /** The quoted message, when this is a reply. */
  replyTo?: { id: string; authorName: string; preview: string; at: string; deleted: boolean };
  /** You blocked the author: the body is hidden. */
  blocked: boolean;
  /** Pinned in this conversation. */
  pinned: boolean;
}

/** Messages of a conversation the current user belongs to, oldest first. */
export function useMessages(conversationId: string | undefined): MessageView[] {
  const data = useChatStore();
  const people = useChatPeople();
  const conv = useConversation(conversationId);
  const events = useEventsStore((s) => s.events);
  const me = useSessionStore((s) => s.user?.personId ?? "");
  return useMemo(() => {
    if (!conv) return [];
    const now = Date.now();
    const msgs = data.messages
      .filter((m) => m.conversationId === conv.id && !isExpired(m, conv.conversation, now))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const ids = new Set(msgs.map((m) => m.id));
    const byId = new Map(msgs.map((m) => [m.id, m]));
    const blocked = new Set(data.blocks.filter((b) => b.blockerId === me).map((b) => b.blockedId));
    const att = data.attachments.filter((a) => ids.has(a.messageId));
    const eventName = (id: string) => events.find((e) => e.id === id)?.name;
    const pinnedId = conv.conversation.pinnedMessageId;
    return msgs.map((m) => {
      const rx = new Map<string, ReactionSummary>();
      for (const r of data.reactions) {
        if (r.messageId !== m.id) continue;
        const s = rx.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, names: [] };
        s.count++;
        if (r.personId === me) s.mine = true;
        s.names.push(r.personId === me ? "You" : (people.get(r.personId)?.name ?? "Someone"));
        rx.set(r.emoji, s);
      }
      const q = m.replyToId ? byId.get(m.replyToId) : undefined;
      return {
        ...m,
        author: people.get(m.authorId),
        mine: m.authorId === me,
        attachments: att.filter((a) => a.messageId === m.id),
        reactions: [...rx.values()],
        mentionIds: data.mentions.filter((x) => x.messageId === m.id).map((x) => x.personId),
        replyTo: m.replyToId
          ? {
              id: m.replyToId,
              authorName: q ? (people.get(q.authorId)?.name ?? "Someone") : "",
              preview: q
                ? messagePreview(
                    q,
                    att.filter((a) => a.messageId === q.id),
                    eventName,
                  )
                : "Original message is no longer available",
              at: q?.createdAt ?? "",
              deleted: !q || !!q.deletedAt,
            }
          : undefined,
        blocked: blocked.has(m.authorId),
        pinned: pinnedId === m.id,
      };
    });
  }, [data, people, conv, events, me]);
}

/** Pending announcement drafts (reviewers see all; others see their own). */
export function useAnnouncementDrafts(): AnnouncementDraft[] {
  const drafts = useChatStore((s) => s.drafts);
  const access = useChatAccess();
  return useMemo(
    () =>
      drafts
        .filter(
          (d) =>
            d.status === "pending" &&
            access.eligible &&
            (access.canReview || d.authorId === access.personId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [drafts, access],
  );
}

/** Your own announcement suggestions from the last 14 days (any status), newest first. */
export function useMyDrafts(): AnnouncementDraft[] {
  const drafts = useChatStore((s) => s.drafts);
  const me = useSessionStore((s) => s.user?.personId ?? "");
  return useMemo(() => {
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    return drafts
      .filter((d) => d.authorId === me && d.createdAt >= since)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [drafts, me]);
}

/** Every draft the user may see, any status (reviewers: all; others: their own). */
export function useVisibleDrafts(): AnnouncementDraft[] {
  const drafts = useChatStore((s) => s.drafts);
  const access = useChatAccess();
  return useMemo(
    () => drafts.filter((d) => access.canReview || d.authorId === access.personId),
    [drafts, access],
  );
}

/** Any draft by id (for inbox rows showing its status), if the user may see it. */
export function useDraft(id: string | null | undefined): AnnouncementDraft | undefined {
  const drafts = useChatStore((s) => s.drafts);
  const access = useChatAccess();
  return useMemo(() => {
    const d = drafts.find((x) => x.id === id);
    return d && (access.canReview || d.authorId === access.personId) ? d : undefined;
  }, [drafts, id, access]);
}

export interface ReportView extends Report {
  message?: Message;
  authorName: string;
  reporterName: string;
  conversationTitle: string;
}

/** The moderation queue (leaders only): open reports first, newest first. */
export function useReports(): ReportView[] {
  const data = useChatStore();
  const people = useChatPeople();
  const access = useChatAccess();
  return useMemo(() => {
    if (!access.isLeader) return [];
    return data.reports
      .map((r) => {
        const m = data.messages.find((x) => x.id === r.messageId);
        const c = data.conversations.find((x) => x.id === m?.conversationId);
        return {
          ...r,
          message: m,
          authorName: people.get(m?.authorId ?? "")?.name ?? "Unknown",
          reporterName: people.get(r.reporterId)?.name ?? "Someone",
          conversationTitle: c
            ? c.kind === "dm"
              ? "a direct message"
              : (c.title ?? "a chat")
            : "",
        };
      })
      .sort(
        (a, b) =>
          Number(!!a.resolvedAt) - Number(!!b.resolvedAt) || b.createdAt.localeCompare(a.createdAt),
      );
  }, [data, people, access.isLeader]);
}

/** People the current user blocked. */
export function useBlockedIds(): Set<string> {
  const blocks = useChatStore((s) => s.blocks);
  const me = useSessionStore((s) => s.user?.personId ?? "");
  return useMemo(
    () => new Set(blocks.filter((b) => b.blockerId === me).map((b) => b.blockedId)),
    [blocks, me],
  );
}

/** People the current user may start a DM with (share a chat, not blocked). */
export function useDmCandidates(): ChatPerson[] {
  const members = useWorkspaceMembers();
  const cms = useChatStore((s) => s.conversationMembers);
  const blocks = useChatStore((s) => s.blocks);
  const access = useChatAccess();
  return useMemo(() => {
    if (!access.eligible) return [];
    const eligibleIds = new Set(members.map((m) => m.id));
    eligibleIds.add(access.personId);
    return members.filter((p) =>
      canDm(access.personId, p.id, { eligibleIds, members: cms, blocks }),
    );
  }, [members, cms, blocks, access]);
}

/** Photos and voice notes shared in a conversation, newest first. */
export function useSharedMedia(conversationId: string | undefined): Attachment[] {
  const msgs = useMessages(conversationId);
  return useMemo(
    () =>
      msgs
        .filter((m) => !m.deletedAt && !m.blocked)
        .flatMap((m) => m.attachments)
        .reverse(),
    [msgs],
  );
}

// ---------------------------------------------------------------------------
// Notifications, badges
// ---------------------------------------------------------------------------

/** The current user's notifications, newest first. */
export function useNotifications(): Notification[] {
  const all = useChatStore((s) => s.notifications);
  const me = useSessionStore((s) => s.user?.personId ?? "");
  const access = useChatAccess();
  return useMemo(
    () =>
      all
        .filter((n) => n.recipientId === me && (access.eligible || n.type === "checkin_logged"))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [all, me, access.eligible],
  );
}

/** Unread notifications for the current user. */
export function useUnreadNotificationCount(): number {
  const list = useNotifications();
  return useMemo(() => list.filter((n) => !n.readAt).length, [list]);
}

/** Chats with unread messages (muted chats don't count). */
export function useUnreadConversationCount(): number {
  const rows = useSummaries();
  return useMemo(() => rows.filter((r) => r.unread > 0 && !r.muted).length, [rows]);
}

/** A message by id from a conversation the user belongs to (for inbox snippets). */
export function useMessageIndex(): Map<string, Message> {
  const messages = useChatStore((s) => s.messages);
  const cms = useChatStore((s) => s.conversationMembers);
  const me = useSessionStore((s) => s.user?.personId ?? "");
  return useMemo(() => {
    const mine = new Set(cms.filter((m) => m.personId === me).map((m) => m.conversationId));
    return new Map(messages.filter((m) => mine.has(m.conversationId)).map((m) => [m.id, m]));
  }, [messages, cms, me]);
}

// ---------------------------------------------------------------------------
// Library, events, search
// ---------------------------------------------------------------------------

/** Media library items (talks, videos, documents), newest first. */
export function useLibrary(): LibraryItem[] {
  const lib = useChatStore((s) => s.library);
  return useMemo(() => [...lib].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [lib]);
}

export interface EventRsvp {
  event?: CrmEvent;
  /** The current user's attendance row, if any. */
  mine?: Attendance;
  /** Team-wide totals (no identities). */
  counts: { bought: number; going: number; maybe: number };
}

/** RSVP state for an event card: your answer and the team totals. */
export function useEventRsvp(eventId: string): EventRsvp {
  const events = useEventsStore((s) => s.events);
  const rows = useAttendanceStore((s) => s.attendances);
  const me = useSessionStore((s) => s.user?.personId ?? "");
  // Real accounts: you only hold the attendance rows you may see, so the team
  // totals come from the database (event_rsvp_counts, no identities).
  const serverCounts = useRemoteStore((s) => (IS_SUPABASE ? s.rsvpCounts : null));
  return useMemo(() => {
    const forEvent = rows.filter((a) => a.eventId === eventId);
    return {
      event: events.find((e) => e.id === eventId),
      mine: forEvent.find((a) => a.personId === me),
      counts: serverCounts
        ? (serverCounts[eventId] ?? { bought: 0, going: 0, maybe: 0 })
        : {
            bought: forEvent.filter((a) => a.hasTicket).length,
            going: forEvent.filter((a) => !a.hasTicket && a.desireToAttend === "yes").length,
            maybe: forEvent.filter((a) => !a.hasTicket && a.desireToAttend === "maybe").length,
          },
    };
  }, [events, rows, eventId, me, serverCounts]);
}

export interface SearchHit {
  kind: "conversation" | "message";
  conversationId: string;
  messageId?: string;
  title: string;
  snippet: string;
  at: string;
}

/** Search conversation titles and message text in the user's chats. */
export function useChatSearch(query: string): SearchHit[] {
  const convs = useSummaries();
  const messages = useChatStore((s) => s.messages);
  const people = useChatPeople();
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const hits: SearchHit[] = [];
    const byId = new Map(convs.map((c) => [c.id, c]));
    for (const c of convs) {
      if (c.title.toLowerCase().includes(q)) {
        hits.push({
          kind: "conversation",
          conversationId: c.id,
          title: c.title,
          snippet: c.preview,
          at: c.lastAt,
        });
      }
    }
    const found = messages
      .filter(
        (m) =>
          byId.has(m.conversationId) &&
          !m.deletedAt &&
          !isExpired(m, byId.get(m.conversationId)!.conversation) &&
          m.body.toLowerCase().includes(q),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30);
    for (const m of found) {
      const c = byId.get(m.conversationId)!;
      hits.push({
        kind: "message",
        conversationId: c.id,
        messageId: m.id,
        title: `${people.get(m.authorId)?.name ?? "Someone"} · ${c.title}`,
        snippet: m.body,
        at: m.createdAt,
      });
    }
    return hits;
  }, [query, convs, messages, people]);
}

// ---------------------------------------------------------------------------
// Card targets
// ---------------------------------------------------------------------------

export type CardTarget =
  | { kind: "person"; id: string }
  | { kind: "event"; id: string }
  | { kind: "message"; conversationId: string; messageId: string }
  | { kind: "material"; id: string };

/**
 * Where a win card leads: the logged record when the viewer may see it (the
 * customer of a sale, the person of a contact, the event of a ticket), else
 * the author's profile when visible, else null (the record is private).
 */
export function winCardTarget(
  card: Extract<MessageCard, { type: "win" }>,
  authorId: string,
): CardTarget | null {
  const people = usePeopleStore.getState().people;
  const visible = visibleIdSet(people, getViewer());
  const crm = useCrmStore.getState();
  let personId: string | undefined;
  if (card.winKind === "ticket") {
    const a = useAttendanceStore.getState().attendances.find((x) => x.id === card.refId);
    if (a) return { kind: "event", id: a.eventId };
  } else if (card.winKind === "sale") {
    personId = crm.sales.find((s) => s.id === card.refId)?.customerId;
  } else {
    personId =
      crm.contacts.find((c) => c.id === card.refId)?.personId ??
      people.find((p) => p.id === card.refId)?.id;
  }
  if (personId && visible.has(personId)) return { kind: "person", id: personId };
  return visible.has(authorId) ? { kind: "person", id: authorId } : null;
}

/** Whether a person's profile is visible to the current user (link cards). */
export function canOpenPerson(id: string): boolean {
  return visibleIdSet(usePeopleStore.getState().people, getViewer()).has(id);
}
