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
import { DEMO_USERS, useSessionStore } from "@/stores/sessionStore";
import { useCrmStore, type Learning } from "@/stores/crmStore";
import { updateLearning } from "@/data/crm";
import { replaceStore, startEngine, stopEngine, whenIdle, type Binding, type Row } from "./engine";
import { crmBinding } from "./bindings";

type Call = { table: string; kind: string; rows?: Row[]; changes?: Row; ids?: unknown };

/**
 * A stand-in for the supabase-js query builder that records calls (an update
 * of one id is `.update(changes).in("id", [id])`, so `ids` holds that id).
 */
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
      update(changes: Row) {
        Object.assign(call, { kind: "update", changes });
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

async function setup(entries: Learning[]) {
  useSessionStore.setState({ user: DEMO_USERS.find((u) => u.personId === ME)! });
  const fake = fakeClient();
  startEngine({ client: fake.client, me: ME, myName: "Maria" }, [
    crmBinding as unknown as Binding<unknown>,
  ]);
  // The rows as the server has them (the baseline), then wait for any writes to settle.
  replaceStore(crmBinding, { learning: entries });
  await whenIdle();
  fake.calls.length = 0;
  return fake;
}

afterEach(() => {
  stopEngine();
  useCrmStore.setState({ learning: [] });
});

describe("editing a learning entry reaches the database as an update", () => {
  it("sends one UPDATE of the same id with only the changed columns (no insert, no delete)", async () => {
    const { calls } = await setup([row(), row({ id: "L2", title: "Untouched" })]);
    updateLearning("L1", {
      kind: "pages",
      title: "New",
      amount: 45,
      unit: "minutes",
      date: "2026-11-05",
    });
    await whenIdle();
    expect(calls).toEqual([
      {
        table: "learning",
        kind: "update",
        changes: { title: "New", amount: 45, unit: "minutes", date: "2026-11-05" },
        ids: ["L1"],
      },
    ]);
    expect(useCrmStore.getState().learning).toHaveLength(2);
  });

  it("a kind change that drops the unit is one update setting unit to null", async () => {
    const { calls } = await setup([row()]);
    updateLearning("L1", { kind: "workshop", title: "Old", amount: 1, date: "2026-11-01" });
    await whenIdle();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      kind: "update",
      changes: { kind: "workshop", amount: 1, unit: null },
      ids: ["L1"],
    });
  });

  it("undoing the edit sends the earlier values back to the same row", async () => {
    const { calls } = await setup([row()]);
    const prev = updateLearning("L1", {
      kind: "pages",
      title: "New",
      amount: 45,
      unit: "minutes",
      date: "2026-11-05",
    })!;
    await whenIdle();
    updateLearning(prev.id, { ...prev });
    await whenIdle();
    expect(calls.map((c) => `${c.kind} ${c.table} ${JSON.stringify(c.ids)}`)).toEqual([
      'update learning ["L1"]',
      'update learning ["L1"]',
    ]);
    expect(calls[1].changes).toEqual({
      title: "Old",
      amount: 20,
      unit: "pages",
      date: "2026-11-01",
    });
  });

  it("saving without a change writes nothing", async () => {
    const { calls } = await setup([row()]);
    updateLearning("L1", {
      kind: "pages",
      title: "Old",
      amount: 20,
      unit: "pages",
      date: "2026-11-01",
    });
    await whenIdle();
    expect(calls).toHaveLength(0);
  });
});
