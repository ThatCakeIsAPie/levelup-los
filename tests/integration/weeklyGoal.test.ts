/**
 * The weekly goal as a list against the local database: a list saved from the
 * app (items plus the old columns kept in step) and loaded back the same, a
 * row from before lists read as reading / podcasts / workshops, and a
 * malformed list refused and rolled back. Restores Jamal's seeded goal.
 * Needs the local stack running and seeded (`npm run db:reset`).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { useCrmStore } from "@/stores/crmStore";
import { setLearningGoal } from "@/data";
import { whenIdle } from "@/data/remote";
import { fetchSnapshot } from "@/data/remote/hydrate";
import { must } from "./admin";

const PASSWORD = "levelup-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const COLUMNS = "items, pages, podcasts, workshops, reading_unit, podcast_unit";

const clients: SupabaseClient[] = [];
const cleanup: (() => PromiseLike<unknown>)[] = [];

async function login(): Promise<SupabaseClient> {
  const c = createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await c.auth.signInWithPassword({
    email: "jamal@levelup.test",
    password: PASSWORD,
  });
  if (error) throw error;
  clients.push(c);
  return c;
}

async function signInApp(): Promise<void> {
  await signOut();
  const { error } = await getSupabase().auth.signInWithPassword({
    email: "jamal@levelup.test",
    password: PASSWORD,
  });
  if (error) throw error;
  await refreshAccount();
  expect(useSessionStore.getState().status).toBe("ready");
}

let jamal: SupabaseClient;

beforeAll(async () => {
  expect(IS_SUPABASE).toBe(true);
  jamal = await login();
  const { data, error } = await jamal
    .from("learning_goals")
    .select(COLUMNS)
    .eq("person_id", "4")
    .single();
  if (error) throw error;
  cleanup.push(() =>
    must(jamal.from("learning_goals").update(data).eq("person_id", "4"), "Jamal's goal"),
  );
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

describe("weekly goal", () => {
  it("a list saved from the app keeps the old columns in step and loads back the same", async () => {
    await signInApp();
    const goal = {
      items: [
        { kind: "contacts" as const, target: 12 },
        { kind: "reading" as const, target: 30, unit: "minutes" as const },
        { kind: "new_customers" as const, target: 2 },
      ],
    };
    setLearningGoal("4", goal);
    await whenIdle();
    const row = await jamal.from("learning_goals").select(COLUMNS).eq("person_id", "4").single();
    expect(row.data).toEqual({
      items: goal.items,
      pages: 30,
      podcasts: 0,
      workshops: 0,
      reading_unit: "minutes",
      podcast_unit: null,
    });
    const snap = await fetchSnapshot(jamal, "4");
    expect(snap.crm.goals["4"]).toEqual(goal);
    expect(useCrmStore.getState().goals["4"]).toEqual(goal);
  });

  it("a row from before lists reads as reading, podcasts and workshops", async () => {
    await must(
      jamal
        .from("learning_goals")
        .update({
          items: null,
          pages: 25,
          podcasts: 0,
          workshops: 2,
          reading_unit: "chapters",
          podcast_unit: null,
        })
        .eq("person_id", "4"),
      "legacy goal",
    );
    const snap = await fetchSnapshot(jamal, "4");
    expect(snap.crm.goals["4"]).toEqual({
      items: [
        { kind: "reading", target: 25, unit: "chapters" },
        { kind: "workshops", target: 2 },
      ],
    });
  });

  it("a malformed list is refused by the database and rolled back", async () => {
    await signInApp();
    const before = useCrmStore.getState().goals["4"];
    // Bypass the editor's check: a target of 0.
    useCrmStore.getState().setLearningGoal("4", { items: [{ kind: "contacts", target: 0 }] });
    await whenIdle();
    expect(useCrmStore.getState().goals["4"]).toEqual(before);
    const row = await jamal.from("learning_goals").select("items").eq("person_id", "4").single();
    expect(row.data).toEqual({ items: null });
  });
});
