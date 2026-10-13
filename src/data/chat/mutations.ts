/**
 * Chat writes. Plain functions acting as the current (demo) user; each one
 * checks the same rules the database enforces (./rules) and returns null /
 * false when the action isn't allowed. Side effects follow the contract:
 * mentions and replies notify, reports notify leaders, a conversation in both
 * directions logs a check-in (contacts with source "message") for both people.
 */
import { localDate } from "@/lib/dates";
import { usePeopleStore } from "@/stores/peopleStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useCrmStore } from "@/stores/crmStore";
import { logContact } from "../crm";
import { assignToEvent, updateAttendance } from "../events";
import { useChatStore, updateChat, chat, withoutExpired } from "./store";
import { deleteAttachment } from "./attachments";
import {
  canDeleteMessage,
  canDm,
  canEditMessage,
  canManageGroup,
  canManageTeam,
  canModerate,
  canPostAnnouncement,
  canReviewDrafts,
  conversationCheckin,
  dmId,
  extractMentions,
  isBlockedBetween,
  isTeamChat,
  uplineOf,
} from "./rules";
import { CHAT_IDS } from "./seed";
import {
  WORKSPACE_ID,
  type AnnouncementDraft,
  type Attachment,
  type AttachmentKind,
  type ChatData,
  type Conversation,
  type ConversationMember,
  type ConversationRole,
  type Mention,
  type Message,
  type MessageCard,
  type Notification,
  type WinKind,
  type WorkspaceRole,
} from "./types";

const me = () => useSessionStore.getState().user?.personId ?? "";
const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

const memberOf = (s: ChatData, conversationId: string, personId: string) =>
  s.conversationMembers.find((m) => m.conversationId === conversationId && m.personId === personId);
const workspaceRole = (s: ChatData, personId: string): WorkspaceRole | null =>
  s.members.find((m) => m.personId === personId)?.role ?? null;

function notification(
  recipientId: string,
  type: Notification["type"],
  o: Partial<Notification> = {},
): Notification {
  return {
    id: uid(),
    recipientId,
    type,
    actorId: me() || null,
    conversationId: null,
    messageId: null,
    refId: null,
    createdAt: nowIso(),
    readAt: null,
    ...o,
  };
}

function nameOf(id: string): string {
  return usePeopleStore.getState().people.find((p) => p.id === id)?.name ?? "";
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/** Add a newly eligible person to the workspace and its team chats (idempotent). */
export function joinWorkspace(personId: string): void {
  updateChat((s) => {
    if (s.members.some((m) => m.personId === personId)) return {};
    const at = nowIso();
    const team = s.conversations.filter((c) => isTeamChat(c));
    return {
      members: [
        ...s.members,
        { workspaceId: WORKSPACE_ID, personId, role: "member", joinedAt: at },
      ],
      conversationMembers: [
        ...s.conversationMembers,
        ...team
          .filter((c) => !memberOf(s, c.id, personId))
          .map((c) => ({
            conversationId: c.id,
            personId,
            role: "member" as const,
            lastReadAt: at,
            muted: false,
            joinedAt: at,
          })),
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface AttachmentInput {
  kind: AttachmentKind;
  storagePath: string;
  mime: string;
  size: number;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface SendMessageInput {
  conversationId: string;
  body?: string;
  replyToId?: string | null;
  card?: MessageCard | null;
  attachments?: AttachmentInput[];
}

export interface SendResult {
  message: Message;
  /** Set when this message completed a conversation and a check-in was logged. */
  checkinWith: string | null;
}

/**
 * Post a message. Returns null when not allowed: not a member, a blocked DM,
 * an empty message, or Announcements for someone who needs approval (use
 * submitAnnouncement). Notifies mentions, the replied-to author, uplines of a
 * win and (Announcements) the whole team; logs a conversation check-in.
 */
export function sendMessage(input: SendMessageInput): SendResult | null {
  const author = me();
  const s = chat();
  const c = s.conversations.find((x) => x.id === input.conversationId);
  const mine = c && memberOf(s, c.id, author);
  if (!c || !mine) return null;
  const body = (input.body ?? "").trim();
  if (!body && !input.card && !input.attachments?.length) return null;
  if (c.kind === "announcements" && !canPostAnnouncement(workspaceRole(s, author))) return null;
  const memberIds = s.conversationMembers
    .filter((m) => m.conversationId === c.id)
    .map((m) => m.personId);
  if (c.kind === "dm") {
    const other = memberIds.find((id) => id !== author);
    if (!other || isBlockedBetween(s.blocks, author, other)) return null;
  }
  return postAs(author, c, {
    body,
    replyToId: input.replyToId ?? null,
    card: input.card ?? null,
    attachments: input.attachments ?? [],
  });
}

/** Write a message (already authorised) with all its side effects. */
function postAs(
  authorId: string,
  c: Conversation,
  input: {
    body: string;
    replyToId: string | null;
    card: MessageCard | null;
    attachments: AttachmentInput[];
  },
): SendResult {
  const s = chat();
  const at = nowIso();
  const message: Message = {
    id: uid(),
    conversationId: c.id,
    authorId,
    body: input.body,
    replyToId: input.replyToId,
    card: input.card,
    createdAt: at,
    editedAt: null,
    deletedAt: null,
  };
  const cms = s.conversationMembers.filter((m) => m.conversationId === c.id);
  const memberIds = new Set(cms.map((m) => m.personId));
  const muted = new Set(cms.filter((m) => m.muted).map((m) => m.personId));
  const people = usePeopleStore.getState().people.filter((p) => memberIds.has(p.id));

  const mentionIds = extractMentions(input.body, people).filter((id) => id !== authorId);
  const mentions: Mention[] = mentionIds.map((personId) => ({ messageId: message.id, personId }));
  const attachments: Attachment[] = input.attachments.map((a) => ({
    id: uid(),
    messageId: message.id,
    kind: a.kind,
    storagePath: a.storagePath,
    mime: a.mime,
    size: a.size,
    durationMs: a.durationMs ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
  }));

  const notes: Notification[] = [];
  const base = { actorId: authorId, conversationId: c.id, messageId: message.id };
  for (const id of mentionIds) notes.push(notification(id, "mention", base));
  const repliedTo = input.replyToId
    ? s.messages.find((m) => m.id === input.replyToId)?.authorId
    : undefined;
  if (repliedTo && repliedTo !== authorId && !mentionIds.includes(repliedTo)) {
    if (memberIds.has(repliedTo) && !muted.has(repliedTo)) {
      notes.push(notification(repliedTo, "reply", base));
    }
  }
  if (input.card?.type === "win") {
    const sponsorOf = new Map(
      usePeopleStore.getState().people.map((p) => [p.id, p.sponsorId ?? null]),
    );
    for (const id of uplineOf(sponsorOf, authorId)) {
      if (memberIds.has(id) && !muted.has(id) && !mentionIds.includes(id)) {
        notes.push(notification(id, "win", base));
      }
    }
  }
  if (c.kind === "announcements") {
    for (const id of memberIds) {
      if (id !== authorId && !mentionIds.includes(id)) {
        notes.push(notification(id, "announcement_posted", base));
      }
    }
  }

  updateChat((st) => ({
    messages: [...st.messages, message],
    attachments: [...st.attachments, ...attachments],
    mentions: [...st.mentions, ...mentions],
    notifications: [...st.notifications, ...notes],
    conversationMembers: st.conversationMembers.map((m) =>
      m.conversationId === c.id && m.personId === authorId ? { ...m, lastReadAt: at } : m,
    ),
  }));

  return { message, checkinWith: logConversationCheckin(c, message) };
}

/** Apply the conversation check-in rule to a new message. Returns the other person's id. */
function logConversationCheckin(c: Conversation, message: Message): string | null {
  const s = chat();
  const dmPartnerId =
    c.kind === "dm"
      ? s.conversationMembers.find(
          (m) => m.conversationId === c.id && m.personId !== message.authorId,
        )?.personId
      : null;
  const pair = conversationCheckin({
    conversation: c,
    message,
    messages: s.messages.filter((m) => m.conversationId === c.id),
    dmPartnerId,
    mentions: s.mentions,
  });
  if (!pair) return null;
  const today = localDate();
  const already = useCrmStore
    .getState()
    .contacts.some(
      (x) =>
        x.source === "message" &&
        x.date === today &&
        ((x.personId === pair.b && x.byId === pair.a) ||
          (x.personId === pair.a && x.byId === pair.b)),
    );
  if (already) return null;
  const ab = logContact({ personId: pair.b, byId: pair.a, source: "message" });
  const ba = logContact({ personId: pair.a, byId: pair.b, source: "message" });
  const base = { conversationId: c.id, messageId: message.id };
  updateChat((st) => ({
    notifications: [
      ...st.notifications,
      notification(pair.a, "checkin_logged", { ...base, actorId: pair.b, refId: ab.id }),
      notification(pair.b, "checkin_logged", { ...base, actorId: pair.a, refId: ba.id }),
    ],
  }));
  return pair.b;
}

/** Edit your own message (new mentions notify). */
export function editMessage(id: string, body: string): boolean {
  const s = chat();
  const m = s.messages.find((x) => x.id === id);
  const text = body.trim();
  if (!m || !canEditMessage(me(), m) || (!text && !m.card && !hasAttachments(s, id))) return false;
  const memberIds = new Set(
    s.conversationMembers
      .filter((x) => x.conversationId === m.conversationId)
      .map((x) => x.personId),
  );
  const people = usePeopleStore.getState().people.filter((p) => memberIds.has(p.id));
  const ids = extractMentions(text, people).filter((x) => x !== m.authorId);
  const before = new Set(s.mentions.filter((x) => x.messageId === id).map((x) => x.personId));
  updateChat((st) => ({
    messages: st.messages.map((x) => (x.id === id ? { ...x, body: text, editedAt: nowIso() } : x)),
    mentions: [
      ...st.mentions.filter((x) => x.messageId !== id),
      ...ids.map((personId) => ({ messageId: id, personId })),
    ],
    notifications: [
      ...st.notifications,
      ...ids
        .filter((x) => !before.has(x))
        .map((x) =>
          notification(x, "mention", { conversationId: m.conversationId, messageId: id }),
        ),
    ],
  }));
  return true;
}

const hasAttachments = (s: ChatData, messageId: string) =>
  s.attachments.some((a) => a.messageId === messageId);

/** Whether the current user may remove other people's messages in a conversation. */
function moderatorIn(s: ChatData, conversationId: string): boolean {
  const c = s.conversations.find((x) => x.id === conversationId);
  if (!c) return false;
  return canModerate({
    conversation: c,
    workspaceRole: workspaceRole(s, me()),
    conversationRole: memberOf(s, c.id, me())?.role,
  });
}

/**
 * Delete a message (yours, or anyone's as a moderator of that chat). The row
 * stays as "Message deleted"; its body, card, files, reactions and mentions go.
 */
export function deleteMessage(id: string): boolean {
  const s = chat();
  const m = s.messages.find((x) => x.id === id);
  if (!m || !canDeleteMessage(me(), m, moderatorIn(s, m.conversationId))) return false;
  removeMessageContent(id);
  return true;
}

function removeMessageContent(id: string) {
  const s = chat();
  s.attachments
    .filter((a) => a.messageId === id)
    .forEach((a) => void deleteAttachment(a.storagePath));
  updateChat((st) => ({
    messages: st.messages.map((x) =>
      x.id === id ? { ...x, body: "", card: null, deletedAt: nowIso() } : x,
    ),
    attachments: st.attachments.filter((a) => a.messageId !== id),
    reactions: st.reactions.filter((r) => r.messageId !== id),
    mentions: st.mentions.filter((r) => r.messageId !== id),
    pins: Object.fromEntries(Object.entries(st.pins).filter(([, mid]) => mid !== id)),
  }));
}

/** Add or remove your reaction (notifies the author when added). */
export function toggleReaction(messageId: string, emoji: string): void {
  const s = chat();
  const who = me();
  const m = s.messages.find((x) => x.id === messageId);
  if (!m || m.deletedAt || !memberOf(s, m.conversationId, who)) return;
  const has = s.reactions.some(
    (r) => r.messageId === messageId && r.personId === who && r.emoji === emoji,
  );
  if (has) {
    updateChat((st) => ({
      reactions: st.reactions.filter(
        (r) => !(r.messageId === messageId && r.personId === who && r.emoji === emoji),
      ),
    }));
    return;
  }
  const authorMember = memberOf(s, m.conversationId, m.authorId);
  updateChat((st) => ({
    reactions: [...st.reactions, { messageId, personId: who, emoji, createdAt: nowIso() }],
    notifications:
      m.authorId !== who && authorMember && !authorMember.muted
        ? [
            ...st.notifications,
            notification(m.authorId, "reaction", {
              conversationId: m.conversationId,
              messageId,
              refId: emoji,
            }),
          ]
        : st.notifications,
  }));
}

/** Mark a conversation read up to now. */
export function markRead(conversationId: string): void {
  const who = me();
  const at = nowIso();
  const m = memberOf(chat(), conversationId, who);
  if (!m) return;
  // Skip the write when nothing is newer (keeps re-renders quiet).
  const newer = chat().messages.some(
    (x) =>
      x.conversationId === conversationId &&
      x.authorId !== who &&
      (!m.lastReadAt || x.createdAt > m.lastReadAt),
  );
  if (!newer) return;
  updateChat((st) => ({
    conversationMembers: st.conversationMembers.map((x) =>
      x.conversationId === conversationId && x.personId === who ? { ...x, lastReadAt: at } : x,
    ),
  }));
}

/** Pin a message to the top of its chat (null unpins). Moderators, group admins, DM members. */
export function pinMessage(conversationId: string, messageId: string | null): boolean {
  const s = chat();
  const c = s.conversations.find((x) => x.id === conversationId);
  if (!c || !memberOf(s, conversationId, me())) return false;
  if (c.kind !== "dm" && !moderatorIn(s, conversationId)) return false;
  updateChat((st) => {
    const pins = { ...st.pins };
    if (messageId) pins[conversationId] = messageId;
    else delete pins[conversationId];
    return { pins };
  });
  return true;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/** Create a side group; the creator is its admin. Returns the conversation id. */
export function createGroup(input: {
  title: string;
  description?: string;
  icon?: string | null;
  memberIds: string[];
}): string | null {
  const who = me();
  const s = chat();
  const title = input.title.trim();
  if (!title || !s.members.some((m) => m.personId === who)) return null;
  const eligible = new Set(s.members.map((m) => m.personId));
  const at = nowIso();
  const id = uid();
  const ids = [...new Set([who, ...input.memberIds])].filter((x) => eligible.has(x));
  updateChat((st) => ({
    conversations: [
      ...st.conversations,
      {
        id,
        workspaceId: WORKSPACE_ID,
        kind: "group",
        title,
        description: input.description?.trim() || null,
        icon: input.icon ?? null,
        pinned: false,
        retentionDays: null,
        createdBy: who,
        createdAt: at,
      },
    ],
    conversationMembers: [
      ...st.conversationMembers,
      ...ids.map((personId) => ({
        conversationId: id,
        personId,
        role: (personId === who ? "admin" : "member") as ConversationRole,
        lastReadAt: personId === who ? at : null,
        muted: false,
        joinedAt: at,
      })),
    ],
  }));
  return id;
}

/** Edit a side group's name or description (admins). */
export function updateGroup(
  conversationId: string,
  patch: { title?: string; description?: string | null },
): boolean {
  const s = chat();
  const c = s.conversations.find((x) => x.id === conversationId);
  if (!c || !canManageGroup({ conversation: c, conversationRole: memberOf(s, c.id, me())?.role })) {
    return false;
  }
  updateChat((st) => ({
    conversations: st.conversations.map((x) =>
      x.id === conversationId
        ? {
            ...x,
            title: patch.title?.trim() || x.title,
            description:
              patch.description === undefined ? x.description : patch.description?.trim() || null,
          }
        : x,
    ),
  }));
  return true;
}

/** Add workspace members to a side group (admins). */
export function addMembers(conversationId: string, personIds: string[]): boolean {
  const s = chat();
  const c = s.conversations.find((x) => x.id === conversationId);
  if (!c || !canManageGroup({ conversation: c, conversationRole: memberOf(s, c.id, me())?.role })) {
    return false;
  }
  const eligible = new Set(s.members.map((m) => m.personId));
  const at = nowIso();
  const add = personIds.filter((id) => eligible.has(id) && !memberOf(s, conversationId, id));
  updateChat((st) => ({
    conversationMembers: [
      ...st.conversationMembers,
      ...add.map((personId) => ({
        conversationId,
        personId,
        role: "member" as const,
        lastReadAt: null,
        muted: false,
        joinedAt: at,
      })),
    ],
  }));
  return true;
}

/** Remove someone from a side group (admins; not yourself, use leaveConversation). */
export function removeMember(conversationId: string, personId: string): boolean {
  const s = chat();
  const c = s.conversations.find((x) => x.id === conversationId);
  if (
    !c ||
    personId === me() ||
    !canManageGroup({ conversation: c, conversationRole: memberOf(s, c.id, me())?.role })
  ) {
    return false;
  }
  updateChat((st) => ({
    conversationMembers: st.conversationMembers.filter(
      (m) => !(m.conversationId === conversationId && m.personId === personId),
    ),
  }));
  return true;
}

/** Make a group member a moderator or a plain member again (admins). */
export function setMemberRole(
  conversationId: string,
  personId: string,
  role: Exclude<ConversationRole, "admin">,
): boolean {
  const s = chat();
  const c = s.conversations.find((x) => x.id === conversationId);
  const target = memberOf(s, conversationId, personId);
  if (
    !c ||
    !target ||
    target.role === "admin" ||
    !canManageGroup({ conversation: c, conversationRole: memberOf(s, c.id, me())?.role })
  ) {
    return false;
  }
  updateChat((st) => ({
    conversationMembers: st.conversationMembers.map((m) =>
      m.conversationId === conversationId && m.personId === personId ? { ...m, role } : m,
    ),
  }));
  return true;
}

/**
 * Leave a side group (team chats and DMs can't be left). If the admin leaves,
 * the longest-standing moderator (else member) becomes admin.
 */
export function leaveConversation(conversationId: string): boolean {
  const who = me();
  const s = chat();
  const c = s.conversations.find((x) => x.id === conversationId);
  const mine = memberOf(s, conversationId, who);
  if (!c || !mine || c.kind !== "group" || c.pinned) return false;
  const rest = s.conversationMembers.filter(
    (m) => m.conversationId === conversationId && m.personId !== who,
  );
  const needsAdmin = mine.role === "admin" && !rest.some((m) => m.role === "admin");
  const heir = needsAdmin
    ? ([...rest].sort(
        (a, b) =>
          Number(b.role === "moderator") - Number(a.role === "moderator") ||
          a.joinedAt.localeCompare(b.joinedAt),
      )[0] as ConversationMember | undefined)
    : undefined;
  updateChat((st) => ({
    conversationMembers: st.conversationMembers
      .filter((m) => !(m.conversationId === conversationId && m.personId === who))
      .map((m) =>
        heir && m.conversationId === conversationId && m.personId === heir.personId
          ? { ...m, role: "admin" as const }
          : m,
      ),
  }));
  return true;
}

/** Mute ("Mentions only") or unmute a conversation for yourself. */
export function setMuted(conversationId: string, muted: boolean): void {
  const who = me();
  updateChat((st) => ({
    conversationMembers: st.conversationMembers.map((m) =>
      m.conversationId === conversationId && m.personId === who ? { ...m, muted } : m,
    ),
  }));
}

/** Who may change a chat's message history setting. */
export function canSetRetention(s: ChatData, conversationId: string, personId: string): boolean {
  const c = s.conversations.find((x) => x.id === conversationId);
  const mine = memberOf(s, conversationId, personId);
  if (!c || !mine) return false;
  if (c.kind === "dm") return true;
  if (isTeamChat(c)) return workspaceRole(s, personId) === "leader";
  return mine.role === "admin";
}

/**
 * Message history: keep forever (null) or delete messages older than N days.
 * DM members, group admins, and leaders for team chats. Applies immediately.
 */
export function setRetention(conversationId: string, days: number | null): boolean {
  if (!canSetRetention(chat(), conversationId, me())) return false;
  updateChat((st) => ({
    conversations: st.conversations.map((c) =>
      c.id === conversationId ? { ...c, retentionDays: days } : c,
    ),
  }));
  const s = chat();
  const purged = withoutExpired(s);
  if (purged !== s) {
    const gone = new Set(s.messages.map((m) => m.id));
    purged.messages.forEach((m) => gone.delete(m.id));
    s.attachments
      .filter((a) => gone.has(a.messageId))
      .forEach((a) => void deleteAttachment(a.storagePath));
    useChatStore.setState(purged, true);
  }
  return true;
}

/** Open the DM with someone (creating it if needed). Null if DMs aren't allowed. */
export function createOrOpenDm(personId: string): string | null {
  const who = me();
  const s = chat();
  const id = dmId(who, personId);
  if (s.conversations.some((c) => c.id === id) && memberOf(s, id, who)) {
    return isBlockedBetween(s.blocks, who, personId) ? null : id;
  }
  const eligibleIds = new Set(s.members.map((m) => m.personId));
  if (!canDm(who, personId, { eligibleIds, members: s.conversationMembers, blocks: s.blocks })) {
    return null;
  }
  const at = nowIso();
  const join = (pid: string): ConversationMember => ({
    conversationId: id,
    personId: pid,
    role: "member",
    lastReadAt: pid === who ? at : null,
    muted: false,
    joinedAt: at,
  });
  updateChat((st) => ({
    conversations: st.conversations.some((c) => c.id === id)
      ? st.conversations
      : [
          ...st.conversations,
          {
            id,
            workspaceId: WORKSPACE_ID,
            kind: "dm",
            title: null,
            description: null,
            icon: null,
            pinned: false,
            retentionDays: null,
            createdBy: who,
            createdAt: at,
          },
        ],
    conversationMembers: [
      ...st.conversationMembers.filter((m) => m.conversationId !== id),
      join(who),
      join(personId),
    ],
  }));
  return id;
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

/**
 * Suggest an announcement. Leaders and moderators post directly (returns
 * { posted }); anyone else creates a pending draft and the reviewers are
 * notified (returns { draft }).
 */
export function submitAnnouncement(input: {
  body: string;
  card?: MessageCard | null;
}): { draft?: AnnouncementDraft; posted?: Message } | null {
  const who = me();
  const s = chat();
  const body = input.body.trim();
  const c = s.conversations.find((x) => x.kind === "announcements");
  if (!c || !body || !memberOf(s, c.id, who)) return null;
  if (canPostAnnouncement(workspaceRole(s, who))) {
    const r = sendMessage({ conversationId: c.id, body, card: input.card ?? null });
    return r ? { posted: r.message } : null;
  }
  const draft: AnnouncementDraft = {
    id: uid(),
    conversationId: c.id,
    authorId: who,
    body,
    card: input.card ?? null,
    status: "pending",
    reviewerId: null,
    reviewedAt: null,
    createdAt: nowIso(),
  };
  const reviewers = s.members.filter((m) => canReviewDrafts(m.role)).map((m) => m.personId);
  updateChat((st) => ({
    drafts: [...st.drafts, draft],
    notifications: [
      ...st.notifications,
      ...reviewers.map((r) =>
        notification(r, "announcement_draft", { conversationId: c.id, refId: draft.id }),
      ),
    ],
  }));
  return { draft };
}

function review(id: string, status: "approved" | "rejected"): AnnouncementDraft | null {
  const who = me();
  const s = chat();
  const d = s.drafts.find((x) => x.id === id);
  if (!d || d.status !== "pending" || !canReviewDrafts(workspaceRole(s, who))) return null;
  const at = nowIso();
  updateChat((st) => ({
    drafts: st.drafts.map((x) =>
      x.id === id ? { ...x, status, reviewerId: who, reviewedAt: at } : x,
    ),
    // Every reviewer's "drafted an announcement" row is handled now.
    notifications: st.notifications.map((n) =>
      n.type === "announcement_draft" && n.refId === id && !n.readAt ? { ...n, readAt: at } : n,
    ),
  }));
  return d;
}

/** Approve a draft: posts it as its author and tells them it's up. */
export function approveDraft(id: string): Message | null {
  const d = review(id, "approved");
  if (!d) return null;
  const c = chat().conversations.find((x) => x.id === d.conversationId);
  if (!c) return null;
  const { message } = postAs(d.authorId, c, {
    body: d.body,
    replyToId: null,
    card: d.card,
    attachments: [],
  });
  // postAs notified the team (from the author); the author hears it from the reviewer.
  updateChat((st) => ({
    notifications: [
      ...st.notifications,
      notification(d.authorId, "announcement_posted", {
        conversationId: c.id,
        messageId: message.id,
        refId: d.id,
      }),
    ],
  }));
  return message;
}

/** Reject a draft (the author sees it as rejected in their inbox). */
export function rejectDraft(id: string): boolean {
  return !!review(id, "rejected");
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

/** Report a message; every workspace leader is notified. */
export function reportMessage(messageId: string, reason: string): boolean {
  const who = me();
  const s = chat();
  const m = s.messages.find((x) => x.id === messageId);
  if (!m || !memberOf(s, m.conversationId, who)) return false;
  const report = {
    id: uid(),
    messageId,
    reporterId: who,
    reason: reason.trim() || "Other",
    createdAt: nowIso(),
    resolvedAt: null,
    resolvedBy: null,
  };
  const leaders = s.members.filter((x) => x.role === "leader").map((x) => x.personId);
  updateChat((st) => ({
    reports: [...st.reports, report],
    notifications: [
      ...st.notifications,
      ...leaders.map((l) =>
        notification(l, "report", {
          conversationId: m.conversationId,
          messageId,
          refId: report.id,
        }),
      ),
    ],
  }));
  return true;
}

/** Close a report (leaders), optionally removing the reported message. */
export function resolveReport(id: string, opts: { removeMessage?: boolean } = {}): boolean {
  const who = me();
  const s = chat();
  const r = s.reports.find((x) => x.id === id);
  if (!r || !canManageTeam(workspaceRole(s, who))) return false;
  if (opts.removeMessage) removeMessageContent(r.messageId);
  const at = nowIso();
  updateChat((st) => ({
    reports: st.reports.map((x) =>
      x.messageId === r.messageId && !x.resolvedAt ? { ...x, resolvedAt: at, resolvedBy: who } : x,
    ),
    notifications: st.notifications.map((n) =>
      n.type === "report" && n.messageId === r.messageId && !n.readAt ? { ...n, readAt: at } : n,
    ),
  }));
  return true;
}

/** Block someone: their messages are hidden for you and DMs stop both ways. */
export function blockPerson(personId: string): void {
  const who = me();
  if (!personId || personId === who) return;
  updateChat((st) =>
    st.blocks.some((b) => b.blockerId === who && b.blockedId === personId)
      ? {}
      : { blocks: [...st.blocks, { blockerId: who, blockedId: personId, createdAt: nowIso() }] },
  );
}

/** Undo a block. */
export function unblockPerson(personId: string): void {
  const who = me();
  updateChat((st) => ({
    blocks: st.blocks.filter((b) => !(b.blockerId === who && b.blockedId === personId)),
  }));
}

/** Designate (or undo) a workspace moderator. Leaders only. */
export function setWorkspaceRole(
  personId: string,
  role: Exclude<WorkspaceRole, "leader">,
): boolean {
  const s = chat();
  const target = s.members.find((m) => m.personId === personId);
  if (!target || target.role === "leader" || !canManageTeam(workspaceRole(s, me()))) return false;
  const team = new Set(s.conversations.filter((c) => isTeamChat(c)).map((c) => c.id));
  updateChat((st) => ({
    members: st.members.map((m) => (m.personId === personId ? { ...m, role } : m)),
    conversationMembers: st.conversationMembers.map((m) =>
      m.personId === personId && team.has(m.conversationId) && m.role !== "admin"
        ? { ...m, role: role === "moderator" ? "moderator" : "member" }
        : m,
    ),
  }));
  return true;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Mark one notification read. */
export function markNotificationRead(id: string): void {
  const who = me();
  const at = nowIso();
  updateChat((st) => ({
    notifications: st.notifications.map((n) =>
      n.id === id && n.recipientId === who && !n.readAt ? { ...n, readAt: at } : n,
    ),
  }));
}

/** Mark several notifications read (e.g. a grouped inbox row). */
export function markNotificationsRead(ids: string[]): void {
  const who = me();
  const at = nowIso();
  const set = new Set(ids);
  updateChat((st) => ({
    notifications: st.notifications.map((n) =>
      set.has(n.id) && n.recipientId === who && !n.readAt ? { ...n, readAt: at } : n,
    ),
  }));
}

/** Mark every notification of the current user read. */
export function markAllNotificationsRead(): void {
  const who = me();
  const at = nowIso();
  updateChat((st) => ({
    notifications: st.notifications.map((n) =>
      n.recipientId === who && !n.readAt ? { ...n, readAt: at } : n,
    ),
  }));
}

// ---------------------------------------------------------------------------
// Posts that fill in the data
// ---------------------------------------------------------------------------

export type RsvpChoice = "going" | "maybe" | "ticket";

/**
 * Answer an event card: Going / Maybe write the attendance "desire", Bought
 * ticket sets hasTicket. Adds you to the event roster if needed. The card's
 * author gets an event_post notification. Returns the attendance row id.
 */
export function rsvpEvent(eventId: string, choice: RsvpChoice, messageId?: string): string {
  const who = me();
  const row = assignToEvent(eventId, who);
  updateAttendance(
    row.id,
    choice === "ticket"
      ? { hasTicket: true, desireToAttend: "yes" }
      : { desireToAttend: choice === "going" ? "yes" : "maybe" },
  );
  const m = messageId ? chat().messages.find((x) => x.id === messageId) : undefined;
  if (m && m.authorId !== who) {
    updateChat((st) => ({
      // One row per person per post: replace an earlier answer.
      notifications: [
        ...st.notifications.filter(
          (n) => !(n.type === "event_post" && n.messageId === m.id && n.actorId === who),
        ),
        notification(m.authorId, "event_post", {
          conversationId: m.conversationId,
          messageId: m.id,
          refId: eventId,
        }),
      ],
    }));
  }
  return row.id;
}

/** The Daily wins chat id (where shared wins go). */
export const DAILY_WINS_ID = CHAT_IDS.dailyWins;

/**
 * Share a logged record as a win in Daily wins. The card points at the record
 * (refId); `body` is the editable ready-made text. Never put prospect names in
 * it. Returns null if you aren't in Daily wins.
 */
export function postWin(input: {
  winKind: WinKind;
  refId: string;
  title: string;
  detail?: string;
  body?: string;
}): Message | null {
  const r = sendMessage({
    conversationId: DAILY_WINS_ID,
    body: input.body ?? "",
    card: {
      type: "win",
      winKind: input.winKind,
      refId: input.refId,
      title: input.title,
      ...(input.detail ? { detail: input.detail } : {}),
    },
  });
  return r?.message ?? null;
}

/** Share finished learning as a learning card in Daily wins. */
export function postLearning(input: {
  learningId: string;
  title: string;
  body?: string;
}): Message | null {
  const r = sendMessage({
    conversationId: DAILY_WINS_ID,
    body: input.body ?? "",
    card: { type: "learning", learningId: input.learningId, title: input.title },
  });
  return r?.message ?? null;
}

/**
 * Id of the current user's most recently logged learning entry (logLearning
 * returns nothing; the Log sheet needs the id for the learning card).
 */
export function latestLearningId(): string | undefined {
  const who = me();
  return useCrmStore.getState().learning.find((l) => l.personId === who)?.id;
}

/** Remove a shared win/learning post (used by Undo after logging). */
export function unpost(messageId: string): void {
  const s = chat();
  const m = s.messages.find((x) => x.id === messageId);
  if (!m || m.authorId !== me()) return;
  updateChat((st) => ({
    messages: st.messages.filter((x) => x.id !== messageId),
    reactions: st.reactions.filter((x) => x.messageId !== messageId),
    mentions: st.mentions.filter((x) => x.messageId !== messageId),
    notifications: st.notifications.filter((x) => x.messageId !== messageId),
  }));
}

/** Display name helper for toasts. */
export const personName = nameOf;
