/**
 * Unlocks support against the local database: a deputy loads what their
 * leader sees (not the leader's customers), the admin flag comes from the
 * database, feature switches and deputies sync from the app (recorded as the
 * person who changed them), and a member can't flip a switch.
 * Needs the local stack running and seeded (`npm run db:reset`).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { addDeputy, getUnlocks, removeDeputy, setFeatureSwitch } from "@/data";
import { whenIdle } from "@/data/remote";
import { fetchSnapshot } from "@/data/remote/hydrate";
import { adminClient, must } from "./admin";

const PASSWORD = "levelup-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const clients: SupabaseClient[] = [];
const cleanup: (() => PromiseLike<unknown>)[] = [];

type Name = "maria" | "anita" | "jamal" | "marcus" | "admin";

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

describe("deputies, switches and the admin flag", () => {
  it("Marcus (Maria's deputy) loads Maria's team but not her customers", async () => {
    const snap = await fetchSnapshot(await login("marcus"), "6");
    const ids = new Set(snap.crm.people.map((p) => p.id));
    expect(ids.has("1") && ids.has("4") && ids.has("700")).toBe(true);
    expect(ids.has("c1")).toBe(false);
    expect(snap.crm.team.deputies).toEqual([
      expect.objectContaining({ leaderId: "1", deputyId: "6" }),
    ]);
    // The team's switches load too (the seed has none; the app may have flipped some).
    expect(Array.isArray(snap.crm.team.switches)).toBe(true);
  });

  it("the admin flag comes from the database", async () => {
    await signInApp("admin");
    expect(useSessionStore.getState().user?.admin).toBe(true);
    expect(getUnlocks().can.chats).toBe(true);
    await signInApp("maria");
    expect(useSessionStore.getState().user?.admin).toBeFalsy();
    expect(getUnlocks().can.chats).toBe(false);
  });

  it("Maria switches the library on from the app; the team reads who did it", async () => {
    await signInApp("maria");
    cleanup.push(() =>
      must(adminClient().from("feature_switches").delete().eq("feature", "library"), "switch"),
    );
    expect(setFeatureSwitch("library", true)).toBe(true);
    expect(getUnlocks().can.library).toBe(true);
    await whenIdle();
    const jamal = await login("jamal");
    const row = await jamal
      .from("feature_switches")
      .select("enabled, updated_by")
      .eq("feature", "library")
      .single();
    expect(row.data).toEqual({ enabled: true, updated_by: "1" });
  });

  it("a member can't flip a switch", async () => {
    await signInApp("jamal");
    expect(setFeatureSwitch("chats", true)).toBe(false);
    await whenIdle();
    const { data } = await (
      await login("maria")
    )
      .from("feature_switches")
      .select("feature")
      .eq("feature", "chats");
    expect(data).toEqual([]);
  });

  it("Maria names Anita as a deputy and removes her again", async () => {
    await signInApp("maria");
    cleanup.push(() =>
      must(adminClient().from("deputies").delete().eq("deputy_id", "2"), "deputy"),
    );
    expect(addDeputy("2")).toBeNull();
    await whenIdle();
    const anita = await login("anita");
    const before = await fetchSnapshot(anita, "2");
    expect(before.crm.people.some((p) => p.id === "1")).toBe(true);
    expect(before.crm.people.some((p) => p.id === "c1")).toBe(false);
    const row = await anita.from("deputies").select("added_by").eq("deputy_id", "2").single();
    expect(row.data).toEqual({ added_by: "1" });

    expect(removeDeputy("1", "2")).toBe(true);
    await whenIdle();
    const after = await fetchSnapshot(anita, "2");
    expect(after.crm.people.some((p) => p.id === "1")).toBe(false);
  });
});
