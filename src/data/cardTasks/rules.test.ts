import { describe, expect, it } from "vitest";
import {
  EMPTY_SUMMARY,
  assigneeChoices,
  canAssign,
  canDeleteNote,
  cleanBody,
  cleanDue,
  cleanTitle,
  dueTasksFor,
  isBlank,
  nextTaskPosition,
  notesOf,
  summarize,
  summarizeAll,
  taskDueState,
  tasksOf,
  zonedNow,
} from "./rules";
import type { CardNote, CardRef, CardTask } from "./types";

const task = (id: string, over: Partial<CardTask> = {}): CardTask => ({
  id,
  personId: "p1",
  entryId: null,
  title: `Task ${id}`,
  done: false,
  doneAt: null,
  doneBy: null,
  dueDate: null,
  dueTime: null,
  assigneeId: null,
  position: 0,
  createdBy: "owner",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...over,
});
const note = (id: string, createdAt: string, over: Partial<CardNote> = {}): CardNote => ({
  id,
  personId: "p1",
  entryId: null,
  authorId: "owner",
  body: `Note ${id}`,
  createdAt,
  ...over,
});
const card: CardRef = { board: "recruiting", id: "p1" };
const CHI = "America/Chicago";
const at = (iso: string) => new Date(iso);

describe("a card's tasks and notes in order", () => {
  it("orders tasks by position, oldest first on a tie, and keeps done ones in place", () => {
    const list = [
      task("c", { position: 2 }),
      task("a", { position: 0, done: true }),
      task("b", { position: 1 }),
      task("other", { personId: "p2" }),
      task("e", { personId: null, entryId: "e1" }),
    ];
    expect(tasksOf(list, card).map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(tasksOf(list, { board: "customer", id: "e1" }).map((t) => t.id)).toEqual(["e"]);
    expect(nextTaskPosition(list, card)).toBe(3);
    expect(nextTaskPosition([], card)).toBe(0);
  });

  it("lists notes newest first", () => {
    const list = [
      note("old", "2026-11-01T10:00:00.000Z"),
      note("new", "2026-11-03T10:00:00.000Z"),
      note("mid", "2026-11-02T10:00:00.000Z"),
    ];
    expect(notesOf(list, card).map((n) => n.id)).toEqual(["new", "mid", "old"]);
  });
});

describe("what may be written", () => {
  it("trims a title and refuses an empty or over-long one", () => {
    expect(cleanTitle("  Call back ")).toBe("Call back");
    expect(cleanTitle("   ")).toBeNull();
    expect(cleanTitle("x".repeat(201))).toBeNull();
    expect(cleanTitle("x".repeat(200))).toHaveLength(200);
    expect(cleanBody("  hi \n")).toBe("hi");
    expect(cleanBody("x".repeat(2001))).toBeNull();
  });

  it("needs a date for a time, and drops a bad value", () => {
    expect(cleanDue("2026-11-19", "09:00:00")).toEqual({ dueDate: "2026-11-19", dueTime: "09:00" });
    expect(cleanDue(null, "09:00")).toEqual({ dueDate: null, dueTime: null });
    expect(cleanDue("2026-11-19", "25:00")).toEqual({ dueDate: "2026-11-19", dueTime: null });
    expect(cleanDue("2026-13-45", "09:00")).toEqual({ dueDate: null, dueTime: null });
  });

  it("offers at most two people to assign to: the card's owner and you", () => {
    expect(assigneeChoices("owner", "me")).toEqual(["owner", "me"]);
    expect(assigneeChoices("me", "me")).toEqual(["me"]);
    expect(assigneeChoices(null, "me")).toEqual(["me"]);
    expect(canAssign(null, "owner", "me")).toBe(true);
    expect(canAssign("owner", "owner", "me")).toBe(true);
    expect(canAssign("me", "owner", "me")).toBe(true);
    expect(canAssign("someone-else", "owner", "me")).toBe(false);
  });

  it("lets only the author delete a note", () => {
    expect(canDeleteNote({ authorId: "me" }, "me")).toBe(true);
    expect(canDeleteNote({ authorId: "other" }, "me")).toBe(false);
    expect(canDeleteNote({ authorId: null }, "me")).toBe(false);
  });
});

describe("a due date in the team's time zone", () => {
  it("reads the team's date and clock, not the machine's", () => {
    // 05:30 UTC on the 15th is 23:30 on the 14th in Chicago (CST, UTC-6).
    expect(zonedNow(at("2026-11-15T05:30:00Z"), CHI)).toEqual({
      date: "2026-11-14",
      time: "23:30:00",
    });
    expect(zonedNow(at("2026-11-15T06:00:00Z"), CHI)).toEqual({
      date: "2026-11-15",
      time: "00:00:00",
    });
    expect(zonedNow(at("2026-11-15T06:00:00Z"), "UTC")).toEqual({
      date: "2026-11-15",
      time: "06:00:00",
    });
  });

  it("is overdue across the team's midnight, not UTC's", () => {
    const due = { date: "2026-11-14", time: null };
    // Still the 14th in Chicago although it is the 15th in UTC: due today, not overdue.
    expect(taskDueState(due, at("2026-11-15T05:30:00Z"), CHI)).toBe("today");
    expect(taskDueState(due, at("2026-11-15T05:59:59Z"), CHI)).toBe("today");
    // Chicago's midnight passes: overdue.
    expect(taskDueState(due, at("2026-11-15T06:00:01Z"), CHI)).toBe("overdue");
    expect(taskDueState(due, at("2026-11-14T12:00:00Z"), CHI)).toBe("today");
    expect(taskDueState(due, at("2026-11-13T12:00:00Z"), CHI)).toBe("later");
    // The same instant in a zone ahead of UTC is already the next day there.
    expect(taskDueState(due, at("2026-11-14T20:00:00Z"), "Pacific/Auckland")).toBe("overdue");
  });

  it("is overdue once the time has passed on the day (the database's rule)", () => {
    const due = { date: "2026-11-14", time: "09:00" };
    expect(taskDueState(due, at("2026-11-14T14:59:00Z"), CHI)).toBe("today"); // 08:59 CST
    expect(taskDueState(due, at("2026-11-14T15:01:00Z"), CHI)).toBe("overdue"); // 09:01 CST
  });
});

describe("summarize", () => {
  const now = at("2026-11-14T18:00:00Z"); // noon on the 14th in Chicago
  const opts = { now, timeZone: CHI, ownerId: "owner" };

  it("is empty for a card with nothing on it", () => {
    expect(summarize([], [], opts)).toEqual({ ...EMPTY_SUMMARY });
    expect(isBlank(summarize([], [], opts))).toBe(true);
  });

  it("counts done and total, and notes", () => {
    const s = summarize(
      [task("a", { done: true }), task("b"), task("c"), task("d", { done: true })],
      [note("n", "2026-11-02T10:00:00.000Z")],
      opts,
    );
    expect([s.done, s.total, s.notes]).toEqual([2, 4, 1]);
    expect(isBlank(s)).toBe(false);
    expect(isBlank(summarize([], [note("n", "2026-11-02T10:00:00.000Z")], opts))).toBe(false);
  });

  it("takes the earliest due date among the OPEN tasks only", () => {
    const s = summarize(
      [
        task("done", { done: true, dueDate: "2026-11-01" }),
        task("later", { dueDate: "2026-11-20" }),
        task("soon", { dueDate: "2026-11-16", dueTime: "09:00" }),
        task("none"),
      ],
      [],
      opts,
    );
    expect(s.due).toEqual({ date: "2026-11-16", time: "09:00", state: "later" });
  });

  it("puts a day's timed tasks before the same day's task with no time", () => {
    const s = summarize(
      [
        task("a", { dueDate: "2026-11-16" }),
        task("b", { dueDate: "2026-11-16", dueTime: "17:30" }),
      ],
      [],
      opts,
    );
    expect(s.due).toMatchObject({ date: "2026-11-16", time: "17:30" });
  });

  it("has no due date when no open task has one", () => {
    expect(
      summarize([task("a"), task("b", { done: true, dueDate: "2026-11-20" })], [], opts).due,
    ).toBeNull();
  });

  it("says overdue and today the way the database does", () => {
    expect(summarize([task("a", { dueDate: "2026-11-13" })], [], opts).due?.state).toBe("overdue");
    expect(summarize([task("a", { dueDate: "2026-11-14" })], [], opts).due?.state).toBe("today");
    expect(
      summarize([task("a", { dueDate: "2026-11-14", dueTime: "08:00" })], [], opts).due?.state,
    ).toBe("overdue");
    expect(
      summarize([task("a", { dueDate: "2026-11-14", dueTime: "13:00" })], [], opts).due?.state,
    ).toBe("today");
  });

  it("flips from today to overdue across the team's midnight", () => {
    const t = [task("a", { dueDate: "2026-11-14" })];
    const before = summarize(t, [], { now: at("2026-11-15T05:59:00Z"), timeZone: CHI });
    const after = summarize(t, [], { now: at("2026-11-15T06:00:30Z"), timeZone: CHI });
    expect([before.due?.state, after.due?.state]).toEqual(["today", "overdue"]);
  });

  it("lists who the open tasks are for: the owner for a task with no assignee", () => {
    const s = summarize(
      [
        task("a", { assigneeId: "me", position: 0 }),
        task("b", { position: 1 }),
        task("c", { assigneeId: "me", position: 2 }),
        task("d", { assigneeId: "gone", done: true, position: 3 }),
      ],
      [],
      opts,
    );
    expect(s.assigneeIds).toEqual(["me", "owner"]);
    expect(summarize([task("a")], [], { now, timeZone: CHI }).assigneeIds).toEqual([]);
  });

  it("summarizes every card that has anything, by card", () => {
    const all = summarizeAll(
      [task("a", { personId: "p1" }), task("b", { personId: null, entryId: "e1", done: true })],
      [note("n", "2026-11-02T10:00:00.000Z", { personId: "p2" })],
      { now, timeZone: CHI, ownerOf: (r) => (r.board === "customer" ? "lister" : "owner") },
    );
    expect([...all.keys()].sort()).toEqual(["customer:e1", "recruiting:p1", "recruiting:p2"]);
    expect(all.get("customer:e1")).toMatchObject({ done: 1, total: 1 });
    expect(all.get("recruiting:p2")).toMatchObject({ total: 0, notes: 1 });
    expect(all.get("recruiting:p1")?.assigneeIds).toEqual(["owner"]);
  });
});

describe("tasks due for Home", () => {
  const now = at("2026-11-14T18:00:00Z");
  const cards = new Map([
    ["recruiting:p1", { ownerId: "me", name: "Pat One" }],
    ["recruiting:p2", { ownerId: "boss", name: "Pat Two" }],
    ["customer:e1", { ownerId: "me", name: "Lee List", customerId: "c9" }],
  ]);
  const run = (tasks: CardTask[]) => dueTasksFor(tasks, "me", cards, { now, timeZone: CHI });

  it("takes open tasks due today or overdue that are the viewer's: assigned to them, or unassigned on their card", () => {
    const got = run([
      task("mine", { dueDate: "2026-11-14", assigneeId: "me", personId: "p2" }),
      task("unassigned-own-card", { dueDate: "2026-11-13", dueTime: "10:00" }),
      task("unassigned-other-card", { dueDate: "2026-11-14", personId: "p2" }),
      task("assigned-elsewhere", { dueDate: "2026-11-14", assigneeId: "boss" }),
      task("done", { dueDate: "2026-11-14", done: true }),
      task("later", { dueDate: "2026-11-15" }),
      task("undated"),
      task("gone-card", { dueDate: "2026-11-14", personId: "p9" }),
      task("customer", { dueDate: "2026-11-14", personId: null, entryId: "e1" }),
    ]);
    expect(got.map((t) => t.taskId)).toEqual(["unassigned-own-card", "customer", "mine"]);
    expect(got.find((t) => t.taskId === "unassigned-own-card")).toMatchObject({
      state: "overdue",
      daysLate: 1,
      name: "Pat One",
    });
    expect(got.find((t) => t.taskId === "mine")).toMatchObject({ state: "today", daysLate: 0 });
    expect(got.find((t) => t.taskId === "customer")).toMatchObject({
      board: "customer",
      customerId: "c9",
    });
  });

  it("counts a task due at a time that has passed today as overdue with no days late", () => {
    const [t] = run([task("a", { dueDate: "2026-11-14", dueTime: "08:00" })]);
    expect(t).toMatchObject({ state: "overdue", daysLate: 0 });
  });
});
