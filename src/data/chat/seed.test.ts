import { describe, expect, it } from "vitest";
import { seedAttendances, seedEvents, seedLearning, seedPeople, seedSales } from "@/data/seed";
import { CHAT_IDS, seedChat } from "./seed";
import { conversationCheckin, dmId, isTeamChat, unreadCount } from "./rules";
import type { Message } from "./types";

const NOW = Date.now();
const people = seedPeople();
const data = seedChat(people, NOW);
const byId = new Map(people.map((p) => [p.id, p]));
const memberIds = new Set(data.members.map((m) => m.personId));
const inConv = (cid: string, pid: string) =>
  data.conversationMembers.some((m) => m.conversationId === cid && m.personId === pid);
const msgById = new Map(data.messages.map((m) => [m.id, m]));

describe("chat seed: people and roles", () => {
  it("only apprentices and IBOs are workspace members (no prospects, customers or Beau)", () => {
    for (const id of memberIds) {
      expect(["apprentice", "ibo"], id).toContain(byId.get(id)?.bizClass);
    }
    expect(memberIds.has("20")).toBe(false);
    expect(memberIds.size).toBeGreaterThan(20);
  });

  it("Maria leads, Anita moderates, everyone else is a member", () => {
    const role = new Map(data.members.map((m) => [m.personId, m.role]));
    expect(role.get("1")).toBe("leader");
    expect(role.get("2")).toBe("moderator");
    expect(role.get("4")).toBe("member");
    expect([...role.values()].filter((r) => r !== "member")).toHaveLength(2);
  });

  it("everyone is in the four pinned team chats; conversation members are workspace members", () => {
    const team = data.conversations.filter((c) => isTeamChat(c));
    expect(team.map((c) => c.title)).toEqual([
      "Announcements",
      "Main chat",
      "Daily wins",
      "High signal",
    ]);
    for (const c of team)
      for (const id of memberIds) expect(inConv(c.id, id), `${id} in ${c.id}`).toBe(true);
    for (const m of data.conversationMembers) expect(memberIds.has(m.personId)).toBe(true);
  });

  it("team chats start pinned for everyone; nothing else is pinned", () => {
    const pinnedConv = new Set(data.conversations.filter((c) => c.pinned).map((c) => c.id));
    for (const m of data.conversationMembers) {
      expect(!!m.pinnedAt, `${m.personId} in ${m.conversationId}`).toBe(
        pinnedConv.has(m.conversationId),
      );
    }
  });

  it("DMs have exactly two members and a stable id; the carpool group has an admin", () => {
    for (const c of data.conversations.filter((c) => c.kind === "dm")) {
      const ms = data.conversationMembers.filter((m) => m.conversationId === c.id);
      expect(ms).toHaveLength(2);
      expect(c.id).toBe(dmId(ms[0].personId, ms[1].personId));
      expect(c.title).toBeNull();
    }
    const admins = data.conversationMembers.filter(
      (m) => m.conversationId === CHAT_IDS.carpool && m.role === "admin",
    );
    expect(admins.map((m) => m.personId)).toEqual(["3"]);
  });
});

describe("chat seed: messages", () => {
  it("authors belong to their conversation; nothing is in the future", () => {
    for (const m of data.messages) {
      expect(inConv(m.conversationId, m.authorId), `${m.id}`).toBe(true);
      expect(Date.parse(m.createdAt)).toBeLessThanOrEqual(NOW);
    }
  });

  it("replies, attachments, reactions, mentions and the pin point at real messages", () => {
    for (const m of data.messages.filter((x) => x.replyToId)) {
      expect(msgById.get(m.replyToId!)?.conversationId).toBe(m.conversationId);
    }
    for (const a of data.attachments) expect(msgById.has(a.messageId)).toBe(true);
    for (const r of data.reactions) {
      const m = msgById.get(r.messageId);
      expect(m && inConv(m.conversationId, r.personId)).toBe(true);
    }
    expect(data.mentions).toEqual([{ messageId: "hs3", personId: "1" }]);
    expect(msgById.get("hs3")?.body).toContain("@Maria Reyes");
    for (const c of data.conversations) {
      if (c.pinnedMessageId) expect(msgById.get(c.pinnedMessageId)?.conversationId).toBe(c.id);
    }
  });

  it("cards point at real seed records", () => {
    const events = new Set(seedEvents().map((e) => e.id));
    const sales = new Set(seedSales().map((s) => s.id));
    const attendance = new Set(seedAttendances().map((a) => a.id));
    const learning = new Set(seedLearning().map((l) => l.id));
    const library = new Set(data.library.map((l) => l.id));
    const cards = data.messages.flatMap((m) => (m.card ? [m.card] : []));
    expect(cards.some((c) => c.type === "event" && c.eventId === "e1")).toBe(true);
    for (const c of cards) {
      if (c.type === "event") expect(events.has(c.eventId)).toBe(true);
      if (c.type === "learning") expect(learning.has(c.learningId)).toBe(true);
      if (c.type === "link" && c.target.kind === "material") {
        expect(library.has(c.target.id)).toBe(true);
      }
      if (c.type === "win") {
        if (c.winKind === "sale") expect(sales.has(c.refId)).toBe(true);
        if (c.winKind === "ticket") expect(attendance.has(c.refId)).toBe(true);
        if (c.winKind === "contact") expect(byId.has(c.refId)).toBe(true);
      }
    }
  });

  it("win posts never name a prospect", () => {
    const prospects = people.filter((p) => p.bizClass === "prospect").map((p) => p.name);
    for (const m of data.messages.filter((x) => x.card?.type === "win")) {
      const card = m.card as Extract<Message["card"], { type: "win" }>;
      const text = `${m.body} ${card.title} ${card.detail ?? ""}`;
      for (const n of prospects) expect(text).not.toContain(n);
    }
  });
});

describe("chat seed: demo state", () => {
  const unreadFor = (cid: string, pid: string) =>
    unreadCount(
      data.messages.filter((m) => m.conversationId === cid),
      data.conversationMembers.find((m) => m.conversationId === cid && m.personId === pid),
    );

  it("Maria has 2 unread in Main chat, 3 in Daily wins, 1 from Anita", () => {
    expect(unreadFor(CHAT_IDS.main, "1")).toBe(2);
    expect(unreadFor(CHAT_IDS.dailyWins, "1")).toBe(3);
    expect(unreadFor(dmId("1", "2"), "1")).toBe(1);
    expect(unreadFor(CHAT_IDS.highSignal, "1")).toBe(0);
  });

  it("one pending announcement draft by Sarah Kim, waiting for Maria and Anita", () => {
    const pending = data.drafts.filter((d) => d.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].authorId).toBe("7");
    const notified = data.notifications
      .filter((n) => n.type === "announcement_draft" && n.refId === pending[0].id)
      .map((n) => n.recipientId)
      .sort();
    expect(notified).toEqual(["1", "2"]);
  });

  it("the open report notifies only the leader", () => {
    const open = data.reports.filter((r) => !r.resolvedAt);
    expect(open).toHaveLength(1);
    expect(data.notifications.filter((n) => n.type === "report").map((n) => n.recipientId)).toEqual(
      ["1"],
    );
  });

  it("notifications go to workspace members and reference real rows", () => {
    for (const n of data.notifications) {
      expect(memberIds.has(n.recipientId)).toBe(true);
      if (n.messageId) expect(msgById.has(n.messageId)).toBe(true);
      if (n.conversationId) expect(inConv(n.conversationId, n.recipientId)).toBe(true);
    }
  });

  it("replying now as Maria to Anita (or as Jamal to Anita) completes a conversation", () => {
    for (const [me, other] of [
      ["1", "2"],
      ["4", "2"],
    ]) {
      const cid = dmId(me, other);
      const reply: Message = {
        id: "new",
        conversationId: cid,
        authorId: me,
        body: "On it",
        replyToId: null,
        card: null,
        createdAt: new Date(NOW).toISOString(),
        editedAt: null,
        deletedAt: null,
      };
      expect(
        conversationCheckin({
          conversation: { id: cid, kind: "dm" },
          message: reply,
          messages: data.messages.filter((m) => m.conversationId === cid),
          dmPartnerId: other,
        }),
      ).toEqual({ a: me, b: other });
    }
  });
});
