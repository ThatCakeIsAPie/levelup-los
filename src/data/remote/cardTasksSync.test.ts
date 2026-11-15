import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
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
// The hosted data source: every change reaches the database through the sync engine.
vi.mock("@/lib/supabase", () => ({ supabase: null }));
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<object>()), IS_SUPABASE: true }));

import { usePeopleStore } from "@/stores/peopleStore";
import { DEMO_USERS, useSessionStore } from "@/stores/sessionStore";
import { seedPeople } from "@/data/seed";
import { useCustomerPipelineStore } from "@/data/customerPipeline/store";
import { removeListEntry } from "@/data/customerPipeline/mutations";
import { useCardTasksStore } from "@/data/cardTasks/store";
import {
  addCardNote,
  addCardTask,
  removeCardNote,
  removeCardTask,
  setTaskDone,
  updateCardTask,
} from "@/data/cardTasks/mutations";
import type { CardTask } from "@/data/cardTasks/types";
import { replaceStore, startEngine, stopEngine, whenIdle, type Binding, type Row } from "./engine";
import { cardTasksBinding, customerPipelineBinding } from "./bindings";

type Call = { table: string; kind: string; rows?: Row[]; patch?: Row; ids?: unknown };

/** A stand-in for the supabase-js query builder that records what is sent. */
function fakeClient() {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, kind: "" };
    const builder = {
      insert(rows: Row[]) {
        Object.assign(call, { kind: "insert", rows });
        return builder;
      },
      upsert(rows: Row[]) {
        Object.assign(call, { kind: "upsert", rows });
        return builder;
      },
      update(patch: Row) {
        Object.assign(call, { kind: "update", patch });
        return builder;
      },
      delete() {
        call.kind = "delete";
        return builder;
      },
      in(_col: string, ids: unknown[]) {
        call.ids = ids;
        return builder;
      },
      match(m: Row) {
        call.ids = [m];
        return builder;
      },
      eq(_c: string, v: unknown) {
        call.ids = [v];
        return builder;
      },
      select() {
        return builder;
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        calls.push(call);
        const data = ((call.ids as unknown[]) ?? []).map((id) => ({ id }));
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

const ME = "1"; // the leader: sees every card
const PROSPECT = { board: "recruiting" as const, id: "9" }; // Jamal's (4) prospect
const SERVER_ONLY = [
  "done_at",
  "done_by",
  "created_by",
  "created_at",
  "updated_at",
  "author_id",
  "workspace_id",
];

async function setup(tasks: CardTask[] = []) {
  usePeopleStore.setState({ people: seedPeople() });
  useSessionStore.setState({ user: DEMO_USERS.find((u) => u.personId === ME)! });
  const fake = fakeClient();
  startEngine({ client: fake.client, me: ME, myName: "Maria" }, [
    cardTasksBinding as unknown as Binding<unknown>,
    customerPipelineBinding as unknown as Binding<unknown>,
  ]);
  // The rows as the server has them (the baseline), then wait for any writes to settle.
  replaceStore(cardTasksBinding, { tasks, notes: [] });
  replaceStore(customerPipelineBinding, {
    entries: [],
    steps: [],
    hides: [],
    cards: [],
    moves: [],
  });
  await whenIdle();
  fake.calls.length = 0;
  return fake;
}

afterEach(() => {
  stopEngine();
  useCardTasksStore.setState({ tasks: [], notes: [] });
  useCustomerPipelineStore.setState({ entries: [], steps: [], hides: [], cards: [], moves: [] });
});

describe("card tasks reach the database as exactly one write per action", () => {
  it("adding a task is one INSERT with the client's columns only", async () => {
    const { calls } = await setup();
    const r = addCardTask(PROSPECT, {
      title: "Call Carlos",
      dueDate: "2026-11-19",
      dueTime: "09:00",
    });
    await whenIdle();
    if (!r.ok) throw new Error("add failed");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "card_tasks", kind: "insert" });
    const sent = calls[0].rows!;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      id: r.task.id,
      person_id: "9",
      entry_id: null,
      title: "Call Carlos",
      done: false,
      due_date: "2026-11-19",
      due_time: "09:00",
      assignee_id: null,
      position: 0,
    });
    // the database stamps these and chooses the team: they are never sent
    for (const col of SERVER_ONLY) expect(sent[0]).not.toHaveProperty(col);
  });

  it("ticking, renaming, setting the date and assigning are one UPDATE each, of only what changed", async () => {
    const { calls } = await setup();
    const r = addCardTask(PROSPECT, { title: "Call" });
    await whenIdle();
    if (!r.ok) throw new Error("add failed");
    const id = r.task.id;
    const steps: [string, () => unknown, Row][] = [
      ["tick", () => setTaskDone(id, true), { done: true }],
      ["untick", () => setTaskDone(id, false), { done: false }],
      ["rename", () => updateCardTask(id, { title: "Call Carlos" }), { title: "Call Carlos" }],
      ["date", () => updateCardTask(id, { dueDate: "2026-11-19" }), { due_date: "2026-11-19" }],
      ["time", () => updateCardTask(id, { dueTime: "09:00" }), { due_time: "09:00" }],
      ["assign", () => updateCardTask(id, { assigneeId: "4" }), { assignee_id: "4" }],
      [
        "clear the date",
        () => updateCardTask(id, { dueDate: null }),
        { due_date: null, due_time: null },
      ],
    ];
    for (const [what, act, patch] of steps) {
      calls.length = 0;
      act();
      await whenIdle();
      expect(calls, what).toHaveLength(1);
      expect(calls[0], what).toMatchObject({
        table: "card_tasks",
        kind: "update",
        ids: [id],
        patch,
      });
      for (const col of SERVER_ONLY) expect(calls[0].patch, what).not.toHaveProperty(col);
    }
  });

  it("deleting is one DELETE of that id; the undo is one INSERT of the same id, position and values", async () => {
    const { calls } = await setup();
    addCardTask(PROSPECT, { title: "One" });
    const two = addCardTask(PROSPECT, { title: "Two", dueDate: "2026-11-19" });
    addCardTask(PROSPECT, { title: "Three" });
    await whenIdle();
    if (!two.ok) throw new Error("add failed");
    calls.length = 0;
    const undo = removeCardTask(two.task.id)!;
    await whenIdle();
    expect(calls).toEqual([{ table: "card_tasks", kind: "delete", ids: [two.task.id] }]);
    calls.length = 0;
    undo();
    await whenIdle();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "card_tasks", kind: "insert" });
    expect(calls[0].rows).toHaveLength(1);
    expect(calls[0].rows![0]).toMatchObject({
      id: two.task.id,
      title: "Two",
      position: 1,
      due_date: "2026-11-19",
    });
  });

  it("a note is one INSERT (never an update), its delete one DELETE, its undo one INSERT", async () => {
    const { calls } = await setup();
    const r = addCardNote(PROSPECT, "Met at the gym");
    await whenIdle();
    if (!r.ok) throw new Error("add failed");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "card_notes", kind: "insert" });
    expect(calls[0].rows![0]).toMatchObject({
      id: r.note.id,
      person_id: "9",
      body: "Met at the gym",
    });
    for (const col of SERVER_ONLY) expect(calls[0].rows![0]).not.toHaveProperty(col);
    calls.length = 0;
    const undo = removeCardNote(r.note.id)!;
    await whenIdle();
    expect(calls).toEqual([{ table: "card_notes", kind: "delete", ids: [r.note.id] }]);
    calls.length = 0;
    undo();
    await whenIdle();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "card_notes", kind: "insert" });
    expect(calls[0].rows![0]).toMatchObject({ id: r.note.id, body: "Met at the gym" });
  });

  it("removing a list name sends only the name's delete: the database cascades its tasks and notes", async () => {
    const { calls } = await setup();
    useCustomerPipelineStore.setState({
      entries: [
        {
          id: "le-1",
          ownerId: "1",
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
          addedBy: "1",
          createdAt: "2026-11-01T10:00:00.000Z",
          updatedAt: "2026-11-01T10:00:00.000Z",
        },
      ],
    });
    addCardTask({ board: "customer", id: "le-1" }, { title: "On the list" });
    addCardNote({ board: "customer", id: "le-1" }, "A note");
    await whenIdle();
    calls.length = 0;
    removeListEntry("le-1");
    await whenIdle();
    expect(useCardTasksStore.getState().tasks).toHaveLength(0);
    expect(useCardTasksStore.getState().notes).toHaveLength(0);
    expect(calls).toEqual([{ table: "list_entries", kind: "delete", ids: ["le-1"] }]);
  });
});
