/**
 * Growth path against the local database: what uplines load to work out
 * their team's PV, sales logged with PV, an upline setting a month's PV and
 * marking a milestone (recorded as them), and a refused write rolled back.
 * Needs the local stack running and seeded (`npm run db:reset`).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { localDate } from "@/lib/dates";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { useCrmStore } from "@/stores/crmStore";
import {
  getGrowthPath,
  growthPath,
  hasReached,
  logSale,
  markMilestoneReached,
  removeSale,
  setMonthPv,
} from "@/data";
import { whenIdle } from "@/data/remote";
import { fetchSnapshot } from "@/data/remote/hydrate";
import { adminClient, must } from "./admin";

const PASSWORD = "levelup-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const THIS_MONTH = localDate().slice(0, 7);

const clients: SupabaseClient[] = [];
const cleanup: (() => PromiseLike<unknown>)[] = [];

type Name = "maria" | "anita" | "jamal" | "tasha";

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

describe("growth path data", () => {
  it("Anita loads the PV of her whole team, but not their customers", async () => {
    const snap = await fetchSnapshot(await login("anita"), "2");
    expect(snap.crm.sales.some((s) => s.id === "sg1" && s.personId === "700")).toBe(true);
    expect(snap.crm.people.some((p) => p.id === "c11")).toBe(false);
    expect(snap.crm.pvOverrides.map((o) => o.personId).sort()).toEqual(
      ["17", "2", "201", "203", "301", "4", "701"].sort(),
    );
    const input = {
      people: snap.crm.people,
      sales: snap.crm.sales,
      overrides: snap.crm.pvOverrides,
      marks: snap.crm.milestoneMarks,
    };
    // The same answers as the browser demo.
    expect(growthPath(input, "700", localDate()).next?.progress?.summary).toBe(
      "95 / 150 PV this month",
    );
    const anita = growthPath(input, "2", localDate());
    expect(anita.next?.code).toBe("6_25");
    expect(anita.milestones.find((m) => m.code === "bronze_builder")?.source).toBe("manual");
  });

  it("Tasha loads her own path, nothing above her", async () => {
    const snap = await fetchSnapshot(await login("tasha"), "700");
    expect(snap.crm.people.map((p) => p.id).sort()).toEqual(["700", "c11"]);
    expect(snap.crm.sales.map((s) => s.id).sort()).toEqual(["sg1", "sg2"]);
    expect(snap.crm.pvOverrides).toHaveLength(0);
    expect(snap.crm.milestoneMarks).toHaveLength(0);
  });

  it("a sale logged with PV is saved with the seller; the app's path updates", async () => {
    await signInApp("jamal");
    const before = getGrowthPath("4")!.thisMonth.pv;
    const sale = logSale({ customerId: "c8", product: "IT order", pv: 25, amount: 40 });
    expect(sale.personId).toBe("4");
    expect(getGrowthPath("4")!.thisMonth.pv).toBe(before + 25);
    await whenIdle();
    const jamal = await login("jamal");
    const row = await jamal.from("sales").select("pv, person_id").eq("id", sale.id).single();
    expect(row.data).toEqual({ pv: 25, person_id: "4" });
    removeSale(sale.id);
    await whenIdle();
    const gone = await jamal.from("sales").select("id").eq("id", sale.id);
    expect(gone.data).toHaveLength(0);
  });

  it("Jamal sets Tasha's month and marks a milestone; both are recorded as his", async () => {
    await signInApp("jamal");
    const admin = adminClient();
    cleanup.push(
      () => must(admin.from("pv_overrides").delete().eq("person_id", "700"), "pv override"),
      () => must(admin.from("milestone_marks").delete().eq("person_id", "700"), "marks"),
    );
    expect(hasReached("700", "core_150")).toBe(false);
    expect(setMonthPv("700", THIS_MONTH, 160)).toBe(true);
    expect(hasReached("700", "core_150")).toBe(true); // optimistic
    expect(markMilestoneReached("700", "first_sponsor", localDate())).toBe(true);
    await whenIdle();

    const tasha = await login("tasha");
    const o = await tasha.from("pv_overrides").select("pv, set_by").eq("person_id", "700").single();
    expect(o.data).toEqual({ pv: 160, set_by: "4" });
    const k = await tasha
      .from("milestone_marks")
      .select("code, marked_by")
      .eq("person_id", "700")
      .single();
    expect(k.data).toEqual({ code: "first_sponsor", marked_by: "4" });

    // Clearing them deletes the rows.
    expect(setMonthPv("700", THIS_MONTH, null)).toBe(true);
    expect(markMilestoneReached("700", "first_sponsor", null)).toBe(true);
    await whenIdle();
    expect((await tasha.from("pv_overrides").select("month").eq("person_id", "700")).data).toEqual(
      [],
    );
    expect(
      (await tasha.from("milestone_marks").select("code").eq("person_id", "700")).data,
    ).toEqual([]);
  });

  it("nobody sets their own PV: the app refuses, and a forced write is rolled back", async () => {
    await signInApp("tasha");
    expect(setMonthPv("700", THIS_MONTH, 999)).toBe(false);
    // Bypass the app's check: the database refuses and the store is restored.
    useCrmStore.getState().setPvOverride("700", THIS_MONTH, {
      pv: 999,
      setAt: new Date().toISOString(),
    });
    expect(useCrmStore.getState().pvOverrides).toHaveLength(1);
    await whenIdle();
    expect(useCrmStore.getState().pvOverrides).toHaveLength(0);
    const rows = await (await login("tasha")).from("pv_overrides").select("month");
    expect(rows.data).toEqual([]);
  });
});
