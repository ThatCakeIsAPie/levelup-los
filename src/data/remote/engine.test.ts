import { afterEach, describe, expect, it } from "vitest";
import { create } from "zustand";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyRemote,
  flush,
  onWriteError,
  replaceStore,
  serverSide,
  startEngine,
  stopEngine,
  suppressed,
  whenIdle,
  type Binding,
  type Row,
  type TableSpec,
} from "./engine";

// A toy store with a parent table (events) and a child table (attendances).
interface Toy {
  events: { id: string; name: string }[];
  attendances: { id: string; event_id: string }[];
}
const useToy = create<Toy>()(() => ({ events: [], attendances: [] }));

function spec<K extends keyof Toy>(table: string, key: K): TableSpec<Toy> {
  return {
    table,
    pk: ["id"],
    rows: (s) => s[key] as unknown as Row[],
    normalize: (r) => ({ ...r }),
    apply: (s, ups, dels) => {
      const gone = new Set(dels.map((d) => d.id));
      const list = (s[key] as unknown as Row[]).filter((r) => !gone.has(r.id));
      for (const u of ups) {
        const i = list.findIndex((r) => r.id === u.id);
        if (i === -1) list.push(u);
        else list[i] = u;
      }
      return { [key]: list } as Partial<Toy>;
    },
  };
}
const binding: Binding<Toy> = {
  name: "toy",
  store: useToy,
  specs: [spec("events", "events"), spec("attendances", "attendances")],
};

type Call = { table: string; kind: string; rows?: Row[]; changes?: Row; ids?: unknown };

/** A stand-in for the supabase-js query builder that records calls. */
function fakeClient(fail: (c: Call) => boolean = () => false) {
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
        const error = fail(call) ? { message: "not allowed", code: "42501" } : null;
        const data = error ? null : ((call.ids as unknown[]) ?? []).map((id) => ({ id }));
        return Promise.resolve({ data, error }).then(res, rej);
      },
    };
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

function start(fail?: (c: Call) => boolean) {
  const fake = fakeClient(fail);
  startEngine({ client: fake.client, me: "1", myName: "Maria" }, [
    binding as unknown as Binding<unknown>,
  ]);
  return fake;
}

afterEach(() => {
  stopEngine();
  useToy.setState({ events: [], attendances: [] });
});

describe("sync engine", () => {
  it("writes parents before children and deletes children first", async () => {
    const { calls } = start();
    useToy.setState({
      events: [{ id: "e1", name: "Meeting" }],
      attendances: [{ id: "a1", event_id: "e1" }],
    });
    await whenIdle();
    expect(calls.map((c) => `${c.kind} ${c.table}`)).toEqual([
      "insert events",
      "insert attendances",
    ]);

    calls.length = 0;
    useToy.setState({ events: [{ id: "e1", name: "Team meeting" }], attendances: [] });
    await whenIdle();
    expect(calls.map((c) => `${c.kind} ${c.table}`)).toEqual([
      "update events",
      "delete attendances",
    ]);
    expect(calls[0].changes).toEqual({ name: "Team meeting" }); // only what changed
  });

  it("rolls back a refused write and reports it", async () => {
    const errors: unknown[] = [];
    onWriteError((e) => errors.push(e));
    start((c) => c.kind === "update");
    useToy.setState({ events: [{ id: "e1", name: "Meeting" }] });
    await whenIdle();
    useToy.setState({ events: [{ id: "e1", name: "Renamed" }] });
    expect(useToy.getState().events[0].name).toBe("Renamed"); // optimistic
    await whenIdle();
    expect(useToy.getState().events[0].name).toBe("Meeting");
    expect(errors).toHaveLength(1);
  });

  it("merges server changes without writing them back", async () => {
    const { calls } = start();
    applyRemote("events", [{ id: "e9", name: "From the server" }]);
    serverSide(() => useToy.setState({ attendances: [{ id: "a9", event_id: "e9" }] }));
    await whenIdle();
    expect(useToy.getState().events).toEqual([{ id: "e9", name: "From the server" }]);
    expect(calls).toHaveLength(0);
    applyRemote("events", [], [{ id: "e9" }]);
    expect(useToy.getState().events).toEqual([]);
    await whenIdle();
    expect(calls).toHaveLength(0);
  });

  it("does nothing once stopped", async () => {
    const { calls } = start();
    stopEngine();
    useToy.setState({ events: [{ id: "e2", name: "Offline" }] });
    await whenIdle();
    expect(calls).toHaveLength(0);
  });
});

const three = () => [
  { id: "e1", name: "One" },
  { id: "e2", name: "Two" },
  { id: "e3", name: "Three" },
];

describe("sync engine: deletes", () => {
  it("deletes only the rows a local change removed", async () => {
    const { calls } = start();
    replaceStore(binding, { events: three() });
    useToy.setState((s) => ({ events: s.events.filter((e) => e.id !== "e2") }));
    await whenIdle();
    expect(calls.map((c) => `${c.kind} ${c.table} ${JSON.stringify(c.ids)}`)).toEqual([
      'delete events ["e2"]',
    ]);
  });

  it("never deletes rows that left the store without a local change", async () => {
    const { calls } = start();
    replaceStore(binding, { events: three() });
    // E.g. a partial reload or another copy of the data layer replacing the store.
    suppressed(() => useToy.setState({ events: [{ id: "e1", name: "One" }] }));
    useToy.setState({ events: [{ id: "e1", name: "Renamed" }] });
    await whenIdle();
    expect(calls.map((c) => `${c.kind} ${c.table}`)).toEqual(["update events"]);
  });

  it("an emptied table is a reset, not deletes", async () => {
    const { calls } = start();
    replaceStore(binding, { events: three(), attendances: [{ id: "a1", event_id: "e1" }] });
    useToy.setState({ events: [], attendances: [] });
    await whenIdle();
    // One row removed on its own is still a delete; a whole table at once never.
    expect(calls.map((c) => `${c.kind} ${c.table}`)).toEqual(["delete attendances"]);
  });

  it("a server copy of a row being deleted doesn't bring it back", async () => {
    start();
    replaceStore(binding, { events: three() });
    useToy.setState((s) => ({ events: s.events.filter((e) => e.id !== "e3") }));
    flush();
    applyRemote("events", [{ id: "e3", name: "Three" }]);
    await whenIdle();
    expect(useToy.getState().events.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("a second copy of the engine (dev hot update) stops the first", async () => {
    const first = start();
    replaceStore(binding, { events: three() });
    // What a hot update does: the module runs again while the stores stay.
    const again = "./engine?copy"; // (a variable: TypeScript can't resolve the query)
    const copy = (await import(/* @vite-ignore */ again)) as typeof import("./engine");
    expect(copy.startEngine).not.toBe(startEngine); // really a second copy
    const second = fakeClient();
    copy.startEngine({ client: second.client, me: "20", myName: "Beau" }, [
      binding as unknown as Binding<unknown>,
    ]);
    // The new copy signs someone else in: empties and reloads the stores.
    copy.suppressed(() => useToy.setState({ events: [], attendances: [] }));
    copy.replaceStore(binding, { events: [{ id: "e9", name: "Theirs" }] });
    useToy.setState({ events: [{ id: "e9", name: "Theirs, renamed" }] });
    await copy.whenIdle();
    await whenIdle();
    expect(first.calls).toHaveLength(0);
    expect(second.calls.map((c) => `${c.kind} ${c.table}`)).toEqual(["update events"]);
    copy.stopEngine();
  });
});
