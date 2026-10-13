import { describe, expect, it } from "vitest";
import {
  canDeleteMessage,
  canDm,
  canEditMessage,
  canManageGroup,
  canModerate,
  canPinMore,
  canPostAnnouncement,
  chatTab,
  conversationCheckin,
  DAY_MS,
  dmId,
  extractMentions,
  isChatEligible,
  isExpired,
  MAX_PINS_PER_TAB,
  needsApproval,
  purgeExpired,
  shareConversation,
  sortConversations,
  unreadCount,
  uplineOf,
} from "./rules";
import { eventIcs, googleCalendarUrl, icsEscape } from "./calendar";
import type { Conversation, ConversationMember, Message } from "./types";

const T0 = Date.parse("2026-10-12T18:00:00.000Z");
const at = (minsBefore: number) => new Date(T0 - minsBefore * 60_000).toISOString();

const msg = (
  id: string,
  authorId: string,
  minsBefore: number,
  o: Partial<Message> = {},
): Message => ({
  id,
  conversationId: "c",
  authorId,
  body: "hi",
  replyToId: null,
  card: null,
  createdAt: at(minsBefore),
  editedAt: null,
  deletedAt: null,
  ...o,
});

const member = (conversationId: string, personId: string): ConversationMember => ({
  conversationId,
  personId,
  role: "member",
  lastReadAt: null,
  muted: false,
  joinedAt: at(9999),
  pinnedAt: null,
});

describe("chat eligibility", () => {
  it("apprentices, IBOs and leaders chat; prospects, customers and candidates don't", () => {
    expect(isChatEligible({ stage: "apprentice" })).toBe(true);
    expect(isChatEligible({ stage: "ibo" })).toBe(true);
    expect(isChatEligible({ stage: "prospect" })).toBe(false);
    expect(isChatEligible({ stage: "customer" })).toBe(false);
    expect(isChatEligible({ stage: undefined })).toBe(false);
    expect(isChatEligible({ stage: "prospect", workspaceRole: "leader" })).toBe(true);
    expect(isChatEligible({ stage: "ibo", sessionRole: "leader" })).toBe(true);
    // The candidate demo role never chats, whatever the stage.
    expect(isChatEligible({ stage: "ibo", sessionRole: "candidate" })).toBe(false);
  });
});

describe("announcements", () => {
  it("leaders and moderators post directly; members need approval", () => {
    expect(canPostAnnouncement("leader")).toBe(true);
    expect(canPostAnnouncement("moderator")).toBe(true);
    expect(canPostAnnouncement("member")).toBe(false);
    expect(needsApproval("member")).toBe(true);
    expect(needsApproval(null)).toBe(true);
    expect(needsApproval("leader")).toBe(false);
  });
});

describe("moderation", () => {
  const team = { kind: "main" as const, pinned: true };
  const pinnedGroup = { kind: "group" as const, pinned: true };
  const side = { kind: "group" as const, pinned: false };
  const dm = { kind: "dm" as const, pinned: false };

  it("team chats: leaders and workspace moderators", () => {
    expect(
      canModerate({ conversation: team, workspaceRole: "leader", conversationRole: "member" }),
    ).toBe(true);
    expect(
      canModerate({ conversation: team, workspaceRole: "moderator", conversationRole: "member" }),
    ).toBe(true);
    expect(
      canModerate({
        conversation: pinnedGroup,
        workspaceRole: "member",
        conversationRole: "admin",
      }),
    ).toBe(false);
  });

  it("side groups: that group's admin and moderators", () => {
    expect(
      canModerate({ conversation: side, workspaceRole: "member", conversationRole: "admin" }),
    ).toBe(true);
    expect(
      canModerate({ conversation: side, workspaceRole: "member", conversationRole: "moderator" }),
    ).toBe(true);
    expect(
      canModerate({ conversation: side, workspaceRole: "leader", conversationRole: "member" }),
    ).toBe(false);
  });

  it("DMs: nobody moderates", () => {
    expect(
      canModerate({ conversation: dm, workspaceRole: "leader", conversationRole: "admin" }),
    ).toBe(false);
  });

  it("only side-group admins manage members", () => {
    expect(canManageGroup({ conversation: side, conversationRole: "admin" })).toBe(true);
    expect(canManageGroup({ conversation: side, conversationRole: "moderator" })).toBe(false);
    expect(canManageGroup({ conversation: pinnedGroup, conversationRole: "admin" })).toBe(false);
  });

  it("edit own; delete own or as moderator; never twice", () => {
    const m = msg("m", "a", 1);
    expect(canEditMessage("a", m)).toBe(true);
    expect(canEditMessage("b", m)).toBe(false);
    expect(canDeleteMessage("b", m, false)).toBe(false);
    expect(canDeleteMessage("b", m, true)).toBe(true);
    expect(canDeleteMessage("a", { ...m, deletedAt: at(0) }, true)).toBe(false);
  });
});

describe("direct messages", () => {
  const members = [member("main", "a"), member("main", "b"), member("g", "c")];
  const eligibleIds = new Set(["a", "b", "c"]);

  it("allowed between eligible people who share a chat", () => {
    expect(shareConversation(members, "a", "b")).toBe(true);
    expect(canDm("a", "b", { eligibleIds, members, blocks: [] })).toBe(true);
  });

  it("not with someone you share no chat with, yourself, or an ineligible person", () => {
    expect(canDm("a", "c", { eligibleIds, members, blocks: [] })).toBe(false);
    expect(canDm("a", "a", { eligibleIds, members, blocks: [] })).toBe(false);
    expect(canDm("a", "b", { eligibleIds: new Set(["a"]), members, blocks: [] })).toBe(false);
  });

  it("not when either person blocked the other", () => {
    const blocks = [{ blockerId: "b", blockedId: "a", createdAt: at(0) }];
    expect(canDm("a", "b", { eligibleIds, members, blocks })).toBe(false);
  });

  it("dm ids are stable for a pair", () => {
    expect(dmId("2", "1")).toBe(dmId("1", "2"));
  });
});

describe("conversation check-in", () => {
  const dm = { id: "c", kind: "dm" as const };
  const group = { id: "c", kind: "group" as const };

  it("DM: A posts after B posted to A within 24 hours", () => {
    const messages = [msg("b1", "b", 60)];
    const r = conversationCheckin({
      conversation: dm,
      message: msg("a1", "a", 0),
      messages,
      dmPartnerId: "b",
    });
    expect(r).toEqual({ a: "a", b: "b" });
  });

  it("DM: one direction only, or older than 24 hours, doesn't count", () => {
    expect(
      conversationCheckin({
        conversation: dm,
        message: msg("a2", "a", 0),
        messages: [msg("a1", "a", 30)],
        dmPartnerId: "b",
      }),
    ).toBeNull();
    expect(
      conversationCheckin({
        conversation: dm,
        message: msg("a1", "a", 0),
        messages: [msg("b1", "b", 24 * 60 + 1)],
        dmPartnerId: "b",
      }),
    ).toBeNull();
  });

  it("DM: a deleted message from B doesn't count", () => {
    expect(
      conversationCheckin({
        conversation: dm,
        message: msg("a1", "a", 0),
        messages: [msg("b1", "b", 10, { deletedAt: at(5) })],
        dmPartnerId: "b",
      }),
    ).toBeNull();
  });

  it("group: A replies to B after B replied to A", () => {
    const messages = [msg("a0", "a", 120), msg("b1", "b", 60, { replyToId: "a0" })];
    expect(
      conversationCheckin({
        conversation: group,
        message: msg("a1", "a", 0, { replyToId: "b1" }),
        messages,
      }),
    ).toEqual({ a: "a", b: "b" });
  });

  it("group: B mentioning A counts as B -> A", () => {
    const messages = [msg("b1", "b", 60)];
    expect(
      conversationCheckin({
        conversation: group,
        message: msg("a1", "a", 0, { replyToId: "b1" }),
        messages,
        mentions: [{ messageId: "b1", personId: "a" }],
      }),
    ).toEqual({ a: "a", b: "b" });
  });

  it("group: a plain message or a reply to a broadcast doesn't count", () => {
    const messages = [msg("b1", "b", 60)];
    expect(
      conversationCheckin({ conversation: group, message: msg("a1", "a", 0), messages }),
    ).toBeNull();
    expect(
      conversationCheckin({
        conversation: group,
        message: msg("a1", "a", 0, { replyToId: "b1" }),
        messages,
      }),
    ).toBeNull();
  });

  it("announcements never count", () => {
    expect(
      conversationCheckin({
        conversation: { id: "c", kind: "announcements" },
        message: msg("a1", "a", 0, { replyToId: "b1" }),
        messages: [msg("b1", "b", 10, { replyToId: "a0" }), msg("a0", "a", 20)],
      }),
    ).toBeNull();
  });
});

describe("retention", () => {
  const conv = (id: string, retentionDays: number | null) => ({ id, retentionDays });

  it("null keeps forever; otherwise older messages go", () => {
    const old = msg("old", "a", 40 * 24 * 60);
    expect(isExpired(old, conv("c", null), T0)).toBe(false);
    expect(isExpired(old, conv("c", 30), T0)).toBe(true);
    expect(isExpired(old, conv("c", 90), T0)).toBe(false);
  });

  it("purges per conversation", () => {
    const messages = [
      msg("x", "a", 31 * 24 * 60),
      msg("y", "a", 29 * 24 * 60),
      { ...msg("z", "a", 400 * 24 * 60), conversationId: "forever" },
    ];
    const { keep, removed } = purgeExpired(messages, [conv("c", 30), conv("forever", null)], T0);
    expect(keep.map((m) => m.id)).toEqual(["y", "z"]);
    expect([...removed]).toEqual(["x"]);
    expect(DAY_MS).toBe(86_400_000);
  });
});

describe("mentions and unread", () => {
  const people = [
    { id: "1", name: "Maria Reyes" },
    { id: "2", name: "Ann" },
    { id: "3", name: "Ann Lee" },
  ];

  it("finds @Full Name, prefers the longest name, needs a word boundary", () => {
    expect(extractMentions("@maria reyes, see this", people)).toEqual(["1"]);
    expect(extractMentions("thanks @Ann Lee!", people)).toEqual(["3"]);
    expect(extractMentions("hi @Ann and @Ann Lee", people).sort()).toEqual(["2", "3"]);
    expect(extractMentions("email ann@Annex.com", people)).toEqual([]);
  });

  it("counts others' messages after lastReadAt, skipping deleted and blocked", () => {
    const msgs = [
      msg("1", "b", 50),
      msg("2", "me", 40),
      msg("3", "b", 30, { deletedAt: at(1) }),
      msg("4", "b", 20),
      msg("5", "x", 10),
    ];
    const m = { personId: "me", lastReadAt: at(45) };
    expect(unreadCount(msgs, m)).toBe(2);
    expect(unreadCount(msgs, m, new Set(["x"]))).toBe(1);
    expect(unreadCount(msgs, { personId: "me", lastReadAt: null })).toBe(3);
    expect(unreadCount(msgs, undefined)).toBe(0);
  });
});

describe("chat list tabs, pins and ordering", () => {
  const row = (
    id: string,
    kind: Conversation["kind"],
    lastAt: string,
    pinnedAt: string | null,
  ) => ({
    id,
    conversation: { kind },
    lastAt,
    pinnedAt,
  });

  it("DMs are under Direct messages; everything else under Groups", () => {
    expect(chatTab({ kind: "dm" })).toBe("direct");
    expect(chatTab({ kind: "announcements" })).toBe("groups");
    expect(chatTab({ kind: "main" })).toBe("groups");
    expect(chatTab({ kind: "group" })).toBe("groups");
  });

  it("pinned first in the order pinned (team chats keep Announcements and Main on top), then by latest message", () => {
    const joined = at(5000);
    const rows = [
      row("side-old", "group", at(300), null),
      row("wins", "group", at(30), joined),
      row("main", "main", at(40), joined),
      row("side-new", "group", at(5), null),
      row("ann", "announcements", at(90), joined),
      row("signal", "group", at(2), joined),
      row("carpool", "group", at(500), at(60)),
      row("book-club", "group", at(1), at(10)),
    ];
    expect(sortConversations(rows).map((r) => r.id)).toEqual([
      "ann",
      "main",
      "signal",
      "wins",
      "carpool",
      "book-club",
      "side-new",
      "side-old",
    ]);
  });

  it("an unpinned team chat sorts by its latest message like any other", () => {
    const rows = [
      row("main", "main", at(40), null),
      row("side", "group", at(5), null),
      row("ann", "announcements", at(90), at(5000)),
    ];
    expect(sortConversations(rows).map((r) => r.id)).toEqual(["ann", "side", "main"]);
  });

  it("DMs: pinned first, then by latest message", () => {
    const rows = [
      row("dm-a", "dm", at(1), null),
      row("dm-b", "dm", at(100), at(20)),
      row("dm-c", "dm", at(50), null),
    ];
    expect(sortConversations(rows).map((r) => r.id)).toEqual(["dm-b", "dm-a", "dm-c"]);
  });

  it("caps pins at 10 per tab, counted separately for groups and DMs", () => {
    const convs: Pick<Conversation, "id" | "kind">[] = [];
    const members: ConversationMember[] = [];
    for (let i = 0; i < 12; i++) {
      convs.push({ id: `g${i}`, kind: "group" }, { id: `d${i}`, kind: "dm" });
      members.push(
        { ...member(`g${i}`, "me"), pinnedAt: i < MAX_PINS_PER_TAB ? at(100 - i) : null },
        member(`d${i}`, "me"),
      );
    }
    members.push({ ...member("g11", "other"), pinnedAt: at(1) });
    expect(MAX_PINS_PER_TAB).toBe(10);
    expect(canPinMore(convs, members, "me", "g10")).toBe(false);
    expect(canPinMore(convs, members, "me", "g3")).toBe(true); // already pinned
    expect(canPinMore(convs, members, "me", "d0")).toBe(true);
    expect(canPinMore(convs, members, "other", "g10")).toBe(true); // pins are personal
    const nine = members.map((m) =>
      m.conversationId === "g0" && m.personId === "me" ? { ...m, pinnedAt: null } : m,
    );
    expect(canPinMore(convs, nine, "me", "g10")).toBe(true);
    expect(canPinMore(convs, members, "me", "missing")).toBe(false);
  });
});

describe("uplines", () => {
  it("upline walks sponsors and stops on cycles", () => {
    const s = new Map<string, string | null>([
      ["4", "2"],
      ["2", "1"],
      ["1", null],
      ["x", "y"],
      ["y", "x"],
    ]);
    expect(uplineOf(s, "4")).toEqual(["2", "1"]);
    expect(uplineOf(s, "x")).toEqual(["y"]);
  });
});

describe("add to calendar", () => {
  const e = {
    id: "e1",
    name: "Fall Leadership Weekend",
    date: "2026-11-07",
    endDate: "2026-11-08",
    location: "Dallas, TX",
    notes: "Van leaves 7am; bring snacks",
  };

  it("builds an all-day iCalendar event with an exclusive end date", () => {
    const ics = eventIcs(e, new Date(2026, 9, 12, 9, 30));
    expect(ics).toContain("DTSTART;VALUE=DATE:20261107");
    expect(ics).toContain("DTEND;VALUE=DATE:20261109");
    expect(ics).toContain("LOCATION:Dallas\\, TX");
    expect(ics).toContain("DESCRIPTION:Van leaves 7am\\; bring snacks");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    expect(icsEscape("a\nb")).toBe("a\\nb");
  });

  it("links to Google Calendar with the same dates", () => {
    const url = new URL(googleCalendarUrl(e));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("dates")).toBe("20261107/20261109");
    expect(url.searchParams.get("text")).toBe("Fall Leadership Weekend");
    expect(googleCalendarUrl({ ...e, endDate: undefined })).toContain("20261107%2F20261108");
  });
});
