/**
 * Home's card layout against the local database: a layout saved from the app
 * lands in `dashboard_layouts` and loads back, nobody else reads it, and
 * "Reset layout" deletes the row. Needs the local stack running and seeded.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { useHomeLayoutStore } from "@/data/homeLayoutStore";
import {
  HOME_CARDS,
  hideHomeCard,
  moveHomeCard,
  resetHomeLayout,
  setHomeLayout,
  showHomeCard,
} from "@/data";
import { whenIdle } from "@/data/remote";
import { fetchSnapshot } from "@/data/remote/hydrate";

const PASSWORD = "demo-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const clients: SupabaseClient[] = [];

async function login(email: string): Promise<SupabaseClient> {
  const c = createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  clients.push(c);
  return c;
}

let jamal: SupabaseClient;
let anita: SupabaseClient;

beforeAll(async () => {
  expect(IS_SUPABASE).toBe(true);
  jamal = await login("jamal@demo.test");
  anita = await login("anita@demo.test");
  await jamal.from("dashboard_layouts").delete().eq("person_id", "4");
  await signOut();
  const { error } = await getSupabase().auth.signInWithPassword({
    email: "jamal@demo.test",
    password: PASSWORD,
  });
  if (error) throw error;
  await refreshAccount();
  expect(useSessionStore.getState().status).toBe("ready");
});

afterAll(async () => {
  try {
    await jamal.from("dashboard_layouts").delete().eq("person_id", "4");
  } catch (e) {
    console.warn("[integration cleanup]", e);
  }
  await signOut();
  await Promise.all(clients.map((c) => c.auth.signOut({ scope: "local" })));
});

describe("home layout", () => {
  const visible = new Set<string>(HOME_CARDS.map((c) => c.id));

  it("saves your layout to the database and loads it back", async () => {
    const layout = moveHomeCard(undefined, visible, "myDay", { column: "main", index: 0 });
    setHomeLayout(layout);
    await whenIdle();
    const row = await jamal
      .from("dashboard_layouts")
      .select("layout")
      .eq("person_id", "4")
      .single();
    expect(row.data?.layout).toEqual(layout);
    const snap = await fetchSnapshot(jamal, "4");
    expect(snap.crm.homeLayouts["4"]).toEqual(layout);
  });

  it("saves the cards you hid with the layout, and loads them back", async () => {
    const hidden = hideHomeCard(
      moveHomeCard(undefined, visible, "myDay", { column: "main", index: 0 }),
      "inbox",
    );
    setHomeLayout(hidden);
    await whenIdle();
    const row = await jamal
      .from("dashboard_layouts")
      .select("layout")
      .eq("person_id", "4")
      .single();
    expect(row.data?.layout).toEqual(hidden);
    expect((row.data?.layout as { hidden?: string[] }).hidden).toEqual(["inbox"]);
    const snap = await fetchSnapshot(jamal, "4");
    expect(snap.crm.homeLayouts["4"]).toEqual(hidden);
    // The database refuses a hidden list that isn't one, and a key it doesn't know.
    const bad = await jamal
      .from("dashboard_layouts")
      .update({ layout: { order: [], side: [], hidden: ["inbox", "inbox"] } })
      .eq("person_id", "4");
    expect(bad.error?.code).toBe("23514");
    const extra = await jamal
      .from("dashboard_layouts")
      .update({ layout: { order: [], side: [], hidden: [], other: [] } })
      .eq("person_id", "4");
    expect(extra.error?.code).toBe("23514");
    // Showing the card again saves the plain two-key layout.
    setHomeLayout(showHomeCard(hidden, "inbox"));
    await whenIdle();
    const back = await jamal
      .from("dashboard_layouts")
      .select("layout")
      .eq("person_id", "4")
      .single();
    expect(Object.keys(back.data?.layout as object).sort()).toEqual(["order", "side"]);
  });

  it("is private: an upline doesn't load it", async () => {
    const snap = await fetchSnapshot(anita, "2");
    expect(snap.crm.homeLayouts["4"]).toBeUndefined();
  });

  it("Reset layout deletes the row", async () => {
    resetHomeLayout();
    await whenIdle();
    expect(useHomeLayoutStore.getState().layouts["4"]).toBeUndefined();
    const rows = await jamal.from("dashboard_layouts").select("person_id").eq("person_id", "4");
    expect(rows.data).toEqual([]);
  });
});
