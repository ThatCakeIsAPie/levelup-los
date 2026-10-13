import { describe, expect, it } from "vitest";
import { seedEvents, seedPeople } from "@/data/seed";
import { seedChat } from "@/data/chat/seed";
import { CHANNEL_IDS, seedLibrary } from "./seed";
import {
  buildLibraryViewer,
  canSeeLibrary,
  channelItemIds,
  channelStats,
  continueCandidate,
  isLockedForViewer,
  isNewItem,
  itemDate,
  itemFitsChannel,
  parseLink,
} from "./rules";

const now = new Date();
const data = seedLibrary(now);
const people = seedPeople();
const itemById = new Map(data.items.map((i) => [i.id, i]));
const eventIds = new Set(seedEvents().map((e) => e.id));
const personIds = new Set(people.map((p) => p.id));
const topicIds = new Set(data.topics.map((t) => t.id));
const jamal = buildLibraryViewer({
  personId: "4",
  role: "apprentice",
  workspaceRole: "member",
  stage: "apprentice",
  people,
});
const mine = (personId: string) =>
  new Map(data.progress.filter((p) => p.personId === personId).map((p) => [p.itemId, p]));
const channel = (id: string) => data.channels.find((c) => c.id === id)!;

describe("library seed", () => {
  it("has 20 to 40 items with unique ids, and keeps the ids chat links point at", () => {
    expect(data.items.length).toBeGreaterThanOrEqual(20);
    expect(data.items.length).toBeLessThanOrEqual(40);
    expect(new Set(data.items.map((i) => i.id)).size).toBe(data.items.length);
    const chatMaterial = seedChat(people, now.getTime())
      .messages.map((m) => m.card)
      .filter((c) => c?.type === "link" && c.target.kind === "material")
      .map((c) => (c?.type === "link" ? c.target.id : ""));
    expect(chatMaterial.length).toBeGreaterThan(0);
    for (const id of chatMaterial) expect(itemById.has(id), id).toBe(true);
  });

  it("every item is complete and consistent", () => {
    for (const i of data.items) {
      expect(i.permissionConfirmed, i.id).toBe(true);
      expect(i.speakers.length, i.id).toBeGreaterThan(0);
      for (const s of i.speakers) {
        expect(!!s.personId !== !!s.name, i.id).toBe(true);
        if (s.personId) expect(personIds.has(s.personId), i.id).toBe(true);
      }
      for (const t of i.topicIds) expect(topicIds.has(t), i.id).toBe(true);
      if (i.eventId) expect(eventIds.has(i.eventId), i.id).toBe(true);
      expect(personIds.has(i.createdBy)).toBe(true);
      if (i.source === "upload") {
        expect(i.storagePath, i.id).toMatch(/^seed:(audio|video|pdf):/);
        expect(i.linkUrl).toBeNull();
      } else {
        expect(i.storagePath).toBeNull();
        expect(parseLink(i.linkUrl ?? "")?.provider, i.id).toBe(i.linkProvider);
      }
      if (i.kind === "audio" || i.kind === "video") expect(i.durationSec, i.id).toBeGreaterThan(0);
      else expect(i.pageCount, i.id).toBeGreaterThan(0);
      // Recorded before it was added.
      expect(itemDate(i) <= i.createdAt.slice(0, 10), i.id).toBe(true);
    }
  });

  it("varies speakers (incl. a guest), formats, kinds, sources and events", () => {
    expect(data.items.some((i) => i.speakers.some((s) => !s.personId))).toBe(true);
    expect(data.items.some((i) => i.speakers.length > 1)).toBe(true);
    expect(new Set(data.items.map((i) => i.format)).size).toBe(5);
    expect(new Set(data.items.map((i) => i.kind)).size).toBe(4);
    expect(new Set(data.items.map((i) => i.linkProvider).filter(Boolean)).size).toBe(3);
    expect(new Set(data.items.map((i) => i.eventId).filter(Boolean)).size).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("every lesson can be opened by everyone its channel is shared with", () => {
    for (const c of data.channels)
      for (const id of channelItemIds(c))
        expect(itemFitsChannel(c.visibility, itemById.get(id)!.visibility), `${c.id}/${id}`).toBe(
          true,
        );
  });

  it("channels only reference existing items; an item can be in several channels", () => {
    const counts = new Map<string, number>();
    for (const c of data.channels) {
      for (const id of channelItemIds(c)) {
        expect(itemById.has(id), `${c.id}/${id}`).toBe(true);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    expect([...counts.values()].some((n) => n > 1)).toBe(true);
    expect(channel(CHANNEL_IDS.recruiting).sections.map((s) => s.title)).toEqual([
      "Basics",
      "Inviting",
      "The first meeting",
    ]);
    expect(channelItemIds(channel(CHANNEL_IDS.recruiting))).toHaveLength(12);
  });

  it("Jamal sees the mockup: Start here done, Recruiting 5 of 12, lesson 6 in progress", () => {
    const p = mine("4");
    const start = channelStats(channelItemIds(channel(CHANNEL_IDS.start)), p);
    expect(start.fraction).toBe(1);
    const rec = channelStats(channelItemIds(channel(CHANNEL_IDS.recruiting)), p);
    expect(rec).toMatchObject({ done: 5, total: 12, nextId: "lib-1", nextNumber: 6 });
    expect(p.get("lib-1")?.positionSec).toBe(662);
    const anita = channelStats(channelItemIds(channel(CHANNEL_IDS.anita)), p);
    expect(anita).toMatchObject({ done: 1, total: 4 });
    expect(continueCandidate([...p.values()], () => true)?.itemId).toBe("lib-1");
  });

  it("Developing leaders is locked for Jamal; Anita's channel is from his upline", () => {
    const leaders = channel(CHANNEL_IDS.leaders);
    expect(isLockedForViewer(leaders, jamal)).toBe(true);
    const anita = channel(CHANNEL_IDS.anita);
    expect(anita.createdBy).toBe("2");
    expect(canSeeLibrary(anita, jamal)).toBe(true);
    const david = buildLibraryViewer({
      personId: "3",
      role: "ibo",
      workspaceRole: "member",
      stage: "ibo",
      people,
    });
    expect(canSeeLibrary(anita, david)).toBe(false);
  });

  it("Maria's talks has 2 new talks; done items were logged when finished", () => {
    const p = mine("4");
    const newOnes = channelItemIds(channel(CHANNEL_IDS.maria)).filter((id) =>
      isNewItem(itemById.get(id)!, p.get(id), now.getTime()),
    );
    expect(newOnes).toHaveLength(2);
    for (const row of data.progress) {
      if (row.completedAt) expect(row.loggedAt).toBe(row.completedAt);
      else expect(row.loggedAt).toBeNull();
    }
  });
});
