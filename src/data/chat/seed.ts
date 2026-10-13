/**
 * Chat demo seed, relative to "now" like the CRM seed (src/data/seed.ts).
 * Matches docs/design/chats-mockup.html: four pinned team chats
 * (Announcements, Main chat, Daily wins, High signal), a "Fall Weekend
 * carpool" group, DMs with Anita Patel, Sarah Kim and David Chen, an event
 * card for Fall Leadership Weekend (e1), win cards pointing at seed records,
 * a reply quoting an older message, reactions, a mention of Maria, one pending
 * announcement draft by Sarah Kim, an open report and two library items.
 *
 * Check-in demo: Anita DMs Maria earlier today (and Jamal); replying as Maria
 * (or Jamal) logs a contact for both people and a checkin_logged notification.
 *
 * Pure: no stores, safe in unit tests. Seed media ("seed:" storage paths) is
 * synthesised on demand by ./attachments.
 */
import { addDays, format } from "date-fns";
import { parseDate } from "@/lib/dates";
import { seedEvents, seedLearning, seedPeople, seedSales } from "@/data/seed";
import type { CrmPerson } from "@/stores/peopleStore";
import { dmId } from "./rules";
import {
  WORKSPACE_ID,
  type AnnouncementDraft,
  type Attachment,
  type ChatData,
  type Conversation,
  type ConversationMember,
  type LibraryItem,
  type Mention,
  type Message,
  type MessageCard,
  type Notification,
  type Reaction,
  type Report,
  type WorkspaceMember,
  type WorkspaceRole,
} from "./types";

/** Workspace roles in the demo (everyone else is a member). */
export const SEED_ROLES: Record<string, WorkspaceRole> = { "1": "leader", "2": "moderator" };

/** Ids used by the UI and tests. */
export const CHAT_IDS = {
  announcements: "announcements",
  main: "main",
  dailyWins: "daily-wins",
  highSignal: "high-signal",
  carpool: "carpool",
} as const;

/**
 * Apprentices and IBOs chat. (The effective stage only ever moves an
 * apprentice to IBO, so the stored stage decides eligibility here.)
 */
const isChatStage = (p: CrmPerson) => p.bizClass === "ibo" || p.bizClass === "apprentice";

export function seedChat(people: CrmPerson[] = seedPeople(), nowMs: number = Date.now()): ChatData {
  const today = new Date(nowMs);
  const minsAgo = (m: number) => new Date(nowMs - m * 60_000).toISOString();
  const daysAgoAt = (d: number, hour: number, minute = 0) => {
    const t = addDays(today, -d);
    t.setHours(hour, minute, 0, 0);
    // Never in the future (early in the morning "yesterday 20:00" is still fine).
    return new Date(Math.min(t.getTime(), nowMs - 60_000)).toISOString();
  };

  // ---- Workspace members: every apprentice / IBO, plus the leader ----
  const eligible = people.filter(
    (p) => p.bizClass !== "customer" && (SEED_ROLES[p.id] === "leader" || isChatStage(p)),
  );
  const members: WorkspaceMember[] = eligible.map((p) => ({
    workspaceId: WORKSPACE_ID,
    personId: p.id,
    role: SEED_ROLES[p.id] ?? "member",
    joinedAt: daysAgoAt(40, 9),
  }));
  const memberIds = members.map((m) => m.personId);

  // ---- Conversations ----
  const conv = (
    id: string,
    kind: Conversation["kind"],
    title: string | null,
    o: Partial<Conversation> = {},
  ): Conversation => ({
    id,
    workspaceId: WORKSPACE_ID,
    kind,
    title,
    description: null,
    icon: null,
    pinned: false,
    retentionDays: null,
    createdBy: "1",
    createdAt: daysAgoAt(40, 9),
    pinnedMessageId: null,
    ...o,
  });
  const conversations: Conversation[] = [
    conv(CHAT_IDS.announcements, "announcements", "Announcements", {
      description: "Team news. Posts by members are approved by a leader or moderator first.",
      icon: "megaphone",
      pinned: true,
    }),
    conv(CHAT_IDS.main, "main", "Main chat", {
      description: "Everyone on the team.",
      icon: "users",
      pinned: true,
    }),
    conv(CHAT_IDS.dailyWins, "group", "Daily wins", {
      description: "Share your wins. Every card here is also logged in the CRM.",
      icon: "trophy",
      pinned: true,
      createdAt: daysAgoAt(40, 9, 1),
    }),
    conv(CHAT_IDS.highSignal, "group", "High signal", {
      description: "Questions and important discussion only. Wins go in Daily wins.",
      icon: "sparkles",
      pinned: true,
      createdAt: daysAgoAt(40, 9, 2),
      pinnedMessageId: "hs0",
    }),
    conv(CHAT_IDS.carpool, "group", "Fall Weekend carpool", {
      description: "Rides to Fall Leadership Weekend in Dallas.",
      icon: "car",
      createdBy: "3",
      createdAt: daysAgoAt(2, 17),
    }),
    conv(dmId("1", "2"), "dm", null, { createdAt: daysAgoAt(30, 12) }),
    conv(dmId("1", "7"), "dm", null, { createdAt: daysAgoAt(20, 12) }),
    conv(dmId("1", "3"), "dm", null, { createdAt: daysAgoAt(25, 12) }),
    conv(dmId("2", "4"), "dm", null, { createdBy: "2", createdAt: daysAgoAt(30, 12) }),
  ];

  // ---- Messages ----
  const messages: Message[] = [];
  const msg = (
    id: string,
    conversationId: string,
    authorId: string,
    body: string,
    createdAt: string,
    o: { replyToId?: string; card?: MessageCard } = {},
  ) => {
    messages.push({
      id,
      conversationId,
      authorId,
      body,
      replyToId: o.replyToId ?? null,
      card: o.card ?? null,
      createdAt,
      editedAt: null,
      deletedAt: null,
    });
    return createdAt;
  };

  const e1 = seedEvents().find((e) => e.id === "e1")!;
  const ticketsClose = format(addDays(parseDate(e1.date), -7), "MMM d");
  const anitaLearning = seedLearning().find((l) => l.personId === "2" && l.kind === "podcast")!;
  const jamalSale = seedSales().find((s) => s.customerId === "c8")!;
  // The spam message comes from a generated member (not a demo user).
  const spammer = memberIds.find((id) => Number(id) >= 300) ?? "13";

  // Announcements
  msg(
    "an1",
    CHAT_IDS.announcements,
    "1",
    "Welcome to LevelUp chats! Announcements, Main chat, Daily wins and High signal are pinned at the top. Side groups and direct messages are below them.",
    daysAgoAt(3, 9),
  );
  msg(
    "an2",
    CHAT_IDS.announcements,
    "1",
    `Fall Leadership Weekend tickets close ${ticketsClose}. Grab yours and tap Bought ticket so we can plan rooms and rides.`,
    minsAgo(120),
    { card: { type: "event", eventId: "e1" } },
  );

  // Main chat
  msg(
    "mc1",
    CHAT_IDS.main,
    "1",
    "Great meeting last night, everyone. This month the focus is Fall Weekend tickets.",
    daysAgoAt(1, 20),
  );
  msg("mc2", CHAT_IDS.main, "3", "Thanks Maria! My team is on it.", daysAgoAt(1, 20, 30));
  msg(
    "mc3",
    CHAT_IDS.main,
    spammer,
    "DM me for a crypto opportunity, guaranteed returns 🚀🚀",
    minsAgo(90),
  );
  const mainRead = minsAgo(60);
  msg("mc4", CHAT_IDS.main, "13", "Does anyone have the slides from last month?", minsAgo(35));
  msg("mc5", CHAT_IDS.main, "8", "Who's bringing the projector?", minsAgo(25));

  // Daily wins
  const winsRead = msg("dw1", CHAT_IDS.dailyWins, "1", "", minsAgo(240), {
    card: {
      type: "win",
      winKind: "ticket",
      refId: "a1",
      title: "Bought my ticket",
      detail: e1.name,
    },
  });
  msg("dw2", CHAT_IDS.dailyWins, "8", "", minsAgo(140), {
    card: {
      type: "win",
      winKind: "contact",
      refId: "12",
      title: "Just made a new contact",
      detail: "Recruiting · met at the gym",
    },
  });
  msg("dw3", CHAT_IDS.dailyWins, "2", "Great episode on consistency today.", minsAgo(100), {
    card: { type: "learning", learningId: anitaLearning.id, title: anitaLearning.title },
  });
  msg("dw4", CHAT_IDS.dailyWins, "4", "Third one this week", minsAgo(75), {
    card: {
      type: "win",
      winKind: "sale",
      refId: jamalSale.id,
      title: "Made a sale",
      detail: jamalSale.product,
    },
  });

  // High signal
  msg(
    "hs0",
    CHAT_IDS.highSignal,
    "1",
    "How to set up your first home meeting: the checklist we use. Read it before your first one.",
    daysAgoAt(30, 18),
    { card: { type: "link", target: { kind: "material", id: "lib-2" } } },
  );
  msg(
    "hs1",
    CHAT_IDS.highSignal,
    "1",
    "Bring two guests to every open meeting, even if they say maybe. Half of the maybes end up coming.",
    daysAgoAt(20, 19),
  );
  msg(
    "hs2",
    CHAT_IDS.highSignal,
    "1",
    "Fall Leadership Weekend is coming up. Tap below so we can plan rooms and rides.",
    minsAgo(300),
    { card: { type: "event", eventId: "e1" } },
  );
  msg(
    "hs3",
    CHAT_IDS.highSignal,
    "4",
    "@Maria Reyes does this still apply for the Fall Weekend? I have two prospects who might come.",
    minsAgo(240),
    { replyToId: "hs1" },
  );
  msg(
    "hs4",
    CHAT_IDS.highSignal,
    "1",
    "Yes! Bring them both. Book them into the Saturday session.",
    minsAgo(215),
    { replyToId: "hs3" },
  );
  msg(
    "hs5",
    CHAT_IDS.highSignal,
    "2",
    "Quick thought on inviting, and the talk that helped me most:",
    minsAgo(180),
    { card: { type: "link", target: { kind: "material", id: "lib-1" } } },
  );

  // Carpool
  msg(
    "cp1",
    CHAT_IDS.carpool,
    "3",
    "Starting a carpool thread for the Fall Weekend. Who needs a ride?",
    daysAgoAt(1, 18),
  );
  msg(
    "cp2",
    CHAT_IDS.carpool,
    "7",
    "Me please! I'm flying into Dallas though, can someone grab me at the airport?",
    daysAgoAt(1, 18, 20),
  );
  msg("cp3", CHAT_IDS.carpool, "3", "Here's the route from Plano", daysAgoAt(1, 19));
  msg("cp4", CHAT_IDS.carpool, "3", "I can take 3 from Plano", daysAgoAt(1, 19, 5));

  // DMs
  const dmAnita = dmId("1", "2");
  msg("d12a", dmAnita, "1", "Can we go over your Fall Weekend list this week?", daysAgoAt(1, 17));
  const anitaRead = msg("d12b", dmAnita, "2", "Sounds good, talk tomorrow", daysAgoAt(1, 17, 30));
  msg(
    "d12c",
    dmAnita,
    "2",
    "Hey! Three more people on my team want tickets. Can we talk today?",
    minsAgo(45),
  );
  msg("d17a", dmId("1", "7"), "1", "Did you grab your ticket yet?", daysAgoAt(3, 12));
  msg("d13a", dmId("1", "3"), "3", "", daysAgoAt(4, 21));
  const dmJamal = dmId("2", "4");
  const jamalRead = msg(
    "d24a",
    dmJamal,
    "4",
    "Thanks for the help with the plan yesterday!",
    daysAgoAt(1, 21),
  );
  msg("d24b", dmJamal, "2", "How did the follow-up with your two prospects go?", minsAgo(50));

  // ---- Attachments (seed media is synthesised: see ./attachments) ----
  const attachments: Attachment[] = [
    {
      id: "att-hs5",
      messageId: "hs5",
      kind: "voice",
      storagePath: "seed:voice:42000:7",
      mime: "audio/wav",
      size: 42 * 16000,
      durationMs: 42000,
      width: null,
      height: null,
    },
    {
      id: "att-d13a",
      messageId: "d13a",
      kind: "voice",
      storagePath: "seed:voice:65000:3",
      mime: "audio/wav",
      size: 65 * 16000,
      durationMs: 65000,
      width: null,
      height: null,
    },
    {
      id: "att-cp3",
      messageId: "cp3",
      kind: "image",
      storagePath: "seed:image:route",
      mime: "image/svg+xml",
      size: 2400,
      durationMs: null,
      width: 1200,
      height: 800,
    },
  ];

  // ---- Conversation members ----
  const conversationMembers: ConversationMember[] = [];
  const lastIn = (cid: string) =>
    messages
      .filter((m) => m.conversationId === cid)
      .reduce((a, m) => (m.createdAt > a ? m.createdAt : a), "");
  const join = (
    cid: string,
    personId: string,
    o: Partial<ConversationMember> = {},
  ): ConversationMember => ({
    conversationId: cid,
    personId,
    role: "member",
    lastReadAt: lastIn(cid) || null,
    muted: false,
    joinedAt: daysAgoAt(40, 9),
    ...o,
  });
  const teamRole = (id: string): ConversationMember["role"] =>
    SEED_ROLES[id] === "leader" ? "admin" : SEED_ROLES[id] === "moderator" ? "moderator" : "member";
  for (const c of conversations.filter((c) => c.pinned)) {
    for (const id of memberIds) conversationMembers.push(join(c.id, id, { role: teamRole(id) }));
  }
  const set = (cid: string, pid: string, patch: Partial<ConversationMember>) => {
    const m = conversationMembers.find((x) => x.conversationId === cid && x.personId === pid);
    if (m) Object.assign(m, patch);
  };
  // Maria: 2 unread in Main chat, 3 in Daily wins; she reads High signal (mentions only).
  set(CHAT_IDS.main, "1", { lastReadAt: mainRead });
  set(CHAT_IDS.dailyWins, "1", { lastReadAt: winsRead });
  set(CHAT_IDS.highSignal, "1", { muted: true });
  // Anita and Jamal have a few unread too.
  set(CHAT_IDS.dailyWins, "2", { lastReadAt: minsAgo(120) });
  set(CHAT_IDS.main, "4", { lastReadAt: mainRead });
  set(CHAT_IDS.highSignal, "4", { lastReadAt: minsAgo(230) });

  for (const id of ["3", "1", "2", "4", "7", "8", "13"]) {
    conversationMembers.push(
      join(CHAT_IDS.carpool, id, {
        role: id === "3" ? "admin" : "member",
        joinedAt: daysAgoAt(2, 17),
      }),
    );
  }
  conversationMembers.push(
    join(dmAnita, "1", { lastReadAt: anitaRead }),
    join(dmAnita, "2"),
    join(dmId("1", "7"), "1", { muted: true }),
    join(dmId("1", "7"), "7"),
    join(dmId("1", "3"), "1"),
    join(dmId("1", "3"), "3"),
    join(dmJamal, "2"),
    join(dmJamal, "4", { lastReadAt: jamalRead }),
  );

  // ---- Reactions ----
  const reactions: Reaction[] = [];
  const react = (messageId: string, emoji: string, ids: string[], at: string) =>
    ids.forEach((personId) => reactions.push({ messageId, personId, emoji, createdAt: at }));
  react("dw4", "🎉", ["1", "2", "3", "6", "8", "13"], minsAgo(70));
  react("dw4", "🔥", ["7", "11", "14"], minsAgo(65));
  react("dw1", "🙌", ["2", "3", "4", "6", "7", "8", "13", "14", "17"], minsAgo(230));
  react("hs5", "🔥", ["1", "4", "7", "8"], minsAgo(170));
  react("hs5", "👍", ["3", "6"], minsAgo(160));
  react("an2", "👍", ["2", "3", "8"], minsAgo(110));

  const mentions: Mention[] = [{ messageId: "hs3", personId: "1" }];

  // ---- Announcement draft, report ----
  const drafts: AnnouncementDraft[] = [
    {
      id: "draft-1",
      conversationId: CHAT_IDS.announcements,
      authorId: "7",
      body: "Carpool sign-up for the Fall Weekend is open. Reply in Fall Weekend carpool if you can drive or need a ride.",
      card: null,
      status: "pending",
      reviewerId: null,
      reviewedAt: null,
      createdAt: minsAgo(5),
    },
  ];
  const reports: Report[] = [
    {
      id: "report-1",
      messageId: "mc3",
      reporterId: "8",
      reason: "Spam",
      createdAt: minsAgo(40),
      resolvedAt: null,
      resolvedBy: null,
    },
  ];

  // ---- Notifications ----
  const notifications: Notification[] = [];
  let n = 0;
  const notify = (
    recipientId: string,
    type: Notification["type"],
    o: Partial<Notification> & { createdAt: string },
  ) =>
    notifications.push({
      id: `n${n++}`,
      recipientId,
      type,
      actorId: null,
      conversationId: null,
      messageId: null,
      refId: null,
      readAt: null,
      ...o,
    });
  for (const approver of ["1", "2"]) {
    notify(approver, "announcement_draft", {
      actorId: "7",
      conversationId: CHAT_IDS.announcements,
      refId: "draft-1",
      createdAt: minsAgo(5),
    });
  }
  notify("1", "report", {
    actorId: "8",
    conversationId: CHAT_IDS.main,
    messageId: "mc3",
    refId: "report-1",
    createdAt: minsAgo(40),
  });
  notify("1", "mention", {
    actorId: "4",
    conversationId: CHAT_IDS.highSignal,
    messageId: "hs3",
    createdAt: minsAgo(240),
  });
  for (const upline of ["2", "1"]) {
    notify(upline, "win", {
      actorId: "4",
      conversationId: CHAT_IDS.dailyWins,
      messageId: "dw4",
      createdAt: minsAgo(75),
    });
  }
  ["4", "7", "11", "14", "19"].forEach((actorId, i) =>
    notify("1", "event_post", {
      actorId,
      conversationId: CHAT_IDS.highSignal,
      messageId: "hs2",
      refId: "e1",
      createdAt: minsAgo(290 - i * 20),
      readAt: minsAgo(100),
    }),
  );
  notify("1", "checkin_logged", {
    actorId: "2",
    conversationId: dmAnita,
    messageId: "d12b",
    createdAt: daysAgoAt(1, 17, 30),
    readAt: daysAgoAt(1, 18),
  });
  notify("2", "reaction", {
    actorId: "1",
    conversationId: CHAT_IDS.highSignal,
    messageId: "hs5",
    refId: "🔥",
    createdAt: minsAgo(170),
    readAt: minsAgo(150),
  });
  notify("4", "reply", {
    actorId: "1",
    conversationId: CHAT_IDS.highSignal,
    messageId: "hs4",
    createdAt: minsAgo(215),
  });
  notify("4", "reaction", {
    actorId: "1",
    conversationId: CHAT_IDS.dailyWins,
    messageId: "dw4",
    refId: "🎉",
    createdAt: minsAgo(70),
  });

  // ---- Library ----
  const library: LibraryItem[] = [
    {
      id: "lib-1",
      workspaceId: WORKSPACE_ID,
      kind: "audio",
      title: "Talk: Inviting without pressure",
      durationSec: 18 * 60,
      url: "library/inviting-without-pressure.m4a",
      createdBy: "1",
      createdAt: daysAgoAt(60, 12),
    },
    {
      id: "lib-2",
      workspaceId: WORKSPACE_ID,
      kind: "document",
      title: "How to set up your first home meeting",
      durationSec: null,
      url: "library/first-home-meeting.pdf",
      createdBy: "1",
      createdAt: daysAgoAt(31, 12),
    },
  ];

  return {
    members,
    conversations,
    conversationMembers,
    messages,
    attachments,
    reactions,
    mentions,
    drafts,
    notifications,
    reports,
    blocks: [],
    library,
  };
}
