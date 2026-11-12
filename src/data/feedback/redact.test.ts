import { describe, expect, it } from "vitest";
import { COMMON_WORDS, buildMatcher, nameParts, type SensitiveSources } from "./redact";

const SOURCES: SensitiveSources = {
  names: ["Maria Reyes", "Ed Miller", "Anita Patel", "June Park", "Zoë O'Brien", null, "  "],
  phones: ["(512) 555-0102", "+44 20 7946 0958", "555-0188"],
  emails: ["maria@example.com"],
  places: ["Dallas, TX", "Salt Lake City, UT"],
  ids: ["IBO-1001", "LTD-501"],
};

const matcher = buildMatcher(SOURCES);
/** The parts of `text` the matcher would black out. */
const hits = (text: string) => matcher.find(text).map(([s, e]) => text.slice(s, e));

describe("nameParts", () => {
  it("keeps parts of 3 or more letters, lower-cased", () => {
    expect(nameParts("Maria Reyes")).toEqual(["maria", "reyes"]);
    expect(nameParts("Ed Miller")).toEqual(["miller"]);
  });
  it("keeps apostrophe names whole and in pieces", () => {
    expect(nameParts("Zoë O'Brien")).toEqual(expect.arrayContaining(["zoë", "o'brien", "brien"]));
  });
  it("drops everyday words such as months", () => {
    expect(nameParts("June Park")).toEqual(["park"]);
    expect(COMMON_WORDS.has("may")).toBe(true);
  });
});

describe("names", () => {
  it("finds a full name as one stretch", () => {
    expect(hits("Under Maria Reyes today")).toEqual(["Maria Reyes"]);
  });
  it("finds a first or a last name alone, in any case", () => {
    expect(hits("Call maria later")).toEqual(["maria"]);
    expect(hits("REYES")).toEqual(["REYES"]);
  });
  it("finds a name with a possessive, leaving the 's", () => {
    expect(hits("Maria's deputy")).toEqual(["Maria"]);
  });
  it("finds a two-letter first name only inside the full name", () => {
    expect(hits("Ed Miller joined")).toEqual(["Ed Miller"]);
    expect(hits("Ed joined")).toEqual([]);
  });
  it("joins neighbouring names into one bar", () => {
    expect(hits("Maria Reyes, Anita Patel")).toEqual(["Maria Reyes, Anita Patel"]);
  });
  it("keeps names apart when other words sit between them", () => {
    expect(hits("Maria met Anita")).toEqual(["Maria", "Anita"]);
  });
  it("only matches whole words", () => {
    expect(hits("Marianna and Patelson")).toEqual([]);
  });
  it("does not black out a month that is also a first name", () => {
    expect(hits("Due June 5")).toEqual([]);
    expect(hits("June Park")).toEqual(["June Park"]);
  });
  it("leaves ordinary text alone", () => {
    expect(hits("Pipeline: Contact made, First meeting")).toEqual([]);
    expect(hits("")).toEqual([]);
  });
});

describe("contact details and IDs", () => {
  it("finds a known phone in any grouping", () => {
    expect(hits("(512) 555-0102")).toEqual(["(512) 555-0102"]);
    expect(hits("Text 512.555.0102 now")).toEqual(["512.555.0102"]);
    expect(hits("+1 512 555 0102")).toEqual(["+1 512 555 0102"]);
    expect(hits("+44 20 7946 0958")).toEqual(["+44 20 7946 0958"]);
  });
  it("finds a phone in US format even when nobody knows it", () => {
    expect(hits("Reach me on (305) 555-0199.")).toEqual(["(305) 555-0199"]);
  });
  it("does not mistake dates or amounts for phones", () => {
    expect(hits("2026-11-11 12:30")).toEqual([]);
    expect(hits("Total $1,234.56 on 2026-11-11")).toEqual([]);
  });
  it("finds any email, known or not", () => {
    expect(hits("maria@example.com")).toEqual(["maria@example.com"]);
    expect(hits("write to stranger@mail.org please")).toEqual(["stranger@mail.org"]);
  });
  it("finds locations and the city alone", () => {
    expect(hits("Lives in Dallas, TX")).toEqual(["Dallas, TX"]);
    expect(hits("Dallas")).toEqual(["Dallas"]);
    expect(hits("Salt Lake City, UT")).toEqual(["Salt Lake City, UT"]);
  });
  it("finds IBO and LTD numbers", () => {
    expect(hits("IBO# IBO-1001 · LTD-501")).toEqual(["IBO-1001", "LTD-501"]);
  });
});

describe("buildMatcher", () => {
  it("knows nothing without values, except emails and US phones", () => {
    const empty = buildMatcher({ names: [], phones: [], emails: [], places: [], ids: [] });
    expect(empty.size).toBe(0);
    expect(empty.find("Maria Reyes")).toEqual([]);
    expect(empty.find("a@b.co")).toEqual([[0, 6]]);
  });
  it("ignores blank and null values", () => {
    expect(matcher.find("   ")).toEqual([]);
    expect(matcher.size).toBeGreaterThan(5);
  });
  it("copes with regex characters in values", () => {
    const m = buildMatcher({
      names: ["A.B. (Jr) Smith+"],
      phones: [],
      emails: [],
      places: [],
      ids: ["IBO.1+"],
    });
    expect(m.find("see A.B. (Jr) Smith+ here").length).toBe(1);
    expect(m.find("Smith")).toEqual([[0, 5]]);
  });
  it("is fast on a page of text with hundreds of values", () => {
    const names = Array.from({ length: 400 }, (_, i) => `Firstname${i}x Lastname${i}y`);
    const big = buildMatcher({ names, phones: [], emails: [], places: [], ids: [] });
    const text = "Pipeline stage and some ordinary words about the day ".repeat(40);
    const start = performance.now();
    for (let i = 0; i < 300; i++) big.find(text);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(big.find("Firstname7x Lastname7y is here")).toEqual([[0, 22]]);
  });
});
