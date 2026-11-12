import { describe, expect, it } from "vitest";
import type { CatalogItem, Learning } from "@/data";
import {
  capTitles,
  filterTitles,
  libraryTitles,
  matchTitle,
  mergeTitles,
  pastTitles,
  resolveTitle,
  type LibraryTitle,
} from "./titleSuggestions";

let n = 0;
const entry = (l: Pick<Learning, "kind" | "title" | "date">): Learning => ({
  id: `t${n++}`,
  personId: "1",
  amount: 1,
  ...l,
});

const log: Learning[] = [
  entry({ kind: "pages", title: "Atomic Habits", date: "2026-10-01" }),
  entry({ kind: "pages", title: "atomic habits ", date: "2026-10-10" }),
  entry({ kind: "pages", title: "The Slight Edge", date: "2026-10-05" }),
  entry({ kind: "podcast", title: "Momentum Daily", date: "2026-10-12" }),
  entry({ kind: "pages", title: "  ", date: "2026-10-13" }),
];

describe("pastTitles", () => {
  it("lists each book once, newest first, with its latest spelling", () => {
    expect(pastTitles(log, "pages")).toEqual([
      { title: "atomic habits", lastDate: "2026-10-10" },
      { title: "The Slight Edge", lastDate: "2026-10-05" },
    ]);
  });

  it("keeps other kinds out", () => {
    expect(pastTitles(log, "podcast").map((t) => t.title)).toEqual(["Momentum Daily"]);
  });
});

describe("filterTitles / matchTitle", () => {
  const books = pastTitles(log, "pages");

  it("filters by any part of the title, ignoring case", () => {
    expect(filterTitles(books, "EDGE").map((t) => t.title)).toEqual(["The Slight Edge"]);
    expect(filterTitles(books, "")).toHaveLength(2);
    expect(filterTitles(books, "zzz")).toEqual([]);
  });

  it("matches a whole title only", () => {
    expect(matchTitle(books, " the slight edge")?.title).toBe("The Slight Edge");
    expect(matchTitle(books, "slight")).toBeUndefined();
    expect(matchTitle(books, "")).toBeUndefined();
  });
});

const item = (over: Partial<CatalogItem>): CatalogItem =>
  ({
    id: "i",
    title: "Item",
    kind: "audio",
    format: "talk",
    pageCount: null,
    ...over,
  }) as CatalogItem;

const catalog: CatalogItem[] = [
  item({ id: "a1", title: "Inviting without pressure", kind: "audio" }),
  item({ id: "v1", title: "Welcome to the team", kind: "video", format: "interview" }),
  item({ id: "w1", title: "Starter workshop", kind: "video", format: "workshop" }),
  item({ id: "d1", title: "The Slight Edge", kind: "document", pageCount: 12 }),
  item({ id: "s1", title: "Pitch deck", kind: "slides", pageCount: 20 }),
  item({ id: "s2", title: "Workshop slides", kind: "slides", format: "workshop" }),
  item({ id: "a2", title: "  inviting without pressure ", kind: "audio" }),
  item({ id: "x", title: "  ", kind: "audio" }),
];

describe("libraryTitles", () => {
  it("lists what finishing logs as listening, in the order given, one per title", () => {
    expect(libraryTitles(catalog, "podcast")).toEqual([
      { title: "Inviting without pressure", itemId: "a1", itemKind: "audio" },
      { title: "Welcome to the team", itemId: "v1", itemKind: "video" },
    ]);
  });

  it("lists documents and slide decks under reading", () => {
    expect(libraryTitles(catalog, "pages").map((t) => t.itemId)).toEqual(["d1", "s1"]);
  });

  it("leaves out items that log as neither (workshops) and offers nothing for other kinds", () => {
    const all = [...libraryTitles(catalog, "pages"), ...libraryTitles(catalog, "podcast")];
    expect(all.map((t) => t.itemId)).not.toContain("w1");
    expect(all.map((t) => t.itemId)).not.toContain("s2");
    expect(libraryTitles(catalog, "workshop")).toEqual([]);
    expect(libraryTitles(catalog, "conference")).toEqual([]);
  });
});

describe("mergeTitles", () => {
  const library = libraryTitles(catalog, "pages");
  const past = pastTitles(
    [
      ...log,
      entry({ kind: "pages", title: "the slight edge", date: "2026-10-20" }),
      entry({ kind: "pages", title: "Pitch Deck", date: "2026-10-02" }),
    ],
    "pages",
  );

  it("puts library items first, then titles logged before", () => {
    const merged = mergeTitles(library, past);
    expect(merged.map((o) => o.source)).toEqual(["library", "library", "past"]);
    expect(merged.map((o) => o.title)).toEqual(["The Slight Edge", "Pitch deck", "atomic habits"]);
  });

  it("shows a title that is both once, as the library item", () => {
    const merged = mergeTitles(library, past);
    const edge = merged.filter((o) => o.title.toLowerCase() === "the slight edge");
    expect(edge).toEqual([
      { source: "library", title: "The Slight Edge", itemId: "d1", itemKind: "document" },
    ]);
    expect(merged.filter((o) => o.title.toLowerCase() === "pitch deck")).toHaveLength(1);
  });

  it("is just the past titles when there is no library", () => {
    expect(mergeTitles([], past).map((o) => o.source)).toEqual(["past", "past", "past"]);
  });

  it("filters across both groups", () => {
    const merged = mergeTitles(library, past);
    expect(filterTitles(merged, "ED").map((o) => o.title)).toEqual(["The Slight Edge"]);
    expect(filterTitles(merged, "I").map((o) => o.title)).toEqual([
      "The Slight Edge",
      "Pitch deck",
      "atomic habits",
    ]);
  });
});

describe("capTitles", () => {
  const many: LibraryTitle[] = Array.from({ length: 30 }, (_, i) => ({
    title: `Talk ${i}`,
    itemId: `t${i}`,
    itemKind: "audio",
  }));
  const past = pastTitles(
    [entry({ kind: "podcast", title: "Momentum Daily", date: "2026-10-12" })],
    "podcast",
  );

  it("shows a few library items and keeps every title logged before", () => {
    const shown = capTitles(mergeTitles(many, past), 5);
    expect(shown.filter((o) => o.source === "library")).toHaveLength(5);
    expect(shown.at(-1)?.source).toBe("past");
  });

  it("typing reaches items beyond the cap", () => {
    const merged = mergeTitles(many, past);
    expect(capTitles(filterTitles(merged, "talk 29"), 5).map((o) => o.title)).toEqual(["Talk 29"]);
  });
});

describe("resolveTitle", () => {
  const options = mergeTitles(libraryTitles(catalog, "podcast"), pastTitles(log, "podcast"));

  it("matches a library item ignoring case and spaces, under the library's spelling", () => {
    expect(resolveTitle(options, "  WELCOME to the TEAM ", "Unnamed")).toEqual({
      title: "Welcome to the team",
      itemId: "v1",
    });
  });

  it("a title logged before is an ordinary entry under its spelling", () => {
    expect(resolveTitle(options, "momentum daily", "Unnamed")).toEqual({
      title: "Momentum Daily",
      itemId: null,
    });
  });

  it("a new title is kept as typed, and an empty one is the fallback", () => {
    expect(resolveTitle(options, " Brand new show ", "Unnamed")).toEqual({
      title: "Brand new show",
      itemId: null,
    });
    expect(resolveTitle(options, "   ", "Unnamed")).toEqual({ title: "Unnamed", itemId: null });
  });

  it("part of a library title is not a pick", () => {
    expect(resolveTitle(options, "Welcome", "Unnamed").itemId).toBeNull();
  });
});
