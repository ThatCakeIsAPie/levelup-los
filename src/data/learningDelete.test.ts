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

import { deleteLearning, logLearning, restoreLearning } from "./crm";
import { weekTotals } from "@/modules/dashboard/learning";
import { weeklyGoalView, type GoalInput } from "./weeklyGoal";
import {
  completeLibraryItemWithEntry,
  deleteLearningEntry,
  libraryLearningId,
  markLibraryItemDone,
  markLibraryItemNotDone,
} from "./library/mutations";
import { library, updateLibrary } from "./library/store";
import type { CatalogItem, LibraryProgress } from "./library/types";

const ME = "1";
const list = () => useCrmStore.getState().learning;
const mine = () => list().filter((l) => l.personId === ME);
const today = daysFromToday(0);
const entry = (
  id: string,
  date: string,
  amount: number,
  over: Partial<Learning> = {},
): Learning => ({
  id,
  personId: ME,
  kind: "pages",
  title: id,
  amount,
  unit: "pages",
  date,
  createdAt: `${date}T09:00:00.000Z`,
  ...over,
});
const goalInput = (learning: Learning[]): GoalInput => ({
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
  updateLibrary(() => ({ items: [], topics: [], channels: [], progress: [] }));
});

describe("deleteLearning / restoreLearning", () => {
  it("removes exactly one entry and the undo brings back exactly that one, in its place", () => {
    useCrmStore.setState({
      learning: [
        entry("a", today, 10),
        entry("b", daysFromToday(-1), 20),
        entry("c", "2026-11-01", 5),
      ],
    });
    const before = list();
    expect(before).toHaveLength(3);

    const removed = deleteLearning("b")!;
    expect(removed.entry).toBe(before[1]);
    expect(list().map((l) => l.id)).toEqual(["a", "c"]);
    expect(list()[0]).toBe(before[0]); // the others are untouched
    expect(list()[1]).toBe(before[2]);

    expect(restoreLearning(removed)).toBe(true);
    expect(list()).toHaveLength(3);
    expect(list()).toEqual(before); // same id, values, createdAt and place
    expect(list()[1].createdAt).toBe(before[1].createdAt);
  });

  it("an undo pressed twice, or after the entry came back, adds nothing", () => {
    useCrmStore.setState({ learning: [entry("a", today, 10)] });
    const removed = deleteLearning("a")!;
    expect(restoreLearning(removed)).toBe(true);
    expect(restoreLearning(removed)).toBe(false);
    expect(list()).toHaveLength(1);
  });

  it("refuses another person's entry, an unknown id and an entry that is not yours to restore", () => {
    const theirs = entry("theirs", today, 10, { personId: "2" });
    useCrmStore.setState({ learning: [theirs, entry("mine", today, 5)] });
    expect(deleteLearning("theirs")).toBeNull();
    expect(deleteLearning("nope")).toBeNull();
    expect(deleteLearningEntry("theirs")).toBeNull();
    expect(list()).toHaveLength(2);
    expect(list()[0]).toBe(theirs);
    expect(restoreLearning({ entry: entry("x", today, 1, { personId: "2" }), index: 0 })).toBe(
      false,
    );
    expect(list()).toHaveLength(2);
  });

  it("refuses when nobody is signed in", () => {
    useCrmStore.setState({ learning: [entry("a", today, 10)] });
    useSessionStore.setState({ user: null });
    expect(deleteLearning("a")).toBeNull();
    expect(list()).toHaveLength(1);
  });
});

describe("figures follow a deleted entry", () => {
  const figures = () => {
    const l = list();
    return {
      streak: learningStreak(l),
      best: bestLearningStreak(l),
      pages: weekTotals(l, today).pages,
      goalDone: weeklyGoalView(
        { items: [{ kind: "reading", target: 40, unit: "pages" }] },
        goalInput(l),
      ).items[0].done,
    };
  };

  it("streak, best streak, week totals and the weekly goal change, and change back with the undo", () => {
    useCrmStore.setState({
      learning: [
        entry("a", today, 10),
        entry("b", daysFromToday(-1), 15),
        entry("c", daysFromToday(-2), 5),
      ],
    });
    expect(figures()).toEqual({ streak: 3, best: 3, pages: 30, goalDone: 30 });

    const removed = deleteLearning("b")!; // the middle day: the run breaks
    expect(figures()).toEqual({ streak: 1, best: 1, pages: 15, goalDone: 15 });

    restoreLearning(removed);
    expect(figures()).toEqual({ streak: 3, best: 3, pages: 30, goalDone: 30 });

    deleteLearning("a"); // today: the run now ends yesterday
    expect(figures()).toEqual({ streak: 2, best: 2, pages: 20, goalDone: 20 });
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
  const done = { amount: 45, unit: "minutes", date: "2026-11-03" } as const;
  beforeEach(() => {
    updateLibrary(() => ({ items: [talk], topics: [], channels: [], progress: [] }));
  });

  it("finishing logs the row under the id the database uses", () => {
    const r = completeLibraryItemWithEntry("talk", done)!;
    expect(r.learningId).toBe(libraryLearningId(ME, "talk"));
    expect(mine()).toHaveLength(1);
    expect(mine()[0].id).toBe(`library:talk:${ME}`);
    markLibraryItemDone("talk");
    expect(mine()).toHaveLength(1);
  });

  it("delete takes the entry and un-marks the item; undo brings back both, and one entry only", () => {
    logLearning({ kind: "workshop", title: "Another", amount: 1 });
    const r = completeLibraryItemWithEntry("talk", done)!;
    const row = list().find((l) => l.id === r.learningId)!;
    const finished = progress()!;
    expect(list()).toHaveLength(2);
    expect(finished.completedAt).toBeTruthy();

    const removed = deleteLearningEntry(r.learningId)!;
    expect(list()).toHaveLength(1);
    expect(list()[0].title).toBe("Another");
    expect(progress()).toBeUndefined(); // never started otherwise: as if never finished

    removed.undo();
    expect(list()).toHaveLength(2);
    expect(list().find((l) => l.id === r.learningId)).toEqual(row); // id, values, createdAt
    expect(progress()).toEqual(finished);
    removed.undo(); // pressed again: nothing more
    expect(list()).toHaveLength(2);
  });

  it("the un-marked item can be finished again and logs one entry; an old undo then adds none", () => {
    const r = completeLibraryItemWithEntry("talk", done)!;
    const removed = deleteLearningEntry(r.learningId)!;
    expect(markLibraryItemDone("talk")).toMatchObject({ logged: true });
    expect(mine()).toHaveLength(1);
    const again = list()[0];
    removed.undo();
    expect(mine()).toHaveLength(1);
    expect(list()[0]).toBe(again);
    expect(progress()?.completedAt).toBeTruthy();
  });

  it("keeps where they stopped, and a plain mark-as-done entry is linked the same way", () => {
    const started: LibraryProgress = {
      personId: ME,
      itemId: "talk",
      positionSec: 120,
      completedAt: null,
      loggedAt: null,
      updatedAt: "2026-11-01T10:00:00.000Z",
    };
    updateLibrary(() => ({ progress: [started] }));
    markLibraryItemDone("talk");
    const finished = progress()!;
    const id = libraryLearningId(ME, "talk");
    expect(list().map((l) => l.id)).toEqual([id]);

    const removed = deleteLearningEntry(id)!;
    expect(list()).toHaveLength(0);
    expect(progress()).toMatchObject({ positionSec: 120, completedAt: null, loggedAt: null });
    removed.undo();
    expect(progress()).toEqual(finished);
    expect(list()).toHaveLength(1);
  });

  it("an entry whose item was marked not done: delete clears the log mark so finishing logs again", () => {
    markLibraryItemDone("talk");
    markLibraryItemNotDone("talk"); // the entry stays; loggedAt stays
    const id = libraryLearningId(ME, "talk");
    expect(list()).toHaveLength(1);
    deleteLearningEntry(id);
    expect(list()).toHaveLength(0);
    expect(markLibraryItemDone("talk")).toMatchObject({ logged: true });
    expect(list()).toHaveLength(1);
  });

  it("'Mark as not done' still leaves the entry, and the library's own undo still removes it", () => {
    const r = completeLibraryItemWithEntry("talk", done)!;
    markLibraryItemNotDone("talk");
    expect(mine()).toHaveLength(1);
    expect(progress()?.completedAt).toBeNull();
    r.undo();
    expect(mine()).toHaveLength(0);
    expect(progress()).toBeUndefined();
  });

  it("an ordinary entry, even with a library item's title, leaves the library alone", () => {
    const r = completeLibraryItemWithEntry("talk", done)!;
    logLearning({ kind: "podcast", title: talk.title, amount: 1 });
    const ordinary = list().find((l) => l.id !== r.learningId)!;
    const finished = progress();
    const removed = deleteLearningEntry(ordinary.id)!;
    expect(list().map((l) => l.id)).toEqual([r.learningId]);
    expect(progress()).toBe(finished);
    removed.undo();
    expect(list()).toHaveLength(2);
    expect(progress()).toBe(finished);
  });
});
