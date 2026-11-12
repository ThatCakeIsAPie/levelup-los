import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePeopleStore } from "@/stores/peopleStore";
import { DEMO_USERS, useSessionStore } from "@/stores/sessionStore";
import { useCrmStore } from "@/stores/crmStore";
import { seedPeople } from "@/data/seed";
// The stores persist to localStorage in the demo; there is none in this environment.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    },
  });
});

import {
  completeLibraryItemWithEntry,
  markLibraryItemDone,
  markLibraryItemNotDone,
} from "./mutations";
import { library, updateLibrary } from "./store";
import { learningFor } from "./rules";
import type { CatalogItem, LibraryProgress } from "./types";

const ME = "1";
const base: Omit<CatalogItem, "id" | "title" | "kind" | "format" | "durationSec" | "pageCount"> = {
  workspaceId: "w1",
  description: null,
  source: "link",
  storagePath: null,
  mime: null,
  sizeBytes: null,
  fileName: null,
  linkUrl: null,
  linkProvider: null,
  speakers: [],
  topicIds: [],
  eventId: null,
  recordedOn: null,
  createdBy: ME,
  permissionConfirmed: true,
  visibility: "team",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const talk: CatalogItem = {
  ...base,
  id: "talk",
  title: "Inviting without pressure",
  kind: "audio",
  format: "talk",
  durationSec: 600,
  pageCount: null,
};
const book: CatalogItem = {
  ...base,
  id: "book",
  title: "The Slight Edge",
  kind: "document",
  format: "talk",
  durationSec: null,
  pageCount: 12,
};

const mine = () => useCrmStore.getState().learning.filter((l) => l.personId === ME);
const progressOf = (id: string) =>
  library().progress.find((p) => p.personId === ME && p.itemId === id);
const entry = { amount: 45, unit: "minutes", date: "2026-11-03" } as const;

beforeEach(() => {
  usePeopleStore.setState({ people: seedPeople() });
  useSessionStore.setState({ user: DEMO_USERS.find((u) => u.personId === ME)! });
  useCrmStore.setState({ learning: [] });
  updateLibrary(() => ({ items: [talk, book], topics: [], channels: [], progress: [] }));
});

describe("completeLibraryItemWithEntry (demo)", () => {
  it("finishes the item and logs exactly one entry with the form's values", () => {
    const r = completeLibraryItemWithEntry("talk", entry);
    expect(r).not.toBeNull();
    expect(mine()).toHaveLength(1);
    expect(mine()[0]).toMatchObject({
      id: r!.learningId,
      kind: "podcast",
      title: "Inviting without pressure",
      amount: 45,
      unit: "minutes",
      date: "2026-11-03",
    });
    expect(progressOf("talk")?.completedAt).toBeTruthy();
    expect(progressOf("talk")?.loggedAt).toBeTruthy();
  });

  it("opening or marking the item done afterwards adds nothing", () => {
    completeLibraryItemWithEntry("talk", entry);
    expect(markLibraryItemDone("talk")).toMatchObject({ logged: false });
    markLibraryItemNotDone("talk");
    expect(markLibraryItemDone("talk")).toMatchObject({ logged: false });
    expect(mine()).toHaveLength(1);
  });

  it("logs a document as reading in the form's unit", () => {
    completeLibraryItemWithEntry("book", { amount: 20, unit: "pages", date: "2026-11-03" });
    expect(mine()).toHaveLength(1);
    expect(mine()[0]).toMatchObject({
      kind: "pages",
      title: "The Slight Edge",
      amount: 20,
      unit: "pages",
    });
  });

  it("does nothing when the item was finished before (the caller logs an ordinary entry)", () => {
    markLibraryItemDone("talk");
    expect(mine()).toHaveLength(1);
    const before = progressOf("talk");
    expect(completeLibraryItemWithEntry("talk", entry)).toBeNull();
    expect(mine()).toHaveLength(1);
    expect(progressOf("talk")).toBe(before);
  });

  it("does nothing when it was logged before and marked not done since", () => {
    markLibraryItemDone("talk");
    markLibraryItemNotDone("talk");
    expect(completeLibraryItemWithEntry("talk", entry)).toBeNull();
    expect(progressOf("talk")?.completedAt).toBeNull();
    expect(mine()).toHaveLength(1);
  });

  it("does nothing for an item the viewer can't open", () => {
    updateLibrary((s) => ({
      items: s.items.map((i) => ({ ...i, createdBy: "9", visibility: "downline" })),
    }));
    useSessionStore.setState({ user: DEMO_USERS.find((u) => u.personId === "20")! });
    expect(completeLibraryItemWithEntry("talk", entry)).toBeNull();
    expect(useCrmStore.getState().learning).toHaveLength(0);
  });

  it("undo removes the entry and puts the item back, so finishing it later still logs", () => {
    const r = completeLibraryItemWithEntry("talk", entry)!;
    r.undo();
    expect(mine()).toHaveLength(0);
    expect(progressOf("talk")).toBeUndefined();
    expect(markLibraryItemDone("talk")).toMatchObject({ logged: true });
    expect(mine()).toHaveLength(1);
  });

  it("undo restores a started item exactly", () => {
    const started: LibraryProgress = {
      personId: ME,
      itemId: "talk",
      positionSec: 120,
      completedAt: null,
      loggedAt: null,
      updatedAt: "2026-11-01T10:00:00.000Z",
    };
    updateLibrary(() => ({ progress: [started] }));
    const r = completeLibraryItemWithEntry("talk", entry)!;
    expect(progressOf("talk")?.completedAt).toBeTruthy();
    r.undo();
    expect(progressOf("talk")).toEqual(started);
    expect(mine()).toHaveLength(0);
  });
});

describe("what finishing from the library logs", () => {
  it("marking done logs one entry: the library's kind, and 1 episode or the page count", () => {
    markLibraryItemDone("talk");
    markLibraryItemDone("book");
    const rows = mine();
    expect(rows).toHaveLength(2);
    const t = rows.find((l) => l.title === talk.title)!;
    const b = rows.find((l) => l.title === book.title)!;
    expect(t).toMatchObject({ kind: learningFor(talk).kind, amount: 1 });
    expect(t.unit).toBeUndefined();
    expect(b).toMatchObject({ kind: learningFor(book).kind, amount: 12 });
    expect(b.unit).toBeUndefined();
  });
});
