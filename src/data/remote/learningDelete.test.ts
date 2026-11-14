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
// The hosted data source: progress is restored with a delete and a fresh insert.
vi.mock("@/lib/supabase", () => ({ supabase: null }));
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<object>()), IS_SUPABASE: true }));

import { DEMO_USERS, useSessionStore } from "@/stores/sessionStore";
import { useCrmStore, type Learning } from "@/stores/crmStore";
import { deleteLearning, restoreLearning } from "@/data/crm";
import { deleteLearningEntry, libraryLearningId } from "@/data/library/mutations";
import { library, useLibraryStore } from "@/data/library/store";
import type { LibraryProgress } from "@/data/library/types";
import { replaceStore, startEngine, stopEngine, whenIdle, type Binding, type Row } from "./engine";
import { crmBinding, libraryBinding } from "./bindings";

type Call = { table: string; kind: string; rows?: Row[]; ids?: unknown };

/** A stand-in for the supabase-js query builder that records calls. */
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
      update() {
        call.kind = "update";
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

const ME = "1";
const LIB_ID = libraryLearningId(ME, "talk");
const row = (over: Partial<Learning> = {}): Learning => ({
  id: "L1",
  personId: ME,
  kind: "pages",
  title: "Old",
  amount: 20,
  unit: "pages",
  date: "2026-11-01",
  createdAt: "2026-11-01T09:00:00.000Z",
  ...over,
});
const finished = (over: Partial<LibraryProgress> = {}): LibraryProgress => ({
  personId: ME,
  itemId: "talk",
  positionSec: 0,
  completedAt: "2026-11-03T10:00:00.000Z",
  loggedAt: "2026-11-03T10:00:00.000Z",
  updatedAt: "2026-11-03T10:00:00.000Z",
  ...over,
});

async function setup(entries: Learning[], progress: LibraryProgress[] = []) {
  useSessionStore.setState({ user: DEMO_USERS.find((u) => u.personId === ME)! });
  const fake = fakeClient();
  startEngine({ client: fake.client, me: ME, myName: "Maria" }, [
    crmBinding as unknown as Binding<unknown>,
    libraryBinding as unknown as Binding<unknown>,
  ]);
  // The rows as the server has them (the baseline), then wait for any writes to settle.
  replaceStore(crmBinding, { learning: entries });
  replaceStore(libraryBinding, { items: [], topics: [], channels: [], progress });
  await whenIdle();
  fake.calls.length = 0;
  return fake;
}

const sent = (calls: Call[]) =>
  calls.map(
    (c) => `${c.kind} ${c.table} ${JSON.stringify(c.ids ?? c.rows?.map((r) => r.id ?? r.item_id))}`,
  );

afterEach(() => {
  stopEngine();
  useCrmStore.setState({ learning: [] });
  useLibraryStore.setState({ progress: [] });
});

describe("deleting a learning entry reaches the database as one delete", () => {
  it("sends one DELETE of that id (no insert, no update); the undo sends one INSERT of the same id and values", async () => {
    const { calls } = await setup([row(), row({ id: "L2", title: "Untouched" })]);
    const original = useCrmStore.getState().learning[0];

    const removed = deleteLearning("L1")!;
    await whenIdle();
    expect(calls).toEqual([{ table: "learning", kind: "delete", ids: ["L1"] }]);
    expect(useCrmStore.getState().learning).toHaveLength(1);

    calls.length = 0;
    expect(restoreLearning(removed)).toBe(true);
    await whenIdle();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "learning", kind: "insert" });
    expect(calls[0].rows).toEqual([
      {
        id: "L1",
        person_id: ME,
        kind: "pages",
        title: "Old",
        amount: 20,
        unit: "pages",
        date: "2026-11-01",
        created_at: "2026-11-01T09:00:00.000Z",
      },
    ]);
    expect(useCrmStore.getState().learning).toHaveLength(2);
    expect(useCrmStore.getState().learning[0]).toEqual(original);
  });

  it("a delete and its undo before anything was sent write nothing", async () => {
    const { calls } = await setup([row()]);
    const removed = deleteLearning("L1")!;
    restoreLearning(removed);
    await whenIdle();
    expect(calls).toEqual([]);
  });
});

describe("a library-linked entry", () => {
  it("delete: one DELETE of the entry, the progress row deleted and written back unfinished (so the database's log mark is cleared); no learning insert", async () => {
    const { calls } = await setup(
      [row({ id: LIB_ID, title: "Talk" })],
      [finished({ positionSec: 120 })],
    );
    deleteLearningEntry(LIB_ID);
    await whenIdle();
    expect(sent(calls).sort()).toEqual(
      [
        `delete learning ${JSON.stringify([LIB_ID])}`,
        `delete library_progress ${JSON.stringify([{ person_id: ME, item_id: "talk" }])}`,
        `upsert library_progress ${JSON.stringify(["talk"])}`,
      ].sort(),
    );
    const insert = calls.find((c) => c.kind === "upsert")!;
    expect(insert.rows![0]).toMatchObject({
      item_id: "talk",
      position_sec: 120,
      completed_at: null,
    });
    // The insert comes after the delete of the same row.
    expect(
      calls.findIndex((c) => c.table === "library_progress" && c.kind === "delete"),
    ).toBeLessThan(calls.indexOf(insert));
    expect(calls.filter((c) => c.table === "learning")).toHaveLength(1);
  });

  it("undo: the entry is inserted first with the same id and values, then the progress row comes back finished; the database's own log then finds the entry (one row)", async () => {
    const entry = row({ id: LIB_ID, title: "Talk", amount: 45, unit: "minutes" });
    const { calls } = await setup([entry], [finished()]);
    const removed = deleteLearningEntry(LIB_ID)!;
    await whenIdle();
    expect(library().progress).toHaveLength(0); // position 0: nothing is left of it
    calls.length = 0;

    removed.undo();
    await whenIdle();
    const learningWrites = calls.filter((c) => c.table === "learning");
    expect(learningWrites).toHaveLength(1);
    expect(learningWrites[0].kind).toBe("insert");
    expect(learningWrites[0].rows![0]).toMatchObject({
      id: LIB_ID,
      amount: 45,
      unit: "minutes",
      created_at: entry.createdAt,
    });
    const progressWrite = calls.find((c) => c.table === "library_progress")!;
    expect(progressWrite.kind).toBe("upsert");
    expect(progressWrite.rows![0]).toMatchObject({ item_id: "talk" });
    expect(progressWrite.rows![0].completed_at).toBeTruthy();
    expect(calls.indexOf(learningWrites[0])).toBeLessThan(calls.indexOf(progressWrite));
    expect(useCrmStore.getState().learning).toEqual([entry]);
    expect(library().progress).toEqual([finished()]);
  });

  it("an ordinary entry sends nothing to the library", async () => {
    const { calls } = await setup([row()], [finished()]);
    deleteLearningEntry("L1");
    await whenIdle();
    expect(calls.map((c) => c.table)).toEqual(["learning"]);
  });
});
