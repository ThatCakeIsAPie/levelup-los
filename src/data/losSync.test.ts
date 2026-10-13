import { describe, expect, it } from "vitest";
import type { CrmPerson } from "@/stores/peopleStore";
import { syncLosEntries } from "./losSync";

const person = (id: string, name: string, o: Partial<CrmPerson> = {}): CrmPerson => ({
  id,
  name,
  bizClass: "ibo",
  sponsorId: null,
  ...o,
});

const roster = [
  person("1", "Maria Reyes", { losUid: "u-maria" }),
  person("2", "Anita Patel", { sponsorId: "1" }),
  person("3", "Alex Stone", { sponsorId: "1" }),
  person("4", "Alex Stone", { sponsorId: "2" }),
  person("5", "Kim Lee", { sponsorId: "2", losUid: "u-old" }),
  person("c1", "Grace Lin", { bizClass: "customer", ownerId: "1" }),
];

describe("syncLosEntries", () => {
  it("matches by losUid first, even when the name changed", () => {
    const { matches, people } = syncLosEntries(roster, [
      { uid: "u-maria", name: "Maria R.", sponsorUid: null },
    ]);
    expect(matches.get("u-maria")).toEqual({ id: "1", how: "uid" });
    expect(people).toBe(roster); // nothing changed
  });

  it("falls back to a unique name with no losUid yet, and claims that person", () => {
    const { matches, people } = syncLosEntries(roster, [
      { uid: "u-anita", name: " anita patel ", sponsorUid: null },
    ]);
    expect(matches.get("u-anita")).toEqual({ id: "2", how: "name" });
    expect(people.find((p) => p.id === "2")?.losUid).toBe("u-anita");
    expect(roster.find((p) => p.id === "2")?.losUid).toBeUndefined(); // input not mutated
  });

  it("creates a new person when two people share the name", () => {
    const { matches, people } = syncLosEntries(roster, [
      { uid: "u-alex", name: "Alex Stone", sponsorUid: null },
    ]);
    expect(matches.get("u-alex")?.how).toBe("created");
    expect(people.filter((p) => p.name === "Alex Stone")).toHaveLength(3);
  });

  it("creates a new person when the only name match is already linked elsewhere", () => {
    const { matches } = syncLosEntries(roster, [
      { uid: "u-new", name: "Kim Lee", sponsorUid: null },
    ]);
    expect(matches.get("u-new")?.how).toBe("created");
  });

  it("does not name-match when the name appears twice in the upload", () => {
    const { matches } = syncLosEntries(roster, [
      { uid: "a", name: "Anita Patel", sponsorUid: null },
      { uid: "b", name: "Anita Patel", sponsorUid: null },
    ]);
    expect(matches.get("a")?.how).toBe("created");
    expect(matches.get("b")?.how).toBe("created");
  });

  it("ignores customers when matching by name", () => {
    const { matches } = syncLosEntries(roster, [{ uid: "g", name: "Grace Lin", sponsorUid: null }]);
    expect(matches.get("g")?.how).toBe("created");
  });

  it("aligns sponsors for matched people", () => {
    const { people } = syncLosEntries(roster, [
      { uid: "u-maria", name: "Maria Reyes", sponsorUid: null },
      { uid: "u-old", name: "Kim Lee", sponsorUid: "u-maria" },
    ]);
    expect(people.find((p) => p.id === "5")?.sponsorId).toBe("1");
  });

  it("never moves an existing person under someone created from an ambiguous name", () => {
    const { people, matches } = syncLosEntries(roster, [
      { uid: "u-alex", name: "Alex Stone", sponsorUid: null },
      { uid: "u-old", name: "Kim Lee", sponsorUid: "u-alex" },
      { uid: "u-fresh", name: "New Person", sponsorUid: "u-alex" },
    ]);
    expect(people.find((p) => p.id === "5")?.sponsorId).toBe("2");
    // A brand-new person can still hang under them.
    const fresh = people.find((p) => p.id === matches.get("u-fresh")?.id);
    expect(fresh?.sponsorId).toBe(matches.get("u-alex")?.id);
  });

  it("re-syncing the same entries is stable (no duplicates)", () => {
    const entries = [
      { uid: "u-maria", name: "Maria Reyes", sponsorUid: null },
      { uid: "u-anita", name: "Anita Patel", sponsorUid: "u-maria" },
      { uid: "u-z", name: "Zed Brand", sponsorUid: "u-anita" },
    ];
    const once = syncLosEntries(roster, entries).people;
    const twice = syncLosEntries(once, entries).people;
    expect(twice).toBe(once);
    expect(twice).toHaveLength(roster.length + 1);
  });
});
