import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePeopleStore } from "@/stores/peopleStore";
import { useSessionStore, DEMO_USERS } from "@/stores/sessionStore";
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

import { getBoardDef, getStageNames, saveStageNames } from "./hooks";
import { useStageNamesStore } from "./store";

/** The demo tree: Maria (1) -> Anita (2) -> Jamal (4) -> Tasha (700). */
const as = (personId: string) =>
  useSessionStore.setState({ user: DEMO_USERS.find((u) => u.personId === personId)! });
const name = (pipeline: "recruiting" | "customer", key: string) =>
  getStageNames(pipeline).name(key);

beforeEach(() => {
  usePeopleStore.setState({ people: seedPeople() });
  useStageNamesStore.setState({ entries: [] });
  as("1");
});

describe("stage names through the demo's sponsor tree", () => {
  it("starts at the defaults", () => {
    expect(name("recruiting", "contact")).toBe("Contact made");
    expect(name("customer", "first_sale")).toBe("First sale");
  });

  it("a rename shows for the person and everyone below, not above or beside", () => {
    as("2");
    expect(saveStageNames("customer", { contact: "Hello" })).toEqual({ ok: true });
    expect(name("customer", "contact")).toBe("Hello");
    // The other stages and the other pipeline are untouched.
    expect(name("customer", "first_meeting")).toBe("First meeting");
    expect(name("recruiting", "contact")).toBe("Contact made");
    for (const below of ["4", "700"]) {
      as(below);
      expect(name("customer", "contact")).toBe("Hello");
    }
    as("1"); // above
    expect(name("customer", "contact")).toBe("Contact");
    as("6"); // a crossline (Maria's other downline)
    expect(name("customer", "contact")).toBe("Contact");
  });

  it("someone below keeps their own name when an upline changes theirs", () => {
    as("1");
    saveStageNames("recruiting", { first_meeting: "Top v1" });
    as("4");
    expect(name("recruiting", "first_meeting")).toBe("Top v1");
    saveStageNames("recruiting", { first_meeting: "Jamal's" });
    as("700");
    expect(name("recruiting", "first_meeting")).toBe("Jamal's");
    as("1");
    saveStageNames("recruiting", { first_meeting: "Top v2" });
    for (const p of ["4", "700"]) {
      as(p);
      expect(name("recruiting", "first_meeting")).toBe("Jamal's");
    }
    as("2"); // between them: no name of her own, so Maria's new one
    expect(name("recruiting", "first_meeting")).toBe("Top v2");
  });

  it("clearing a name goes back to the inherited one", () => {
    as("1");
    saveStageNames("recruiting", { contact: "Top" });
    as("4");
    saveStageNames("recruiting", { contact: "Mine" });
    expect(name("recruiting", "contact")).toBe("Mine");
    expect(saveStageNames("recruiting", { contact: "" })).toEqual({ ok: true });
    expect(name("recruiting", "contact")).toBe("Top");
    as("1");
    saveStageNames("recruiting", {});
    as("4");
    expect(name("recruiting", "contact")).toBe("Contact made");
    expect(useStageNamesStore.getState().entries).toEqual([]);
  });

  it("refuses bad names and saves nothing", () => {
    as("4");
    const tooLong = saveStageNames("customer", { contact: "x".repeat(31), first_sale: "Fine" });
    expect(tooLong.ok).toBe(false);
    const clash = saveStageNames("customer", { contact: "Same", first_meeting: " same " });
    expect(clash).toMatchObject({ ok: false });
    expect(useStageNamesStore.getState().entries).toEqual([]);
  });

  it("the board layout carries the viewer's names for columns and for steps", () => {
    as("2");
    saveStageNames("customer", { first_sale: "Closed" });
    const def = getBoardDef("customer");
    expect(def.bands.find((b) => b.id === "first_sale")?.label).toBe("Closed");
    expect(def.milestoneColumnLabel.first_sale).toBe("Closed");
    expect(def.reserved).toContain("Closed");
  });

  it("no signed-in person means the defaults", () => {
    useSessionStore.setState({ user: null });
    expect(name("recruiting", "registered")).toBe("Registered");
    expect(saveStageNames("recruiting", { registered: "X" })).toMatchObject({ ok: false });
  });
});
