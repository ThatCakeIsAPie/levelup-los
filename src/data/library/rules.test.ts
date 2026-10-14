import { describe, expect, it } from "vitest";
import {
  allowedVisibilities,
  buildLibraryViewer,
  canCreateInLibrary,
  canEditLibrary,
  canManageTopics,
  canSeeLibrary,
  channelGroup,
  channelItemIds,
  channelStats,
  continueCandidate,
  filterCatalog,
  formatClock,
  formatMinutes,
  isLockedForViewer,
  isNewItem,
  itemFitsChannel,
  itemFraction,
  learningFor,
  lengthLabel,
  moveInSections,
  placeInSections,
  nextInChannel,
  nextProgress,
  parseLink,
  prevInChannel,
  reachedCompletion,
  remainingSec,
  resumePosition,
  topicCounts,
  validateChannelDraft,
  validateItemDraft,
  type ItemDraft,
  type LibraryViewer,
} from "./rules";
import type { CatalogItem, LibraryProgress } from "./types";

// A small team: Maria (1, leader) > Anita (2, IBO, moderator) > Jamal (4, apprentice) > Carlos (9, prospect)
// Maria > David (3, IBO) ; Beau (20, candidate) under Marcus (6).
const people = [
  { id: "1", sponsorId: null, bizClass: "ibo" },
  { id: "2", sponsorId: "1", bizClass: "ibo" },
  { id: "3", sponsorId: "1", bizClass: "ibo" },
  { id: "4", sponsorId: "2", bizClass: "apprentice" },
  { id: "9", sponsorId: "4", bizClass: "prospect" },
  { id: "6", sponsorId: "1", bizClass: "ibo" },
  { id: "20", sponsorId: "6", bizClass: "prospect" },
  { id: "c1", sponsorId: null, bizClass: "customer", ownerId: "9" },
];
const viewer = (
  personId: string,
  role: LibraryViewer["role"],
  stage: LibraryViewer["stage"],
  workspaceRole: LibraryViewer["workspaceRole"] = "member",
) => buildLibraryViewer({ personId, role, workspaceRole, stage, people });

const maria = viewer("1", "leader", "ibo", "leader");
const anita = viewer("2", "ibo", "ibo", "moderator");
const david = viewer("3", "ibo", "ibo");
const jamal = viewer("4", "apprentice", "apprentice");
const carlos = viewer("9", "apprentice", "prospect");
const beau = viewer("20", "candidate", "prospect", null);

describe("viewer", () => {
  it("knows the upline chain and whether there is a downline", () => {
    expect([...jamal.uplineIds].sort()).toEqual(["1", "2"]);
    expect(jamal.hasDownline).toBe(true);
    expect(david.hasDownline).toBe(false);
    expect(maria.uplineIds.size).toBe(0);
  });
});

describe("visibility", () => {
  const team = { createdBy: "1", visibility: "team" as const };
  const ibos = { createdBy: "1", visibility: "ibos" as const };
  const anitaDownline = { createdBy: "2", visibility: "downline" as const };

  it("whole team: everyone, candidates included", () => {
    for (const v of [maria, anita, jamal, beau]) expect(canSeeLibrary(team, v)).toBe(true);
    expect(canSeeLibrary(team, null)).toBe(false);
  });

  it("IBOs and leaders: IBOs, leaders and moderators; apprentices and candidates see it locked", () => {
    expect(canSeeLibrary(ibos, maria)).toBe(true);
    expect(canSeeLibrary(ibos, david)).toBe(true);
    expect(canSeeLibrary(ibos, jamal)).toBe(false);
    expect(canSeeLibrary(ibos, beau)).toBe(false);
    expect(isLockedForViewer(ibos, jamal)).toBe(true);
    expect(isLockedForViewer(ibos, david)).toBe(false);
    expect(isLockedForViewer(team, jamal)).toBe(false);
  });

  it("an apprentice past their anniversary (stage IBO) opens IBO content", () => {
    const promoted = viewer("4", "apprentice", "ibo");
    expect(canSeeLibrary(ibos, promoted)).toBe(true);
  });

  it("my downline: the creator and everyone below them, not their upline or side lines", () => {
    expect(canSeeLibrary(anitaDownline, anita)).toBe(true);
    expect(canSeeLibrary(anitaDownline, jamal)).toBe(true);
    expect(canSeeLibrary(anitaDownline, carlos)).toBe(true);
    expect(canSeeLibrary(anitaDownline, maria)).toBe(false);
    expect(canSeeLibrary(anitaDownline, david)).toBe(false);
    expect(canSeeLibrary(anitaDownline, beau)).toBe(false);
    expect(isLockedForViewer(anitaDownline, david)).toBe(false);
  });

  it("a channel only takes lessons its whole audience can open", () => {
    expect(itemFitsChannel("team", "team")).toBe(true);
    expect(itemFitsChannel("team", "ibos")).toBe(false);
    expect(itemFitsChannel("team", "downline")).toBe(false);
    expect(itemFitsChannel("ibos", "ibos")).toBe(true);
    expect(itemFitsChannel("ibos", "downline")).toBe(false);
    expect(itemFitsChannel("downline", "downline")).toBe(true);
    expect(itemFitsChannel("downline", "ibos")).toBe(false);
  });

  it("groups channels: team, from your upline, your own", () => {
    expect(channelGroup(team, jamal)).toBe("team");
    expect(channelGroup(anitaDownline, jamal)).toBe("upline");
    expect(channelGroup(anitaDownline, anita)).toBe("mine");
  });
});

describe("who can create and edit", () => {
  it("leaders and moderators create for anyone; people with a downline for their downline only", () => {
    expect(allowedVisibilities(maria)).toEqual(["team", "ibos", "downline"]);
    expect(allowedVisibilities(anita)).toEqual(["team", "ibos", "downline"]);
    expect(allowedVisibilities(jamal)).toEqual(["downline"]);
    expect(allowedVisibilities(david)).toEqual([]);
    expect(allowedVisibilities(beau)).toEqual([]);
    expect(canCreateInLibrary(jamal)).toBe(true);
    expect(canCreateInLibrary(beau)).toBe(false);
  });

  it("the creator edits their own; leaders and moderators edit anything", () => {
    const jamals = { createdBy: "4", visibility: "downline" as const };
    const marias = { createdBy: "1", visibility: "team" as const };
    expect(canEditLibrary(jamals, jamal)).toBe(true);
    expect(canEditLibrary(jamals, anita)).toBe(true);
    expect(canEditLibrary(jamals, david)).toBe(false);
    expect(canEditLibrary(marias, jamal)).toBe(false);
    expect(canEditLibrary(marias, anita)).toBe(true);
  });

  it("only leaders and moderators manage topics", () => {
    expect(canManageTopics(maria)).toBe(true);
    expect(canManageTopics(anita)).toBe(true);
    expect(canManageTopics(jamal)).toBe(false);
  });
});

const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  id: "i1",
  workspaceId: "w1",
  title: "Inviting without pressure",
  description: null,
  kind: "audio",
  source: "upload",
  storagePath: "idb:x",
  mime: "audio/mpeg",
  sizeBytes: 1000,
  fileName: "a.mp3",
  linkUrl: null,
  linkProvider: null,
  durationSec: 1000,
  pageCount: null,
  speakers: [{ personId: "1", name: null }],
  format: "talk",
  topicIds: [],
  eventId: null,
  recordedOn: null,
  createdBy: "1",
  permissionConfirmed: true,
  visibility: "team",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-01T10:00:00.000Z",
  ...over,
});

const ctx = { personId: "4", itemId: "i1", now: "2026-10-13T10:00:00.000Z" };

describe("progress", () => {
  it("finishes at 90% of the length", () => {
    expect(reachedCompletion(899, 1000)).toBe(false);
    expect(reachedCompletion(900, 1000)).toBe(true);
    expect(reachedCompletion(900, null)).toBe(false);
  });

  it("saves the position and finishes once, logging once", () => {
    const a = nextProgress(
      undefined,
      { type: "position", positionSec: 300, durationSec: 1000 },
      ctx,
    );
    expect(a.progress.positionSec).toBe(300);
    expect(a.completedNow).toBe(false);
    expect(a.shouldLog).toBe(false);
    const b = nextProgress(
      a.progress,
      { type: "position", positionSec: 950, durationSec: 1000 },
      ctx,
    );
    expect(b.completedNow).toBe(true);
    expect(b.shouldLog).toBe(true);
    expect(b.progress.loggedAt).toBe(ctx.now);
    const c = nextProgress(
      b.progress,
      { type: "position", positionSec: 1000, durationSec: 1000 },
      ctx,
    );
    expect(c.completedNow).toBe(false);
    expect(c.shouldLog).toBe(false);
  });

  it("never logs twice, even after mark as not done and finishing again", () => {
    const done = nextProgress(undefined, { type: "complete" }, ctx);
    expect(done.shouldLog).toBe(true);
    const undone = nextProgress(done.progress, { type: "uncomplete" }, ctx);
    expect(undone.progress.completedAt).toBeNull();
    expect(undone.progress.loggedAt).toBe(ctx.now);
    const again = nextProgress(undone.progress, { type: "complete" }, ctx);
    expect(again.completedNow).toBe(true);
    expect(again.shouldLog).toBe(false);
  });

  it("clamps positions to the length", () => {
    const p = nextProgress(
      undefined,
      { type: "position", positionSec: 5000, durationSec: 1000 },
      ctx,
    );
    expect(p.progress.positionSec).toBe(1000);
    const q = nextProgress(
      undefined,
      { type: "position", positionSec: -4, durationSec: 1000 },
      ctx,
    );
    expect(q.progress.positionSec).toBe(0);
  });

  it("fraction, time left and where to resume", () => {
    const p: LibraryProgress = {
      ...ctx,
      positionSec: 250,
      completedAt: null,
      loggedAt: null,
      updatedAt: ctx.now,
    };
    const it = item();
    expect(itemFraction(it, p)).toBe(0.25);
    expect(itemFraction(it, undefined)).toBe(0);
    expect(itemFraction(it, { ...p, completedAt: ctx.now })).toBe(1);
    expect(remainingSec(it, p)).toBe(750);
    expect(resumePosition(it, p)).toBe(250);
    expect(resumePosition(it, { ...p, completedAt: ctx.now })).toBe(0);
    expect(resumePosition(it, { ...p, positionSec: 999 })).toBe(0);
  });

  it("continue = the most recently touched unfinished item that is still available", () => {
    const row = (itemId: string, positionSec: number, updatedAt: string, done = false) => ({
      personId: "4",
      itemId,
      positionSec,
      completedAt: done ? updatedAt : null,
      loggedAt: null,
      updatedAt,
    });
    const rows = [
      row("a", 10, "2026-10-10T00:00:00Z"),
      row("b", 10, "2026-10-12T00:00:00Z"),
      row("c", 10, "2026-10-13T00:00:00Z", true),
      row("d", 0, "2026-10-13T00:00:00Z"),
      row("e", 10, "2026-10-13T01:00:00Z"),
    ];
    expect(continueCandidate(rows, (id) => id !== "e")?.itemId).toBe("b");
    expect(continueCandidate([], () => true)).toBeNull();
  });

  it("new = added in the last two weeks and not started", () => {
    const now = Date.parse("2026-10-13T10:00:00Z");
    const fresh = item({ createdAt: "2026-10-05T10:00:00Z" });
    expect(isNewItem(fresh, undefined, now)).toBe(true);
    expect(isNewItem(item({ createdAt: "2026-09-20T10:00:00Z" }), undefined, now)).toBe(false);
    const started = {
      ...ctx,
      positionSec: 5,
      completedAt: null,
      loggedAt: null,
      updatedAt: ctx.now,
    };
    expect(isNewItem(fresh, started, now)).toBe(false);
    expect(isNewItem(fresh, undefined, now, "1")).toBe(false);
    expect(isNewItem(fresh, undefined, now, "4")).toBe(true);
  });
});

describe("learning log kind", () => {
  it("documents count pages; workshops count as a workshop; talks as a podcast", () => {
    expect(learningFor(item({ kind: "document", pageCount: 4 }))).toEqual({
      kind: "pages",
      amount: 4,
    });
    expect(learningFor(item({ kind: "document", pageCount: null }))).toEqual({
      kind: "pages",
      amount: 1,
    });
    expect(learningFor(item({ kind: "video", format: "workshop" }))).toEqual({
      kind: "workshop",
      amount: 1,
    });
    expect(learningFor(item({ kind: "slides", format: "workshop" }))).toEqual({
      kind: "workshop",
      amount: 1,
    });
    expect(learningFor(item({ kind: "audio", format: "panel" }))).toEqual({
      kind: "podcast",
      amount: 1,
    });
    expect(learningFor(item({ kind: "video", format: "interview" }))).toEqual({
      kind: "podcast",
      amount: 1,
    });
    expect(learningFor(item({ kind: "slides", format: "talk", pageCount: 12 }))).toEqual({
      kind: "pages",
      amount: 12,
    });
  });
});

describe("channels", () => {
  const sections = [
    { id: "s1", title: "Basics", itemIds: ["a", "b"] },
    { id: "s2", title: "Inviting", itemIds: ["c", "a", "d"] },
  ];
  it("flattens lessons in order without duplicates", () => {
    expect(channelItemIds({ sections })).toEqual(["a", "b", "c", "d"]);
  });

  it("counts done lessons and finds the next one", () => {
    const done = (itemId: string) => ({
      personId: "4",
      itemId,
      positionSec: 0,
      completedAt: "x",
      loggedAt: "x",
      updatedAt: "x",
    });
    const map = new Map([
      ["a", done("a")],
      ["c", done("c")],
    ]);
    expect(channelStats(["a", "b", "c", "d"], map)).toEqual({
      done: 2,
      total: 4,
      fraction: 0.5,
      nextId: "b",
      nextNumber: 2,
    });
    expect(channelStats([], map)).toMatchObject({ fraction: 0, nextId: null });
  });

  it("previous and next lesson", () => {
    expect(nextInChannel(["a", "b"], "a")).toBe("b");
    expect(nextInChannel(["a", "b"], "b")).toBeNull();
    expect(prevInChannel(["a", "b"], "b")).toBe("a");
    expect(prevInChannel(["a", "b"], "x")).toBeNull();
  });

  it("drops a dragged lesson at a place", () => {
    const into = placeInSections(sections, "a", "s2", 1);
    expect(into.map((s) => s.itemIds)).toEqual([["b"], ["c", "a", "d"]]);
    expect(placeInSections(sections, "b", "s1", 0)[0].itemIds).toEqual(["b", "a"]);
    expect(placeInSections(sections, "b", "s2", 99)[1].itemIds).toEqual(["c", "a", "d", "b"]);
    expect(placeInSections(sections, "b", "nope", 0)).toBe(sections);
  });

  it("moves lessons within and across sections", () => {
    expect(moveInSections(sections, "b", -1)[0].itemIds).toEqual(["b", "a"]);
    const down = moveInSections(sections, "b", 1);
    expect(down[0].itemIds).toEqual(["a"]);
    expect(down[1].itemIds).toEqual(["b", "c", "a", "d"]);
    const up = moveInSections(sections, "c", -1);
    expect(up[0].itemIds).toEqual(["a", "b", "c"]);
    expect(moveInSections(sections, "a", -1)).toBe(sections);
    expect(sections[0].itemIds).toEqual(["a", "b"]);
  });
});

describe("links", () => {
  it("embeds YouTube, Vimeo (with unlisted hash) and Google Slides", () => {
    expect(parseLink("https://youtu.be/abcdefghijk")?.embedUrl).toBe(
      "https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0",
    );
    expect(parseLink("https://www.youtube.com/watch?v=abcdefghijk&t=3")?.provider).toBe("youtube");
    expect(parseLink("https://vimeo.com/123456/abc123")?.embedUrl).toBe(
      "https://player.vimeo.com/video/123456?h=abc123",
    );
    expect(parseLink("https://vimeo.com/123456")?.embedUrl).toBe(
      "https://player.vimeo.com/video/123456",
    );
    const slides = parseLink("https://docs.google.com/presentation/d/XYZ_1/edit#slide=id.p");
    expect(slides).toMatchObject({ provider: "google_slides", kind: "slides" });
    expect(slides?.embedUrl).toBe(
      "https://docs.google.com/presentation/d/XYZ_1/embed?start=false&loop=false",
    );
  });

  it("rejects non-links and keeps other hosts as plain links", () => {
    expect(parseLink("not a url")).toBeNull();
    expect(parseLink("javascript:alert(1)")).toBeNull();
    expect(parseLink("https://example.com/file.pdf")).toEqual({
      provider: "other",
      embedUrl: null,
      kind: "document",
    });
  });
});

describe("catalog filters", () => {
  const items = [
    item({
      id: "a",
      title: "Retail is a people business",
      topicIds: ["sales"],
      recordedOn: "2025-09-01",
    }),
    item({
      id: "b",
      title: "Leaders panel",
      kind: "video",
      format: "panel",
      speakers: [
        { personId: "1", name: null },
        { personId: "2", name: null },
      ],
      topicIds: ["recruiting", "mindset"],
      recordedOn: "2026-09-01",
      durationSec: 3500,
    }),
    item({
      id: "c",
      title: "Why consistency wins",
      speakers: [{ personId: null, name: "Sam Ortega" }],
      topicIds: ["mindset"],
      eventId: "e3",
      recordedOn: "2025-07-01",
      durationSec: 2200,
    }),
    item({
      id: "d",
      title: "The plan",
      kind: "slides",
      pageCount: 24,
      durationSec: null,
      recordedOn: "2026-06-01",
    }),
  ];
  const names = {
    person: (id: string) => ({ "1": "Maria Reyes", "2": "Anita Patel" })[id],
    topic: (id: string) => ({ sales: "Sales", recruiting: "Recruiting", mindset: "Mindset" })[id],
    event: (id: string) => ({ e3: "Summer Conference" })[id],
  };
  const ids = (f: Parameters<typeof filterCatalog>[1]) =>
    filterCatalog(items, f, names).map((i) => i.id);

  it("sorts newest first by recorded date by default", () => {
    expect(ids({})).toEqual(["b", "d", "a", "c"]);
    expect(ids({ sort: "oldest" })).toEqual(["c", "a", "d", "b"]);
    expect(ids({ sort: "title" })).toEqual(["b", "a", "d", "c"]);
    expect(ids({ sort: "longest" })[0]).toBe("b");
  });

  it("filters by speaker (team or guest), format, topic, type and event", () => {
    expect(ids({ speaker: "2" })).toEqual(["b"]);
    expect(ids({ speaker: "guest:sam ortega" })).toEqual(["c"]);
    expect(ids({ format: "panel" })).toEqual(["b"]);
    expect(ids({ topic: "mindset" })).toEqual(["b", "c"]);
    expect(ids({ kind: "slides" })).toEqual(["d"]);
    expect(ids({ event: "e3" })).toEqual(["c"]);
  });

  it("searches titles, speakers, topics and events", () => {
    expect(ids({ q: "anita" })).toEqual(["b"]);
    expect(ids({ q: "summer" })).toEqual(["c"]);
    expect(ids({ q: "SALES retail" })).toEqual(["a"]);
    expect(ids({ q: "sam" })).toEqual(["c"]);
  });

  it("counts topics", () => {
    expect(Object.fromEntries(topicCounts(items))).toEqual({ sales: 1, recruiting: 1, mindset: 2 });
  });
});

describe("formatting", () => {
  it("clock, minutes and length labels", () => {
    expect(formatClock(662)).toBe("11:02");
    expect(formatClock(3849)).toBe("1:04:09");
    expect(formatMinutes(1085)).toBe("18 min");
    expect(formatMinutes(3900)).toBe("1 h 5 min");
    expect(formatMinutes(10)).toBe("1 min");
    expect(lengthLabel(item())).toBe("Audio · 17 min");
    expect(lengthLabel(item({ kind: "slides", durationSec: null, pageCount: 24 }))).toBe(
      "Slides · 24 slides",
    );
    expect(lengthLabel(item({ kind: "document", durationSec: null, pageCount: 1 }))).toBe(
      "Document · 1 page",
    );
    expect(
      lengthLabel(
        item({ kind: "video", source: "link", linkProvider: "youtube", durationSec: null }),
      ),
    ).toBe("Video · YouTube");
  });
});

describe("validation", () => {
  const draft: ItemDraft = {
    title: "Opening the door",
    kind: "audio",
    source: "upload",
    storagePath: "idb:1",
    sizeBytes: 100,
    speakers: [{ personId: "1", name: null }],
    format: "talk",
    topicIds: [],
    permissionConfirmed: true,
    visibility: "team",
  };
  it("accepts a complete draft from someone allowed to share with that audience", () => {
    expect(validateItemDraft(draft, maria)).toEqual([]);
  });
  it("requires title, file, a speaker, the permission tick and an allowed audience", () => {
    const errors = validateItemDraft(
      {
        ...draft,
        title: " ",
        storagePath: null,
        speakers: [{ personId: null, name: " " }],
        permissionConfirmed: false,
      },
      jamal,
    );
    expect(errors).toHaveLength(5);
    expect(validateItemDraft({ ...draft, visibility: "downline" }, jamal)).toEqual([]);
    expect(validateItemDraft({ ...draft, source: "link", linkUrl: "nope" }, maria)).toHaveLength(1);
  });
  it("channels need a name and an allowed audience", () => {
    expect(validateChannelDraft({ title: "Sales", visibility: "team" }, maria)).toEqual([]);
    expect(validateChannelDraft({ title: "", visibility: "team" }, jamal)).toHaveLength(2);
    expect(validateChannelDraft({ title: "Mine", visibility: "downline" }, beau)).toHaveLength(1);
  });
});
