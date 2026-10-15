import { describe, expect, it } from "vitest";
import type { Learning } from "@/data";
import { filterTitles, matchTitle, pastTitles } from "./titleSuggestions";

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
