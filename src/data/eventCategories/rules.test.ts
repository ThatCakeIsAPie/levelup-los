import { describe, expect, it } from "vitest";
import type { CrmEvent } from "@/stores/eventsStore";
import { seedEvents } from "../seed";
import {
  STARTING_CATEGORIES,
  UNKNOWN_CATEGORY,
  activeCategories,
  allowsVirtual,
  canCreateCategories,
  canEditCategories,
  categoryChoices,
  categoryForLegacyType,
  categoryLookup,
  categoryNameError,
  categorySummary,
  convertLegacyEvent,
  convertLegacyEvents,
  countsForMissed,
  eventCounts,
  eventFormat,
  eventModes,
  mergeError,
  mergeEvents,
  nextPosition,
  reorderPatches,
  starterCategoryId,
  startingCategories,
  usesTickets,
  usesTravel,
  welcomesCustomers,
} from "./rules";
import type { EventCategory } from "./types";

const cats = startingCategories();
const byKey = (key: string) => cats.find((c) => c.id === starterCategoryId(key as never))!;
const ev = (id: string, categoryId: string, o: Partial<CrmEvent> = {}): CrmEvent => ({
  id,
  name: id,
  categoryId,
  date: "2026-10-10",
  ...o,
});
const custom = (o: Partial<EventCategory> & Pick<EventCategory, "id" | "name">): EventCategory => ({
  icon: "calendar",
  tone: "neutral",
  allowsVirtual: false,
  usesTickets: false,
  usesTravel: false,
  countsForMissed: true,
  welcomesCustomers: false,
  position: 10,
  createdAt: "2026-10-16T00:00:00.000Z",
  ...o,
});

describe("starting categories (the old six types)", () => {
  it("follow the plan's table, in order", () => {
    expect(cats.map((c) => c.name)).toEqual([
      "Night Owls",
      "Work session",
      "Info session",
      "Training",
      "Monthly team meeting",
      "Conference",
    ]);
    expect(cats.map((c) => c.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(cats.filter(allowsVirtual).map((c) => c.name)).toEqual([
      "Info session",
      "Training",
      "Monthly team meeting",
      "Conference",
    ]);
    expect(cats.filter(usesTickets).map((c) => c.name)).toEqual([
      "Monthly team meeting",
      "Conference",
    ]);
    expect(cats.filter(usesTravel).map((c) => c.name)).toEqual(["Conference"]);
    expect(cats.filter(welcomesCustomers).map((c) => c.name)).toEqual([
      "Info session",
      "Training",
      "Monthly team meeting",
    ]);
    expect(cats.every(countsForMissed)).toBe(true);
  });

  it("have the database's ids: <workspace>-<old type>", () => {
    expect(byKey("night_owls").id).toBe("w1-night_owls");
    expect(startingCategories("ws9").map((c) => c.id)).toEqual(
      STARTING_CATEGORIES.map((s) => `ws9-${s.key}`),
    );
  });

  it("cover every seed event", () => {
    const ids = new Set(cats.map((c) => c.id));
    for (const e of seedEvents()) expect(ids.has(e.categoryId)).toBe(true);
  });
});

describe("what a category's settings mean", () => {
  it("keeps in-person-only categories in person", () => {
    expect(eventFormat({ format: "virtual" }, byKey("night_owls"))).toBe("in_person");
    expect(eventFormat({}, byKey("training"))).toBe("in_person");
    expect(eventModes({ format: "both" }, byKey("info_session"))).toEqual(["in_person", "virtual"]);
    expect(eventModes({ format: "virtual" }, byKey("conference"))).toEqual(["virtual"]);
  });

  it("follows a team's own category", () => {
    const online = custom({ id: "c1", name: "Zoom call", allowsVirtual: true });
    expect(eventFormat({ format: "virtual" }, online)).toBe("virtual");
    expect(categorySummary(online)).toBe("In person or online");
    const trip = custom({ id: "c2", name: "Retreat", usesTickets: true, usesTravel: true });
    expect(categorySummary(trip)).toBe("In person · Tickets · Travel");
  });

  it("treats an unknown category as a plain event that still reminds uplines", () => {
    const lookup = categoryLookup(cats);
    expect(lookup(ev("x", "gone"))).toBe(UNKNOWN_CATEGORY);
    expect(lookup(undefined)).toBe(UNKNOWN_CATEGORY);
    expect(usesTickets(UNKNOWN_CATEGORY)).toBe(false);
    expect(countsForMissed(undefined)).toBe(true);
    // A format already set isn't hidden while categories load.
    expect(eventFormat({ format: "both" }, UNKNOWN_CATEGORY)).toBe("both");
  });
});

describe("archived categories", () => {
  const archived = { ...byKey("work_session"), archivedAt: "2026-10-16T00:00:00.000Z" };
  const list = cats.map((c) => (c.id === archived.id ? archived : c));

  it("aren't offered for new events, but stay for the event that has one", () => {
    expect(activeCategories(list).map((c) => c.id)).not.toContain(archived.id);
    expect(categoryChoices(list).map((c) => c.id)).not.toContain(archived.id);
    expect(categoryChoices(list, archived.id).map((c) => c.id)).toContain(archived.id);
    // Old events still look it up.
    expect(categoryLookup(list)(ev("ws1", archived.id)).name).toBe("Work session");
  });

  it("free their name for a new category", () => {
    expect(categoryNameError("work session", list)).toBeNull();
    expect(categoryNameError("Work session", cats)).toBe(
      "There's already a category called Work session.",
    );
  });
});

describe("names", () => {
  it("must be given, short and unique among active categories (any case or spacing)", () => {
    expect(categoryNameError("  ", cats)).toBe("Give the category a name.");
    expect(categoryNameError("x".repeat(41), cats)).toMatch(/under 41/);
    expect(categoryNameError(" night  OWLS ", cats)).toMatch(/Night Owls/);
    expect(categoryNameError("Night Owls", cats, starterCategoryId("night_owls"))).toBeNull();
    expect(categoryNameError("Book club", cats)).toBeNull();
  });
});

describe("order", () => {
  it("adds new categories at the end and saves only changed positions", () => {
    expect(nextPosition(cats)).toBe(6);
    expect(nextPosition([])).toBe(0);
    const ids = cats.map((c) => c.id);
    const moved = [ids[5], ...ids.slice(0, 5)];
    expect(reorderPatches(cats, moved)).toHaveLength(6);
    const swap = [ids[1], ids[0], ...ids.slice(2)];
    expect(reorderPatches(cats, swap)).toEqual([
      { id: ids[1], position: 0 },
      { id: ids[0], position: 1 },
    ]);
  });
});

describe("merge", () => {
  const events = [
    ev("a", starterCategoryId("info_session"), { format: "both" }),
    ev("b", starterCategoryId("info_session")),
    ev("c", starterCategoryId("training")),
  ];

  it("moves every event of one category into the other", () => {
    const into = byKey("training");
    const r = mergeEvents(events, starterCategoryId("info_session"), into);
    expect(r.moved).toEqual(["a", "b"]);
    expect(r.events.every((e) => e.categoryId === into.id)).toBe(true);
    expect(r.events[0].format).toBe("both");
    expect(eventCounts(r.events).get(into.id)).toBe(3);
  });

  it("makes online events in person when the other category is in person only", () => {
    const r = mergeEvents(events, starterCategoryId("info_session"), byKey("night_owls"));
    expect(r.events[0].format).toBe("in_person");
  });

  it("needs two different categories and an active target", () => {
    const from = starterCategoryId("info_session");
    expect(mergeError(from, from, cats)).toBe("Pick a different category.");
    expect(mergeError(from, "nope", cats)).toBe("Pick a category to merge into.");
    const list = cats.map((c) =>
      c.id === starterCategoryId("training") ? { ...c, archivedAt: "2026-10-16" } : c,
    );
    expect(mergeError(from, starterCategoryId("training"), list)).toMatch(/archived/);
    expect(mergeError(from, starterCategoryId("conference"), cats)).toBeNull();
  });
});

describe("old links and saved demo data", () => {
  it("maps an old ?type= to its starting category, even after a rename", () => {
    expect(categoryForLegacyType("night_owls", cats)?.name).toBe("Night Owls");
    expect(categoryForLegacyType("team_meeting", cats)?.name).toBe("Monthly team meeting");
    const renamed = cats.map((c) => (c.name === "Training" ? { ...c, name: "Skills night" } : c));
    expect(categoryForLegacyType("training", renamed)?.name).toBe("Skills night");
    // A workspace whose ids don't follow the pattern still matches by name.
    const other = cats.map((c) => ({ ...c, id: `x${c.position}` }));
    expect(categoryForLegacyType("conference", other)?.id).toBe("x5");
    expect(categoryForLegacyType("nonsense", cats)).toBeUndefined();
  });

  it("converts events saved with a type", () => {
    const old = { id: "e", name: "E", date: "2026-10-01", type: "night_owls" };
    expect(convertLegacyEvent(old as never)).toEqual({
      id: "e",
      name: "E",
      date: "2026-10-01",
      categoryId: "w1-night_owls",
    });
    expect(convertLegacyEvent({ ...old, type: "team_meeting" } as never).categoryId).toBe(
      "w1-monthly_meeting",
    );
    expect(convertLegacyEvent({ ...old, type: "whatever" } as never).categoryId).toBe(
      "w1-monthly_meeting",
    );
    const current = ev("n", "custom-1");
    expect(convertLegacyEvent(current)).toEqual(current);
    expect(convertLegacyEvents([old, current]).map((e) => e.categoryId)).toEqual([
      "w1-night_owls",
      "custom-1",
    ]);
    expect(convertLegacyEvents(undefined)).toEqual([]);
  });
});

describe("who may", () => {
  it("lets event planners add, and leaders and deputies tidy up", () => {
    expect(canCreateCategories(true)).toBe(true);
    expect(canCreateCategories(false)).toBe(false);
    expect(canEditCategories("leader", [])).toBe(true);
    expect(canEditCategories("ibo", ["1"])).toBe(true); // Maria's deputy
    expect(canEditCategories("ibo", [])).toBe(false);
    expect(canEditCategories("apprentice", [])).toBe(false);
    expect(canEditCategories(undefined, [])).toBe(false);
  });
});
