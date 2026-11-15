import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePeopleStore } from "@/stores/peopleStore";
import { DEMO_USERS, useSessionStore } from "@/stores/sessionStore";
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

import { useCustomerPipelineStore } from "../customerPipeline/store";
import type { ListEntry } from "../customerPipeline/types";
import { removePerson } from "../people";
import { removeListEntry } from "../customerPipeline/mutations";
import { cardTasks, useCardTasksStore } from "./store";
import {
  addCardNote,
  addCardTask,
  canEditCard,
  followupsWithout,
  removeCardFollowups,
  removeCardNote,
  removeCardTask,
  setTaskDone,
  updateCardTask,
} from "./mutations";
import type { CardRef } from "./types";

// Carlos Rivera (9) is Jamal's (4) prospect; Jamal is Anita's (2), Anita is Maria's (1). Priya (8) is in
// another branch under Maria; Beau (20) is a candidate.
const PROSPECT: CardRef = { board: "recruiting", id: "9" };
const OWNER = "4";
const as = (id: string) =>
  useSessionStore.setState({ user: DEMO_USERS.find((u) => u.personId === id)! });
const tasks = () => cardTasks().tasks;
const notes = () => cardTasks().notes;

const entry = (over: Partial<ListEntry> = {}): ListEntry => ({
  id: "le-test",
  ownerId: "4",
  name: "Lee List",
  howKnown: null,
  phone: null,
  email: null,
  notes: null,
  rating: null,
  customerId: null,
  prospectId: null,
  referredBy: null,
  referredByEntry: null,
  addedBy: "4",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...over,
});
const LIST: CardRef = { board: "customer", id: "le-test" };

beforeEach(() => {
  usePeopleStore.setState({ people: seedPeople() });
  useCustomerPipelineStore.setState({
    entries: [entry()],
    cards: [],
    moves: [],
    steps: [],
    hides: [],
  });
  useCardTasksStore.setState({ tasks: [], notes: [] });
  as("1");
});

describe("who may read and edit a card's tasks and notes", () => {
  it("is whoever may edit the card: its owner, an upline, the leader; not another branch or a candidate", () => {
    for (const who of ["4", "2", "1"]) {
      as(who);
      expect(canEditCard(PROSPECT), who).toBe(true);
      expect(addCardTask(PROSPECT, { title: `by ${who}` }).ok, who).toBe(true);
    }
    for (const who of ["8", "20", "700"]) {
      as(who);
      expect(canEditCard(PROSPECT), who).toBe(false);
      expect(addCardTask(PROSPECT, { title: "no" }).ok, who).toBe(false);
      expect(addCardNote(PROSPECT, "no").ok, who).toBe(false);
    }
    expect(tasks()).toHaveLength(3);
  });

  it("refuses a card that is not a prospect (a registered person, a customer) or does not exist", () => {
    expect(canEditCard({ board: "recruiting", id: "4" })).toBe(false);
    expect(canEditCard({ board: "recruiting", id: "nobody" })).toBe(false);
    expect(canEditCard({ board: "customer", id: "nobody" })).toBe(false);
  });

  it("covers a customer card for the list's owner and their uplines, not for another branch", () => {
    for (const who of ["4", "2", "1"]) {
      as(who);
      expect(canEditCard(LIST), who).toBe(true);
    }
    as("8");
    expect(canEditCard(LIST)).toBe(false);
    expect(addCardTask(LIST, { title: "no" }).ok).toBe(false);
  });

  it("does not change or tick or delete a task on a card the viewer may not edit", () => {
    const t = (addCardTask(PROSPECT, { title: "Call" }) as { task: { id: string } }).task;
    as("8");
    expect(updateCardTask(t.id, { title: "x" }).ok).toBe(false);
    expect(setTaskDone(t.id, true)).toBeNull();
    expect(removeCardTask(t.id)).toBeNull();
    expect(tasks()).toHaveLength(1);
    expect(tasks()[0]).toMatchObject({ title: "Call", done: false });
  });
});

describe("adding tasks", () => {
  it("puts a new task last and trims its title", () => {
    addCardTask(PROSPECT, { title: "  First " });
    addCardTask(PROSPECT, { title: "Second" });
    addCardTask(LIST, { title: "On the list" });
    expect(tasks().map((t) => [t.title, t.position])).toEqual([
      ["First", 0],
      ["Second", 1],
      ["On the list", 0],
    ]);
    expect(tasks()[0]).toMatchObject({ personId: "9", entryId: null, done: false, createdBy: "1" });
    expect(tasks()[2]).toMatchObject({ personId: null, entryId: "le-test" });
    expect(addCardTask(PROSPECT, { title: "   " })).toMatchObject({ ok: false });
    expect(tasks()).toHaveLength(3);
  });

  it("allows a task for the card's owner or for yourself, nobody else", () => {
    as("1");
    expect(addCardTask(PROSPECT, { title: "owner's", assigneeId: OWNER }).ok).toBe(true);
    expect(addCardTask(PROSPECT, { title: "mine", assigneeId: "1" }).ok).toBe(true);
    expect(addCardTask(PROSPECT, { title: "nobody's", assigneeId: null }).ok).toBe(true);
    expect(addCardTask(PROSPECT, { title: "anita's", assigneeId: "2" })).toMatchObject({
      ok: false,
    });
    expect(tasks()).toHaveLength(3);
  });

  it("keeps a time only with a date", () => {
    const withTime = addCardTask(PROSPECT, { title: "a", dueDate: "2026-11-19", dueTime: "09:00" });
    const noDate = addCardTask(PROSPECT, { title: "b", dueTime: "09:00" });
    expect(withTime.ok && withTime.task).toMatchObject({ dueDate: "2026-11-19", dueTime: "09:00" });
    expect(noDate.ok && noDate.task).toMatchObject({ dueDate: null, dueTime: null });
  });
});

describe("changing a task", () => {
  const make = (over: object = {}) =>
    (addCardTask(PROSPECT, { title: "Call", ...over }) as { task: { id: string } }).task.id;

  it("renames, sets and clears a due date and time (clearing the date clears the time)", () => {
    const id = make();
    expect(updateCardTask(id, { title: "Call Carlos" }).ok).toBe(true);
    expect(updateCardTask(id, { dueDate: "2026-11-19" }).ok).toBe(true);
    expect(updateCardTask(id, { dueTime: "09:30" }).ok).toBe(true);
    expect(tasks()[0]).toMatchObject({
      title: "Call Carlos",
      dueDate: "2026-11-19",
      dueTime: "09:30",
    });
    expect(updateCardTask(id, { dueDate: null }).ok).toBe(true);
    expect(tasks()[0]).toMatchObject({ dueDate: null, dueTime: null });
    // a time cannot be set without a date
    updateCardTask(id, { dueTime: "10:00" });
    expect(tasks()[0]).toMatchObject({ dueDate: null, dueTime: null });
    expect(updateCardTask(id, { title: " " })).toMatchObject({ ok: false });
    expect(updateCardTask(id, { dueDate: "soon" })).toMatchObject({ ok: false });
    expect(tasks()[0].title).toBe("Call Carlos");
  });

  it("assigns to the card's owner or yourself, or to nobody, and refuses anyone else", () => {
    const id = make();
    expect(updateCardTask(id, { assigneeId: OWNER }).ok).toBe(true);
    expect(updateCardTask(id, { assigneeId: "1" }).ok).toBe(true);
    expect(tasks()[0].assigneeId).toBe("1");
    expect(updateCardTask(id, { assigneeId: "2" })).toMatchObject({ ok: false });
    expect(updateCardTask(id, { assigneeId: null }).ok).toBe(true);
    expect(tasks()[0].assigneeId).toBeNull();
  });

  it("undoes a change", () => {
    const id = make({ dueDate: "2026-11-19" });
    const before = tasks()[0];
    const r = updateCardTask(id, { dueDate: "2026-11-25", title: "Renamed" });
    expect(r.ok && (r.undo(), true)).toBe(true);
    expect(tasks()[0]).toEqual(before);
  });

  it("stamps who ticked and when, and clears both when unticked", () => {
    const id = make();
    const undo = setTaskDone(id, true)!;
    expect(tasks()[0]).toMatchObject({ done: true, doneBy: "1" });
    expect(tasks()[0].doneAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(setTaskDone(id, true)).toBeNull(); // already done: nothing to do
    undo();
    expect(tasks()[0]).toMatchObject({ done: false, doneAt: null, doneBy: null });
    setTaskDone(id, true);
    as("2");
    setTaskDone(id, false);
    expect(tasks()[0]).toMatchObject({ done: false, doneAt: null, doneBy: null });
  });
});

describe("deleting a task", () => {
  it("is undone by putting back the same task: same id, same position, same state", () => {
    addCardTask(PROSPECT, { title: "One" });
    const two = addCardTask(PROSPECT, {
      title: "Two",
      dueDate: "2026-11-19",
      dueTime: "09:00",
      assigneeId: OWNER,
    });
    addCardTask(PROSPECT, { title: "Three" });
    if (!two.ok) throw new Error("add failed");
    setTaskDone(two.task.id, true);
    const before = tasks().find((t) => t.id === two.task.id)!;
    const undo = removeCardTask(two.task.id)!;
    expect(tasks().map((t) => t.title)).toEqual(["One", "Three"]);
    undo();
    expect(tasks().find((t) => t.id === two.task.id)).toEqual(before);
    expect(tasks()).toHaveLength(3);
    undo(); // a second Undo adds nothing
    expect(tasks()).toHaveLength(3);
    // the card's order is as before
    const ordered = [...tasks()].sort((a, b) => a.position - b.position).map((t) => t.title);
    expect(ordered).toEqual(["One", "Two", "Three"]);
  });
});

describe("notes", () => {
  it("adds a note as you, now; trims it; keeps the log newest first", () => {
    as("2");
    const a = addCardNote(PROSPECT, "  First note ");
    expect(a.ok && a.note).toMatchObject({ body: "First note", authorId: "2", personId: "9" });
    expect(addCardNote(PROSPECT, "   ")).toMatchObject({ ok: false });
    expect(addCardNote(PROSPECT, "x".repeat(2001))).toMatchObject({ ok: false });
    expect(notes()).toHaveLength(1);
  });

  it("is deleted only by its author, and Undo puts the same note back", () => {
    as("2");
    const r = addCardNote(PROSPECT, "Mine");
    if (!r.ok) throw new Error("add failed");
    as("1");
    // the leader may read it but cannot delete someone else's note
    expect(removeCardNote(r.note.id)).toBeNull();
    expect(notes()).toHaveLength(1);
    as("2");
    const undo = removeCardNote(r.note.id)!;
    expect(notes()).toHaveLength(0);
    undo();
    expect(notes()).toEqual([r.note]);
    undo();
    expect(notes()).toHaveLength(1);
  });

  it("is never edited: there is no update", async () => {
    const mod = await import("./mutations");
    expect(Object.keys(mod).some((k) => /updateCardNote/i.test(k))).toBe(false);
  });
});

describe("when a card's subject goes", () => {
  it("removes their tasks and notes with them and clears them as assignee, ticker and author", () => {
    as("1");
    addCardTask(PROSPECT, { title: "Gone with the prospect" });
    addCardNote(PROSPECT, "Gone too");
    addCardTask(LIST, { title: "Assigned to Jamal", assigneeId: "4" });
    const done = addCardTask(LIST, { title: "Ticked by Jamal" });
    addCardNote(LIST, "Jamal's note");
    as("4");
    if (done.ok) setTaskDone(done.task.id, true);
    addCardNote(LIST, "Written by Jamal");
    const out = followupsWithout(cardTasks(), { personId: "9" });
    expect(out.tasks.map((t) => t.title)).toEqual(["Assigned to Jamal", "Ticked by Jamal"]);
    expect(out.notes.map((n) => n.body)).toEqual(["Jamal's note", "Written by Jamal"]);
    const gone = followupsWithout(cardTasks(), { personId: "4" });
    expect(gone.tasks.find((t) => t.title === "Assigned to Jamal")?.assigneeId).toBeNull();
    expect(gone.tasks.find((t) => t.title === "Ticked by Jamal")).toMatchObject({ doneBy: null });
    expect(gone.notes.find((n) => n.body === "Written by Jamal")?.authorId).toBeNull();
  });

  it("deleting the prospect leaves no orphan task or note", () => {
    addCardTask(PROSPECT, { title: "Orphan?" });
    addCardNote(PROSPECT, "Orphan?");
    addCardTask({ board: "recruiting", id: "5" }, { title: "Another prospect's" });
    removePerson("9");
    expect(tasks().map((t) => t.title)).toEqual(["Another prospect's"]);
    expect(notes()).toHaveLength(0);
  });

  it("removing a list name takes its tasks and notes with it", () => {
    as("4");
    addCardTask(LIST, { title: "On the list" });
    addCardNote(LIST, "A note");
    addCardTask(PROSPECT, { title: "Kept" });
    removeListEntry("le-test");
    expect(tasks().map((t) => t.title)).toEqual(["Kept"]);
    expect(notes()).toHaveLength(0);
    removeCardFollowups({ entryId: "nothing" });
    expect(tasks()).toHaveLength(1);
  });
});
