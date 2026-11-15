import { beforeEach, describe, expect, it, vi } from "vitest";
// The stores persist to localStorage in the demo; there is none in this environment.
const mem = vi.hoisted(() => {
  const m = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    },
  });
  return m;
});

import { FALLBACK_TITLE, convertLegacyCards } from "./legacy";
import type { CardNote, CardTask } from "./types";

const AT = "2026-11-10T15:00:00.000Z";
const ctx = (over = {}) => ({
  ownerOf: (id: string) => (id === "orphan" ? null : "4"),
  labelOf: (_id: string, col: string) =>
    ({ s_book: "Book", first_meeting: "First meeting (MG1)" })[col] ?? null,
  ...over,
});
const card = (id: string, over: Record<string, unknown> = {}) => ({
  personId: id,
  column: "contact",
  updatedAt: AT,
  nextColumn: null,
  nextStepDate: null,
  nextStepTime: null,
  note: null,
  ...over,
});

describe("convertLegacyCards (pure)", () => {
  it("makes one open task per booking: the column's name, the day and time, the owner", () => {
    const r = convertLegacyCards(
      "recruiting",
      [
        card("9", {
          nextColumn: "first_meeting",
          nextStepDate: "2026-11-12",
          nextStepTime: "18:30",
        }),
        card("10", { nextColumn: "s_book", nextStepDate: "2026-11-13" }),
      ],
      (c) => c.personId,
      ctx(),
    );
    expect(r.found).toBe(true);
    expect(r.tasks).toHaveLength(2);
    expect(r.tasks[0]).toMatchObject({
      personId: "9",
      entryId: null,
      title: "First meeting (MG1)",
      dueDate: "2026-11-12",
      dueTime: "18:30",
      assigneeId: "4",
      done: false,
      doneAt: null,
      createdAt: AT,
    });
    expect(r.tasks[1]).toMatchObject({ title: "Book", dueDate: "2026-11-13", dueTime: null });
  });

  it("falls back to 'Next step' when the column is gone, and keeps a booking without a day", () => {
    const r = convertLegacyCards(
      "recruiting",
      [
        card("9", { nextColumn: "deleted_step", nextStepDate: "2026-11-12" }),
        card("10", { nextColumn: "s_book" }),
      ],
      (c) => c.personId,
      ctx(),
    );
    expect(r.tasks[0].title).toBe(FALLBACK_TITLE);
    expect(r.tasks[1]).toMatchObject({ title: "Book", dueDate: null, dueTime: null });
  });

  it("makes one note per non-empty note: the owner, written when the card last changed", () => {
    const r = convertLegacyCards(
      "customer",
      [
        { entryId: "le-1", updatedAt: AT, note: "  Likes the sampler  " },
        { entryId: "le-2", updatedAt: AT, note: "   " },
        { entryId: "le-3", updatedAt: AT, note: null },
      ],
      (c) => c.entryId,
      ctx(),
    );
    expect(r.notes).toEqual([
      expect.objectContaining({
        entryId: "le-1",
        personId: null,
        authorId: "4",
        body: "Likes the sampler",
        createdAt: AT,
      }),
    ]);
    expect(r.tasks).toHaveLength(0);
  });

  it("drops the old fields from the cards and does nothing with cards already converted", () => {
    const r = convertLegacyCards(
      "recruiting",
      [card("9", { nextColumn: "s_book", nextStepDate: "2026-11-12", note: "x" })],
      (c) => c.personId,
      ctx(),
    );
    expect(Object.keys(r.cards[0]).sort()).toEqual(["column", "personId", "updatedAt"]);
    const again = convertLegacyCards("recruiting", r.cards, (c) => c.personId, ctx());
    expect(again).toMatchObject({ found: false, tasks: [], notes: [] });
    expect(again.cards[0]).toBe(r.cards[0]);
  });

  it("creates nothing for a task or note with the same content already on the card", () => {
    const existing = {
      tasks: [
        { personId: "9", entryId: null, title: "Book", dueDate: "2026-11-12", dueTime: null },
      ] as CardTask[],
      notes: [{ personId: "9", entryId: null, body: "Met at the gym" }] as CardNote[],
    };
    const r = convertLegacyCards(
      "recruiting",
      [card("9", { nextColumn: "s_book", nextStepDate: "2026-11-12", note: "Met at the gym" })],
      (c) => c.personId,
      ctx({ existing }),
    );
    expect(r.tasks).toHaveLength(0);
    expect(r.notes).toHaveLength(0);
    expect(r.cards[0]).not.toHaveProperty("note");
  });

  it("handles zero bookings and zero notes", () => {
    const r = convertLegacyCards("recruiting", [card("9")], (c) => c.personId, ctx());
    expect(r.tasks).toHaveLength(0);
    expect(r.notes).toHaveLength(0);
  });

  it("leaves the assignee empty when the card has no owner", () => {
    const r = convertLegacyCards(
      "recruiting",
      [card("orphan", { nextColumn: "s_book", note: "n" })],
      (c) => c.personId,
      ctx(),
    );
    expect(r.tasks[0].assigneeId).toBeNull();
    expect(r.notes[0].authorId).toBeNull();
  });
});

describe("a saved browser's boards are converted once as they load", () => {
  beforeEach(() => {
    mem.clear();
    vi.resetModules();
  });

  const savedCard = (over = {}) => ({
    personId: "9",
    column: "first_plan",
    enteredAt: AT,
    updatedAt: AT,
    nextColumn: "first_plan",
    nextStepDate: "2026-11-12",
    nextStepTime: "09:15",
    note: "Bring to the weekend",
    rating: null,
    source: null,
    droppedAt: null,
    ...over,
  });

  it("turns the saved bookings and notes into tasks and notes, then saves the cards without them", async () => {
    const { storageKey } = await import("@/lib/brand");
    const { SEED_VERSION } = await import("@/data/seed");
    mem.set(
      storageKey("pipeline"),
      JSON.stringify({
        state: {
          steps: [],
          hides: [],
          cards: [savedCard()],
          moves: [],
          goals: [],
          settings: [],
          shares: [],
          requests: [],
          cancellations: [],
        },
        version: SEED_VERSION * 100 + 2,
      }),
    );
    const { usePipelineStore } = await import("../pipeline/store");
    const { cardTasks } = await import("./store");
    const { tasks, notes } = cardTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      personId: "9",
      dueDate: "2026-11-12",
      dueTime: "09:15",
      assigneeId: "4",
      done: false,
    });
    expect(tasks[0].title).toBeTruthy();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ personId: "9", authorId: "4", body: "Bring to the weekend" });
    const card = usePipelineStore.getState().cards[0];
    expect(card).not.toHaveProperty("nextColumn");
    expect(card).not.toHaveProperty("note");
    expect(usePipelineStore.getState()).not.toHaveProperty("cancellations");
    // Written back at once, and the converted tasks are saved with the card tasks store.
    const saved = JSON.parse(mem.get(storageKey("pipeline"))!);
    expect(saved.state.cards[0]).not.toHaveProperty("nextColumn");
    expect(JSON.parse(mem.get(storageKey("cardTasks"))!).state.tasks).toHaveLength(1);
  });

  it("converts once: a second load of the same browser creates nothing more", async () => {
    const { storageKey } = await import("@/lib/brand");
    const { SEED_VERSION } = await import("@/data/seed");
    mem.set(
      storageKey("pipeline"),
      JSON.stringify({
        state: {
          steps: [],
          hides: [],
          cards: [savedCard()],
          moves: [],
          goals: [],
          settings: [],
          shares: [],
          requests: [],
        },
        version: SEED_VERSION * 100 + 2,
      }),
    );
    await import("../pipeline/store");
    const first = (await import("./store")).cardTasks();
    expect(first.tasks).toHaveLength(1);
    vi.resetModules();
    await import("../pipeline/store");
    const second = (await import("./store")).cardTasks();
    expect(second.tasks).toHaveLength(1);
    expect(second.notes).toHaveLength(1);
  });

  it("converts the customer board too, with the entry's owner", async () => {
    const { storageKey } = await import("@/lib/brand");
    const { SEED_VERSION } = await import("@/data/seed");
    mem.set(
      storageKey("customerPipeline"),
      JSON.stringify({
        state: {
          steps: [],
          hides: [],
          entries: [
            { id: "le-4-6", ownerId: "4", name: "Fay", referredBy: null, referredByEntry: null },
          ],
          cards: [
            {
              entryId: "le-4-6",
              column: "cs-sampled",
              enteredAt: AT,
              updatedAt: AT,
              nextColumn: "first_meeting",
              nextStepDate: "2026-11-12",
              nextStepTime: null,
              note: "Offer Ditto",
            },
          ],
          moves: [],
        },
        version: SEED_VERSION * 100 + 3,
      }),
    );
    await import("../customerPipeline/store");
    const { cardTasks } = await import("./store");
    expect(cardTasks().tasks).toEqual([
      expect.objectContaining({
        entryId: "le-4-6",
        personId: null,
        assigneeId: "4",
        dueDate: "2026-11-12",
      }),
    ]);
    expect(cardTasks().notes).toEqual([
      expect.objectContaining({ entryId: "le-4-6", authorId: "4", body: "Offer Ditto" }),
    ]);
  });
});
