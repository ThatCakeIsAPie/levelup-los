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
vi.mock("@/lib/supabase", () => ({ supabase: null }));
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<object>()), IS_SUPABASE: true }));
import { usePeopleStore, type CrmPerson } from "@/stores/peopleStore";
import { tagsPatch, visibleTags } from "@/data/pipeline/rules";
import { updatePerson } from "@/data/people";
import { peopleBinding } from "./bindings";
import { applyRemote, startEngine, stopEngine, whenIdle, type Binding, type Row } from "./engine";
import * as m from "./rows";

const dbRow = (id: string, tags: string[], name = id): Row =>
  m.personToRow({ id, name, bizClass: "ibo", tags } as CrmPerson);

describe("people rows: the signed-in person's own tags", () => {
  it("are dropped where a row becomes a person, and only there for that person", () => {
    const own = dbRow("me", ["Needs encouragement"]) as Parameters<typeof m.personFromRow>[0];
    const other = dbRow("you", ["Gym"]) as Parameters<typeof m.personFromRow>[0];
    expect(m.personFromRow(own, "me").tags).toBeUndefined();
    expect(m.personFromRow(other, "me").tags).toEqual(["Gym"]);
    // Without a viewer (tests, seed round trips) nothing is dropped.
    expect(m.personFromRow(own).tags).toEqual(["Needs encouragement"]);
  });
});

/** A stand-in for the supabase-js query builder that records the writes. */
function fakeClient() {
  const calls: { table: string; kind: string; changes?: Row; rows?: Row[] }[] = [];
  const from = (table: string) => {
    const call: { table: string; kind: string; changes?: Row; rows?: Row[] } = { table, kind: "" };
    let ids: unknown[] = [];
    const b = {
      insert(rows: Row[]) {
        Object.assign(call, { kind: "insert", rows });
        return b;
      },
      upsert(rows: Row[]) {
        Object.assign(call, { kind: "upsert", rows });
        return b;
      },
      update(changes: Row) {
        Object.assign(call, { kind: "update", changes });
        return b;
      },
      delete() {
        call.kind = "delete";
        return b;
      },
      in(_c: string, v: unknown[]) {
        ids = v;
        return b;
      },
      match(v: Row) {
        ids = [v];
        return b;
      },
      eq(_c: string, v: unknown) {
        ids = [v];
        return b;
      },
      select() {
        return b;
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        calls.push(call);
        return Promise.resolve({ data: ids.map((id) => ({ id })), error: null }).then(res, rej);
      },
    };
    return b;
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

afterEach(() => {
  stopEngine();
  usePeopleStore.setState({ people: [] });
});

describe("write path: saving another field of your own profile", () => {
  it("never sends tags, so the stored own tags stay as they are", async () => {
    const { client, calls } = fakeClient();
    startEngine({ client, me: "me", myName: "Me" }, [peopleBinding as unknown as Binding<unknown>]);
    // The database sends the person their own row with its tags, and another person's.
    applyRemote("people", [
      dbRow("me", ["Needs encouragement", "Referral source"]),
      dbRow("you", ["Gym"]),
    ]);
    await whenIdle();
    const own = usePeopleStore.getState().people.find((p) => p.id === "me")!;
    expect(own.tags).toBeUndefined(); // not in the app's state
    expect(visibleTags(own, "me")).toEqual([]);
    expect(calls).toHaveLength(0);

    // What the Details form sends when you change your name and leave tags alone.
    updatePerson("me", { name: "Me Renamed", location: "Austin", ...tagsPatch(own, "me", []) });
    await whenIdle();
    const writes = calls.filter((c) => c.table === "people");
    expect(writes).toHaveLength(1);
    expect(writes[0].kind).toBe("update");
    expect(writes[0].changes).toEqual({
      name: "Me Renamed",
      location: "Austin",
      last_updated_at: expect.any(String),
    });
    expect(writes[0].changes).not.toHaveProperty("tags");

    // The echo of that write (the row still carries the stored tags) changes nothing and writes nothing.
    calls.length = 0;
    applyRemote("people", [dbRow("me", ["Needs encouragement", "Referral source"], "Me Renamed")]);
    await whenIdle();
    expect(calls).toHaveLength(0);
    expect(usePeopleStore.getState().people.find((p) => p.id === "me")?.tags).toBeUndefined();

    // Someone else's tags are kept in state and editable as before.
    const you = usePeopleStore.getState().people.find((p) => p.id === "you")!;
    expect(you.tags).toEqual(["Gym"]);
    updatePerson("you", tagsPatch(you, "me", ["Gym", "Bilingual"]));
    await whenIdle();
    expect(calls.find((c) => c.table === "people")?.changes).toMatchObject({
      tags: ["Gym", "Bilingual"],
    });
  });
});
