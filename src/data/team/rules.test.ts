import { describe, expect, it } from "vitest";
import { seedPeople } from "../seed";
import { visibleCustomers, visibleIdSet, type Viewer } from "../access";
import { isUplineOf } from "../growth/hooks";
import {
  canEditSwitches,
  deputiesOf,
  deputyCandidates,
  deputyError,
  deputyOfIds,
  switchMap,
} from "./rules";
import { seedDeputies } from "./seed";
import type { Deputy } from "./types";

const people = seedPeople();
const deputies = seedDeputies();
const maria = { personId: "1", role: "leader" as const };

describe("deputies", () => {
  it("the seed makes Marcus and the admin Maria's deputies", () => {
    expect(deputiesOf(deputies, "1").map((d) => d.deputyId)).toEqual(["6", "800"]);
    expect(deputyOfIds(deputies, "6")).toEqual(["1"]);
    expect(deputyOfIds(deputies, "2")).toEqual([]);
  });

  it("only a leader names apprentices or IBOs on their own team", () => {
    expect(deputyError(people, [], maria, "2")).toBeNull();
    expect(deputyError(people, [], { personId: "2", role: "ibo" }, "4")).toMatch(/Only leaders/);
    expect(deputyError(people, [], maria, "1")).toMatch(/own deputy/);
    expect(deputyError(people, [], maria, "5")).toMatch(/registered/); // Linh, a prospect
    expect(deputyError(people, [], maria, "c1")).toMatch(/on your team/); // a customer
    expect(deputyError(people, deputies, maria, "6")).toMatch(/already/);
  });

  it("candidates for deputy are registered people on the team, not yet named", () => {
    const ids = deputyCandidates(people, deputies, "1").map((p) => p.id);
    expect(ids).toContain("2");
    expect(ids).not.toContain("6");
    expect(ids).not.toContain("1");
    expect(ids).not.toContain("5");
  });
});

describe("a deputy's visibility (mirror of visible_person_ids)", () => {
  const anita: Viewer = { personId: "2", role: "ibo" };
  const marcus: Viewer = { personId: "6", role: "ibo", deputyOf: ["1"] };
  const marcusAlone: Viewer = { personId: "6", role: "ibo" };
  const david: Viewer = { personId: "3", role: "ibo" };

  it("is their own view plus the leader's whole business tree", () => {
    const ids = visibleIdSet(people, marcus);
    const own = visibleIdSet(people, marcusAlone);
    for (const id of own) expect(ids.has(id)).toBe(true);
    expect(ids.has("1")).toBe(true); // Maria
    expect(ids.has("4")).toBe(true); // Jamal, under Anita
    expect(own.has("4")).toBe(false);
    for (const p of people.filter((x) => x.bizClass !== "customer"))
      expect(ids.has(p.id)).toBe(true);
  });

  it("never includes the leader's or anyone else's customers (customers stay private)", () => {
    const ids = visibleIdSet(people, marcus);
    expect(ids.has("c1")).toBe(false); // Maria's customer
    expect(ids.has("c7")).toBe(false); // David's customer
    expect(visibleCustomers(people, marcus)).toEqual([]); // Marcus has none
    expect(visibleIdSet(people, david).has("c7")).toBe(true);
  });

  it("doesn't change anyone else's view", () => {
    expect(visibleIdSet(people, anita).has("1")).toBe(false);
  });

  it("coaches the leader's team but not the leader", () => {
    const ids = visibleIdSet(people, marcus);
    expect(isUplineOf(people, ids, marcus, "4")).toBe(true);
    expect(isUplineOf(people, ids, marcus, "1")).toBe(false);
  });
});

describe("feature switches", () => {
  it("no row means off", () => {
    expect(switchMap([])).toEqual({ chats: false, library: false, campaigns: false });
    expect(switchMap([{ workspaceId: "w1", feature: "library", enabled: true }]).library).toBe(
      true,
    );
  });

  it("leaders and deputies flip them", () => {
    const none: Deputy[] = [];
    expect(canEditSwitches("leader", [])).toBe(true);
    expect(canEditSwitches("ibo", deputyOfIds(deputies, "6"))).toBe(true);
    expect(canEditSwitches("ibo", deputyOfIds(none, "2"))).toBe(false);
  });
});
