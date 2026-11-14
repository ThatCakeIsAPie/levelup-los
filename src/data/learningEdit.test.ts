import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePeopleStore } from "@/stores/peopleStore";
import { DEMO_USERS, useSessionStore } from "@/stores/sessionStore";
import { bestLearningStreak, learningStreak, useCrmStore, type Learning } from "@/stores/crmStore";
import { seedPeople } from "@/data/seed";
import { daysFromToday } from "@/lib/dates";
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

import { logLearning, removeLearning, updateLearning } from "./crm";
import { weekTotals } from "@/modules/dashboard/learning";
import { weeklyGoalView, type GoalInput } from "./weeklyGoal";
import {
  completeLibraryItemWithEntry,
  markLibraryItemDone,
  markLibraryItemNotDone,
} from "./library/mutations";
import { library, updateLibrary } from "./library/store";
import type { CatalogItem } from "./library/types";

const ME = "1";
const list = () => useCrmStore.getState().learning;
const byId = (id: string) => list().find((l) => l.id === id)!;
const goalInput = (learning: Learning[], today: string): GoalInput => ({
  personId: ME,
  today,
  learning,
  contacts: [],
  people: [],
  sales: [],
  attendances: [],
  events: [],
  pipelineMoves: [],
  customerMoves: [],
});

beforeEach(() => {
  usePeopleStore.setState({ people: seedPeople() });
  useSessionStore.setState({ user: DEMO_USERS.find((u) => u.personId === ME)! });
  useCrmStore.setState({ learning: [] });
});

describe("updateLearning", () => {
  it("changes the entry in place: same id, person and createdAt, same count", () => {
    logLearning({ kind: "pages", title: "Old", amount: 20, unit: "pages", date: "2026-11-01" });
    logLearning({ kind: "podcast", title: "Other", amount: 1, date: "2026-11-02" });
    const before = list().find((l) => l.title === "Old")!;
    const other = list().find((l) => l.title === "Other")!;

    const prev = updateLearning(before.id, {
      kind: "pages",
      title: "New",
      amount: 45,
      unit: "minutes",
      date: "2026-11-05",
    });

    expect(prev).toEqual(before);
    expect(list()).toHaveLength(2);
    expect(byId(before.id)).toEqual({
      id: before.id,
      personId: before.personId,
      createdAt: before.createdAt,
      kind: "pages",
      title: "New",
      amount: 45,
      unit: "minutes",
      date: "2026-11-05",
    });
    expect(byId(other.id)).toBe(other); // other entries are untouched
  });

  it("clears the unit when none is given (a workshop has none)", () => {
    logLearning({ kind: "pages", title: "Book", amount: 3, unit: "chapters" });
    const { id } = list()[0];
    updateLearning(id, { kind: "workshop", title: "Book", amount: 1, date: list()[0].date });
    expect("unit" in byId(id)).toBe(false);
    expect(byId(id).kind).toBe("workshop");
  });

  it("undo is the same call with the returned values", () => {
    logLearning({ kind: "pages", title: "Book", amount: 3, unit: "chapters", date: "2026-11-01" });
    const before = list()[0];
    const prev = updateLearning(before.id, {
      kind: "podcast",
      title: "Show",
      amount: 2,
      unit: "episodes",
      date: "2026-11-09",
    })!;
    updateLearning(prev.id, {
      kind: prev.kind,
      title: prev.title,
      amount: prev.amount,
      date: prev.date,
      unit: prev.unit,
    });
    expect(list()).toEqual([before]);
  });

  it("restores an entry that had no unit as it was", () => {
    useCrmStore.setState({
      learning: [
        { id: "old", personId: ME, kind: "pages", title: "A", amount: 5, date: "2026-11-01" },
      ],
    });
    const prev = updateLearning("old", {
      kind: "pages",
      title: "A",
      amount: 6,
      unit: "pages",
      date: "2026-11-01",
    })!;
    expect(byId("old").unit).toBe("pages");
    updateLearning("old", { ...prev, unit: prev.unit });
    expect("unit" in byId("old")).toBe(false);
  });

  it("does nothing for an unknown id (never adds an entry) or someone else's entry", () => {
    useCrmStore.setState({
      learning: [
        { id: "theirs", personId: "2", kind: "pages", title: "A", amount: 5, date: "2026-11-01" },
      ],
    });
    const next = { kind: "pages", title: "B", amount: 9, date: "2026-11-02" } as const;
    expect(updateLearning("nope", next)).toBeNull();
    expect(updateLearning("theirs", next)).toBeNull();
    expect(list()).toHaveLength(1);
    expect(byId("theirs").title).toBe("A");
  });

  it("an entry removed meanwhile stays removed: an undo does not bring it back", () => {
    logLearning({ kind: "pages", title: "Book", amount: 3, unit: "pages" });
    const { id } = list()[0];
    const prev = updateLearning(id, {
      kind: "pages",
      title: "B",
      amount: 4,
      unit: "pages",
      date: "2026-11-02",
    })!;
    removeLearning(id);
    expect(updateLearning(prev.id, { ...prev })).toBeNull();
    expect(list()).toHaveLength(0);
  });
});

describe("figures follow an edited entry", () => {
  const today = daysFromToday(0);
  const entry = (id: string, date: string, amount: number): Learning => ({
    id,
    personId: ME,
    kind: "pages",
    title: id,
    amount,
    unit: "pages",
    date,
  });

  it("streak, best streak, week totals and the weekly goal change with the date and amount", () => {
    useCrmStore.setState({
      learning: [
        entry("a", today, 10),
        entry("b", daysFromToday(-1), 10),
        entry("c", daysFromToday(-9), 10),
      ],
    });
    const figures = () => {
      const l = list();
      return {
        streak: learningStreak(l),
        best: bestLearningStreak(l),
        pages: weekTotals(l, today).pages,
        goalDone: weeklyGoalView(
          { items: [{ kind: "reading", target: 40, unit: "pages" }] },
          goalInput(l, today),
        ).items[0].done,
      };
    };
    expect(figures()).toEqual({ streak: 2, best: 2, pages: 20, goalDone: 20 });

    // Move the old entry to the day before yesterday: the streak runs to three days.
    updateLearning("c", {
      kind: "pages",
      title: "c",
      amount: 10,
      unit: "pages",
      date: daysFromToday(-2),
    });
    expect(figures()).toEqual({ streak: 3, best: 3, pages: 30, goalDone: 30 });

    // Change an amount: the week and the goal follow, the streak does not.
    updateLearning("a", { kind: "pages", title: "a", amount: 25, unit: "pages", date: today });
    expect(figures()).toEqual({ streak: 3, best: 3, pages: 45, goalDone: 45 });

    // Change the unit and kind: pages no longer count toward a pages goal.
    updateLearning("a", { kind: "pages", title: "a", amount: 25, unit: "minutes", date: today });
    expect(figures().goalDone).toBe(20);
    updateLearning("b", { kind: "workshop", title: "b", amount: 1, date: daysFromToday(-1) });
    expect(figures()).toMatchObject({ pages: 10, goalDone: 10 });

    // Move today's entry out of the week and the streak ends (yesterday is still a workshop day).
    updateLearning("a", {
      kind: "pages",
      title: "a",
      amount: 25,
      unit: "minutes",
      date: daysFromToday(-30),
    });
    expect(figures().streak).toBe(2);
  });
});

describe("an entry a library completion points at", () => {
  const talk: CatalogItem = {
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
    id: "talk",
    title: "Inviting without pressure",
    kind: "audio",
    format: "talk",
    durationSec: 600,
    pageCount: null,
  };
  const progress = () => library().progress.find((p) => p.personId === ME && p.itemId === "talk");
  beforeEach(() => {
    updateLibrary(() => ({ items: [talk], topics: [], channels: [], progress: [] }));
  });

  it("keeps its id after an edit; the item stays done; the library's undo removes that one entry", () => {
    const r = completeLibraryItemWithEntry("talk", {
      amount: 1,
      unit: "episodes",
      date: "2026-11-03",
    })!;
    logLearning({ kind: "workshop", title: "Another", amount: 1 });
    expect(list()).toHaveLength(2);
    const done = progress();

    updateLearning(r.learningId, {
      kind: "podcast",
      title: "Renamed",
      amount: 2,
      unit: "episodes",
      date: "2026-11-04",
    });
    expect(list()).toHaveLength(2);
    expect(byId(r.learningId)).toMatchObject({ title: "Renamed", amount: 2 });
    expect(progress()).toBe(done); // editing never touches the library

    r.undo();
    expect(list().map((l) => l.title)).toEqual(["Another"]);
    expect(progress()).toBeUndefined();
  });

  it("an edit does not log the item again or change its done state", () => {
    markLibraryItemDone("talk");
    const id = list()[0].id;
    updateLearning(id, {
      kind: "podcast",
      title: talk.title,
      amount: 3,
      unit: "episodes",
      date: "2026-11-04",
    });
    expect(list()).toHaveLength(1);
    expect(progress()?.completedAt).toBeTruthy();
    markLibraryItemNotDone("talk");
    updateLearning(id, {
      kind: "podcast",
      title: talk.title,
      amount: 4,
      unit: "episodes",
      date: "2026-11-04",
    });
    expect(list()).toHaveLength(1);
    expect(progress()?.completedAt).toBeNull();
  });
});
