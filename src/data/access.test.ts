import { describe, expect, it } from "vitest";
import { seedAttendances, seedPeople } from "./seed";
import {
  canSeePerson,
  downlineIds,
  downlineOf,
  filterAttendances,
  sponsorChain,
  visibleCustomers,
  visibleIdSet,
  visiblePeople,
  type Viewer,
} from "./access";

const people = seedPeople();
const maria: Viewer = { personId: "1", role: "leader" };
const anita: Viewer = { personId: "2", role: "ibo" };
const jamal: Viewer = { personId: "4", role: "apprentice" };
const beau: Viewer = { personId: "20", role: "candidate" };

describe("downlineIds", () => {
  it("includes the root and walks the business path only", () => {
    const ids = downlineIds(people, "4");
    expect(ids.has("4")).toBe(true);
    expect(ids.has("9")).toBe(true); // Carlos, sponsored by Jamal
    expect(ids.has("21")).toBe(true); // Andre, sponsored by Jamal
    expect(ids.has("c8")).toBe(false); // Jamal's customer is not downline
    expect(ids.has("2")).toBe(false); // upline is not downline
  });
});

describe("visiblePeople", () => {
  it("nobody logged in sees nothing", () => {
    expect(visiblePeople(people, null)).toEqual([]);
  });

  it("a candidate sees only themselves", () => {
    expect(visiblePeople(people, beau).map((p) => p.id)).toEqual(["20"]);
  });

  it("the leader sees the whole business tree but only her own customers", () => {
    const ids = visibleIdSet(people, maria);
    const business = people.filter((p) => p.bizClass !== "customer");
    for (const p of business) expect(ids.has(p.id)).toBe(true);
    expect(ids.has("c1")).toBe(true);
    expect(ids.has("c5")).toBe(false); // Anita's customer
  });

  it("an IBO sees self + downline, never upline or peers", () => {
    const ids = visibleIdSet(people, anita);
    expect(ids.has("2")).toBe(true);
    expect(ids.has("4")).toBe(true);
    expect(ids.has("9")).toBe(true); // second level via Jamal
    expect(ids.has("1")).toBe(false); // upline
    expect(ids.has("3")).toBe(false); // peer
    expect(ids.has("c5")).toBe(true);
    expect(ids.has("c8")).toBe(false); // Jamal's customer, not Anita's
  });

  it("an apprentice sees self, own prospects and own customer", () => {
    const ids = visibleIdSet(people, jamal);
    expect(ids.has("4")).toBe(true);
    expect(ids.has("9")).toBe(true);
    expect(ids.has("21")).toBe(true);
    expect(ids.has("c8")).toBe(true);
    expect(ids.has("2")).toBe(false);
    expect(ids.has("c5")).toBe(false);
  });
});

describe("visibleCustomers", () => {
  it("returns only owned customers; none for candidates", () => {
    expect(
      visibleCustomers(people, maria)
        .map((c) => c.id)
        .sort(),
    ).toEqual(["c1", "c2", "c3", "c4"]);
    expect(visibleCustomers(people, jamal).map((c) => c.id)).toEqual(["c8"]);
    expect(visibleCustomers(people, beau)).toEqual([]);
  });
});

describe("canSeePerson", () => {
  it("treats non-visible ids like missing ones", () => {
    expect(canSeePerson(people, jamal, "1")).toBe(false);
    expect(canSeePerson(people, jamal, "does-not-exist")).toBe(false);
    expect(canSeePerson(people, maria, "4")).toBe(true);
  });
});

describe("filterAttendances", () => {
  it("drops rows for people the viewer cannot see", () => {
    const rows = seedAttendances().filter((a) => a.eventId === "e1");
    const forJamal = filterAttendances(rows, visibleIdSet(people, jamal));
    expect(forJamal.map((a) => a.personId).sort()).toEqual(["200", "4", "9"]);
    const forBeau = filterAttendances(rows, visibleIdSet(people, beau));
    expect(forBeau).toEqual([]);
  });
});

describe("sponsorChain", () => {
  it("is root-first and stops at the viewer", () => {
    const ids = visibleIdSet(people, maria);
    expect(sponsorChain(people, ids, "9").map((p) => p.id)).toEqual(["1", "2", "4"]);
    const jamalIds = visibleIdSet(people, jamal);
    expect(sponsorChain(people, jamalIds, "9").map((p) => p.id)).toEqual(["4"]);
    expect(sponsorChain(people, jamalIds, "4")).toEqual([]);
  });
});

describe("downlineOf", () => {
  it("returns direct or full downline, visible only", () => {
    const ids = visibleIdSet(people, maria);
    const direct = downlineOf(people, ids, "4", true).map((p) => p.id);
    expect(direct).toContain("9");
    expect(direct).toContain("21");
    expect(downlineOf(people, ids, "4").length).toBeGreaterThan(direct.length);
  });
});

describe("seed", () => {
  it("gives Jamal an IBO anniversary about 53 days out", async () => {
    const { apprenticeAlertLevel } = await import("@/stores/peopleStore");
    const j = people.find((p) => p.id === "4")!;
    expect(j.bizClass).toBe("apprentice");
    expect(apprenticeAlertLevel(j)).toBe("90d");
  });
});
