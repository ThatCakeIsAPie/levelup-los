/**
 * Event categories against the local database: anyone who may plan events
 * adds one from the app (synced, stamped as theirs), a candidate can't, only
 * leaders and deputies rename and merge, a merge moves the events and
 * archives the old category in one step, and an archived category can't be
 * picked for a new event.
 * Needs the local stack running and seeded (`npm run db:reset`).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { useEventsStore } from "@/stores/eventsStore";
import { addEventCategory, getEventCategories, mergeEventCategories } from "@/data";
import { whenIdle } from "@/data/remote";
import { adminClient, must } from "./admin";

const PASSWORD = "levelup-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const clients: SupabaseClient[] = [];
const cleanup: (() => PromiseLike<unknown>)[] = [];
const stamp = Date.now().toString(36);

type Name = "maria" | "anita" | "jamal" | "beau" | "marcus";

async function login(name: Name): Promise<SupabaseClient> {
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

async function signInApp(name: Name): Promise<void> {
  await signOut();
  const { error } = await getSupabase().auth.signInWithPassword({
    email: `${name}@levelup.test`,
    password: PASSWORD,
  });
  if (error) throw error;
  await refreshAccount();
  expect(useSessionStore.getState().status).toBe("ready");
}

/** Remove test categories (and their events) with the service role: the app never deletes them. */
function dropCategory(id: string) {
  cleanup.push(
    () => must(adminClient().from("events").delete().eq("category_id", id), "category events"),
    () => must(adminClient().from("event_categories").delete().eq("id", id), "category"),
  );
}

beforeAll(() => {
  expect(IS_SUPABASE).toBe(true);
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
});

describe("event categories: who may do what", () => {
  it("Anita (3/10) adds one from the app; it's stamped as hers", async () => {
    await signInApp("anita");
    const r = addEventCategory({
      name: `Book club ${stamp}`,
      icon: "book",
      allowsVirtual: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    dropCategory(r.category.id);
    await whenIdle();
    const row = await adminClient()
      .from("event_categories")
      .select("name, icon, allows_virtual, uses_tickets, created_by, archived_at, workspace_id")
      .eq("id", r.category.id)
      .single();
    expect(row.data).toEqual({
      name: `Book club ${stamp}`,
      icon: "book",
      allows_virtual: true,
      uses_tickets: false,
      created_by: "2",
      archived_at: null,
      workspace_id: "w1",
    });
  });

  it("a candidate can't add one, and nobody adds a second active one with the same name", async () => {
    const beau = await login("beau");
    const refused = await beau
      .from("event_categories")
      .insert({ name: `Beau's night ${stamp}` })
      .select();
    expect(refused.error?.code).toBe("42501");
    const anita = await login("anita");
    const dupe = await anita.from("event_categories").insert({ name: "night owls" }).select();
    expect(dupe.error?.code).toBe("23505");
  });

  it("only leaders and deputies rename, change and archive", async () => {
    const anita = await login("anita");
    const jamal = await login("jamal");
    const marcus = await login("marcus");
    const made = await anita
      .from("event_categories")
      .insert({ name: `Couples night ${stamp}` })
      .select("id")
      .single();
    expect(made.error).toBeNull();
    const id = made.data!.id as string;
    dropCategory(id);

    for (const who of [anita, jamal]) {
      const r = await who
        .from("event_categories")
        .update({ name: `Renamed ${stamp}` })
        .eq("id", id)
        .select();
      expect(r.data).toEqual([]);
    }
    // Marcus is Maria's deputy.
    const ok = await marcus
      .from("event_categories")
      .update({ name: `Date night ${stamp}`, uses_tickets: true, created_by: "6" })
      .eq("id", id)
      .select("name, uses_tickets, created_by")
      .single();
    expect(ok.data).toEqual({ name: `Date night ${stamp}`, uses_tickets: true, created_by: "2" });
  });

  it("only leaders and deputies merge", async () => {
    const anita = await login("anita");
    const jamal = await login("jamal");
    for (const who of [anita, jamal]) {
      const r = await who.rpc("merge_event_categories", {
        p_from_id: "w1-work_session",
        p_into_id: "w1-training",
      });
      expect(r.error?.code).toBe("42501");
    }
    const maria = await login("maria");
    const same = await maria.rpc("merge_event_categories", {
      p_from_id: "w1-training",
      p_into_id: "w1-training",
    });
    expect(same.error).not.toBeNull();
  });
});

describe("merging", () => {
  it("moves the events over (in person if the other is), then archives the old one", async () => {
    const anita = await login("anita");
    const made = await anita
      .from("event_categories")
      .insert({ name: `Zoom hangout ${stamp}`, allows_virtual: true })
      .select("id")
      .single();
    const id = made.data!.id as string;
    dropCategory(id);
    const ev = await anita
      .from("events")
      .insert({ name: `Hangout ${stamp}`, date: "2026-12-05", category_id: id, format: "virtual" })
      .select("id, format")
      .single();
    expect(ev.data?.format).toBe("virtual");
    cleanup.push(() => must(adminClient().from("events").delete().eq("id", ev.data!.id), "event"));

    const maria = await login("maria");
    const merged = await maria.rpc("merge_event_categories", {
      p_from_id: id,
      p_into_id: "w1-night_owls",
    });
    expect(merged.error).toBeNull();
    expect(merged.data).toBe(1);
    const after = await maria
      .from("events")
      .select("category_id, format")
      .eq("id", ev.data!.id)
      .single();
    expect(after.data).toEqual({ category_id: "w1-night_owls", format: "in_person" });
    const cat = await maria.from("event_categories").select("archived_at").eq("id", id).single();
    expect(cat.data?.archived_at).not.toBeNull();

    // Archived: still readable, but not for a new event.
    const refused = await anita
      .from("events")
      .insert({ name: `Late hangout ${stamp}`, date: "2026-12-06", category_id: id });
    expect(refused.error?.code).toBe("23514");
    // Merging into it is refused too.
    const into = await maria.rpc("merge_event_categories", {
      p_from_id: "w1-training",
      p_into_id: id,
    });
    expect(into.error?.code).toBe("23514");
  });

  it("Maria merges from the app: the events move and the old category is archived", async () => {
    const anita = await login("anita");
    const made = await anita
      .from("event_categories")
      .insert({ name: `Pop-up ${stamp}` })
      .select("id")
      .single();
    const id = made.data!.id as string;
    dropCategory(id);
    const ev = await anita
      .from("events")
      .insert({ name: `Pop-up ${stamp}`, date: "2026-12-07", category_id: id })
      .select("id")
      .single();
    cleanup.push(() => must(adminClient().from("events").delete().eq("id", ev.data!.id), "event"));

    await signInApp("maria");
    expect(getEventCategories().some((c) => c.id === id)).toBe(true);
    const r = mergeEventCategories(id, "w1-work_session");
    expect(r).toEqual({ ok: true, moved: 1 });
    // Shown at once…
    expect(useEventsStore.getState().events.find((e) => e.id === ev.data!.id)?.categoryId).toBe(
      "w1-work_session",
    );
    // …and done in the database in one step.
    await vi.waitFor(
      async () => {
        const row = await adminClient()
          .from("event_categories")
          .select("archived_at")
          .eq("id", id)
          .single();
        expect(row.data?.archived_at).not.toBeNull();
      },
      { timeout: 10_000, interval: 250 },
    );
    const moved = await adminClient()
      .from("events")
      .select("category_id")
      .eq("id", ev.data!.id)
      .single();
    expect(moved.data?.category_id).toBe("w1-work_session");
    await whenIdle();
  });
});
