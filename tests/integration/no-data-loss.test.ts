/**
 * The app never deletes what the signed-in person didn't delete. Every write
 * request the app sends is recorded, and each scenario checks that no DELETE
 * went out except the ones it asked for, and that Beau Foster's own rows
 * (attendance m7, contacts t-20 / t2-20, learning l30, two library progress
 * rows, his login) are all still there:
 *
 *  - a second copy of the sync engine (what a dev-server hot update loads)
 *    while Beau is signed in: the copy empties and reloads the stores, which
 *    the first copy used to send as deletes of everything he had;
 *  - registering Beau from Maria's board and undoing it;
 *  - switching from Maria to Beau while a save is in flight;
 *  - a refetch that sees fewer rows (someone moved out of Jamal's view).
 *
 * Needs the local stack running and seeded; restores what it changes.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { useCrmStore } from "@/stores/crmStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import { logContact, logLearning, movePipelineCard, updatePerson } from "@/data";
import { scheduleRefresh, useRemoteStore, whenIdle } from "@/data/remote";
import { ALL_BINDINGS } from "@/data/remote/bindings";
import { adminClient, must } from "./admin";

const PASSWORD = "levelup-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const stamp = Date.now().toString(36);
const startedAt = new Date().toISOString();
type Who = "maria" | "anita" | "jamal" | "beau";

const clients: SupabaseClient[] = [];
const cleanup: (() => PromiseLike<unknown>)[] = [];

// Every write request (method + decoded URL) while `recording` is on.
let recording = false;
const writes: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (recording && method !== "GET" && method !== "HEAD") {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    writes.push(`${method} ${decodeURIComponent(url).replace(URL_, "")}`);
  }
  return realFetch(input, init);
}) as typeof fetch;
const deletes = () => writes.filter((w) => w.startsWith("DELETE "));

async function login(name: Who): Promise<SupabaseClient> {
  const c = createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await c.auth.signInWithPassword({
    email: `${name}@levelup.test`,
    password: PASSWORD,
  });
  if (error) throw error;
  clients.push(c);
  return c;
}

async function signInApp(name: Who): Promise<void> {
  await signOut();
  const { error } = await getSupabase().auth.signInWithPassword({
    email: `${name}@levelup.test`,
    password: PASSWORD,
  });
  if (error) throw error;
  await refreshAccount();
  expect(useSessionStore.getState().status).toBe("ready");
  expect(useRemoteStore.getState().phase).toBe("ready");
}

async function until<T>(fn: () => T | Promise<T>, what: string, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Everything of Beau's that the person-delete cascade would take with him. */
async function beauRows() {
  const a = adminClient();
  const ids = async (table: string, col = "id") =>
    ((await a.from(table).select(col).eq("person_id", "20").order(col)).data ?? []).map(
      (r) => (r as unknown as Record<string, string>)[col],
    );
  return {
    attendances: await ids("attendances"),
    contacts: await ids("contacts"),
    learning: await ids("learning"),
    progress: await ids("library_progress", "item_id"),
    members: await ids("members", "person_id"),
  };
}
const BEAU = {
  attendances: ["is1-20", "is2-20", "m7"],
  contacts: ["t-20", "t2-20"],
  learning: ["l30"],
  progress: ["lib-3", "lib-4"],
  members: ["20"],
};

beforeAll(async () => {
  expect(IS_SUPABASE).toBe(true);
  expect(await beauRows()).toEqual(BEAU); // a seeded database
});

afterEach(() => {
  recording = false;
  writes.length = 0;
});

afterAll(async () => {
  for (const step of cleanup.reverse()) {
    try {
      await step();
    } catch (e) {
      console.warn("[integration cleanup]", e);
    }
  }
  await signOut();
  await Promise.all(clients.map((c) => c.auth.signOut({ scope: "local" })));
  globalThis.fetch = realFetch;
});

describe("nothing is deleted that the person didn't delete", () => {
  it("a second copy of the sync engine (dev hot update) deletes nothing of Beau's", async () => {
    await signInApp("beau");
    expect(usePeopleStore.getState().people.map((p) => p.id)).toEqual(["20"]);
    recording = true;

    // What a hot update of engine.ts did: the module runs again, its session
    // empties the stores and loads them again, while the first copy was still
    // subscribed to them with Beau's rows as its baseline.
    const copy =
      (await import("@/data/remote/engine?hot")) as typeof import("@/data/remote/engine");
    const ctx = { client: getSupabase(), me: "20", myName: "Beau Foster" };
    copy.suppressed(() => {
      usePeopleStore.setState({ people: [] });
      useAttendanceStore.setState({ attendances: [] });
      useCrmStore.setState({ contacts: [], learning: [] });
    });
    copy.startEngine(ctx, ALL_BINDINGS);
    // Beau logs some learning in the "reloaded" app: only that is written.
    logLearning({ kind: "podcast", title: `IT hot ${stamp}`, personId: "20" });
    await copy.whenIdle();
    await whenIdle();
    copy.stopEngine();

    expect(deletes()).toEqual([]);
    const a = adminClient();
    const saved = await a.from("learning").select("id").eq("title", `IT hot ${stamp}`);
    await must(a.from("learning").delete().eq("title", `IT hot ${stamp}`), "learning");
    expect(saved.data).toHaveLength(1);
    expect(await beauRows()).toEqual(BEAU);
  });

  it("registering Beau from Maria's board and undoing it keeps everything of his", async () => {
    const a = adminClient();
    const before = (await a.from("people").select("stage_history").eq("id", "20").single()).data!;
    const card = (await a.from("pipeline_cards").select("*").eq("person_id", "20").single()).data!;
    cleanup.push(
      () =>
        must(
          a.from("people").update({ stage_history: before.stage_history }).eq("id", "20"),
          "Beau's stage history",
        ),
      () => must(a.from("pipeline_cards").update(card).eq("person_id", "20"), "Beau's card"),
      // Registering made him chat-eligible for a moment: the team chats took him in.
      () =>
        must(
          a.from("conversation_members").delete().eq("person_id", "20").gte("joined_at", startedAt),
          "Beau's team chats",
        ),
      () =>
        must(
          a
            .from("activity")
            .delete()
            .eq("related_person_id", "20")
            .eq("kind", "stage_changed")
            .gte("timestamp", startedAt),
          "Beau's activity",
        ),
    );

    await signInApp("maria");
    const maria = await login("maria");
    recording = true;
    const r = movePipelineCard("20", "registered");
    expect(r.ok && r.registered).toBe(true);
    if (!r.ok) return;
    await whenIdle();
    const reg = await maria.from("people").select("biz_class").eq("id", "20").single();
    expect(reg.data?.biz_class).toBe("apprentice");

    r.undo();
    await whenIdle();
    // The only delete is the move being undone.
    expect(deletes()).toEqual([`DELETE /rest/v1/pipeline_moves?id=in.(${r.move.id})`]);
    // The database put him back (same statement as the undo).
    const back = await maria
      .from("people")
      .select("biz_class, pipeline_stage, business_start_date")
      .eq("id", "20")
      .single();
    expect(back.data).toEqual({
      biz_class: "prospect",
      pipeline_stage: "prospect",
      business_start_date: null,
    });
    expect(usePeopleStore.getState().people.find((p) => p.id === "20")?.bizClass).toBe("prospect");
    const col = await maria
      .from("pipeline_cards")
      .select("column_id")
      .eq("person_id", "20")
      .single();
    expect(col.data?.column_id).toBe(card.column_id);
    expect(await beauRows()).toEqual(BEAU);
  });

  it("switching from Maria to Beau while a save is in flight deletes nothing", async () => {
    await signInApp("maria");
    recording = true;
    const contact = logContact({ personId: "20", note: `IT switch ${stamp}` });
    const a = adminClient();
    cleanup.push(() => must(a.from("contacts").delete().eq("id", contact.id), "contact"));
    // Let the save start, then switch people before it's done.
    await Promise.resolve();
    await Promise.resolve();
    const seen: string[][] = [];
    const stop = usePeopleStore.subscribe((s) => seen.push(s.people.map((p) => p.id)));
    await signInApp("beau");
    stop();
    await whenIdle();

    expect(deletes()).toEqual([]);
    // Maria's people were gone before Beau's were loaded.
    const cleared = seen.findIndex((ids) => ids.length === 0);
    expect(cleared).toBeGreaterThanOrEqual(0);
    expect(seen.slice(cleared).every((ids) => ids.length <= 1)).toBe(true);
    expect(usePeopleStore.getState().people.map((p) => p.id)).toEqual(["20"]);
    expect(useCrmStore.getState().contacts.every((c) => c.personId === "20")).toBe(true);
    expect(useAttendanceStore.getState().attendances.map((x) => x.id)).toEqual([
      "is1-20",
      "is2-20",
      "m7",
    ]);
    const after = await beauRows();
    expect({ ...after, contacts: after.contacts.filter((id) => id !== contact.id) }).toEqual(BEAU);
  });

  it("a refetch that sees fewer rows deletes nothing", async () => {
    const a = adminClient();
    const maria = await login("maria");
    const andre = async () => ({
      sponsor: (await a.from("people").select("sponsor_id").eq("id", "21").single()).data
        ?.sponsor_id,
      attendances: (await a.from("attendances").select("id").eq("person_id", "21")).data?.length,
      contacts: (await a.from("contacts").select("id").eq("person_id", "21")).data?.length,
    });
    expect(await andre()).toEqual({ sponsor: "4", attendances: 3, contacts: 2 });
    const notes = (await a.from("people").select("notes").eq("id", "4").single()).data?.notes;
    cleanup.push(
      () => must(a.from("people").update({ sponsor_id: "4" }).eq("id", "21"), "Andre's sponsor"),
      () => must(a.from("people").update({ notes }).eq("id", "4"), "Jamal's notes"),
      () => must(a.from("learning").delete().eq("title", `IT refetch ${stamp}`), "learning"),
      () =>
        must(
          a
            .from("activity")
            .delete()
            .eq("related_person_id", "4")
            .eq("summary", "Edited notes")
            .gte("timestamp", startedAt),
          "Jamal's activity",
        ),
    );

    await signInApp("jamal");
    expect(usePeopleStore.getState().people.some((p) => p.id === "21")).toBe(true);
    expect(useCrmStore.getState().contacts.filter((c) => c.personId === "21")).toHaveLength(2);
    // Maria moves Andre out of Jamal's view; Jamal's app refetches.
    const moved = await maria.from("people").update({ sponsor_id: "1" }).eq("id", "21");
    expect(moved.error).toBeNull();
    recording = true;
    scheduleRefresh(["crm", "pipeline"], 0);
    await until(
      () => !usePeopleStore.getState().people.some((p) => p.id === "21"),
      "Jamal's refetch without Andre",
    );
    expect(useCrmStore.getState().contacts.some((c) => c.personId === "21")).toBe(false);
    // Jamal keeps working: only his own changes are written.
    updatePerson("4", { notes: `IT refetch ${stamp}` });
    logLearning({ kind: "pages", title: `IT refetch ${stamp}`, amount: 5 });
    await whenIdle();

    expect(deletes()).toEqual([]);
    expect(await andre()).toEqual({ sponsor: "1", attendances: 3, contacts: 2 });
  });
});
