/**
 * Renameable pipeline stages against the local database: a name an upline
 * sets reaches their downline (through effective_stage_names(), because the
 * downline can't read the upline's rows), the downline's own name wins and
 * stays when the upline changes theirs again, the person below the downline
 * inherits the downline's, a crossline gets nothing from the wrong branch,
 * and clearing your own name falls back to the upline's. The sponsor line is
 * Maria (1) -> Anita (2) -> Jamal (4) -> Tasha (700); Marcus (6) is Maria's.
 * Needs the local stack running and seeded.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { getStageNames, saveStageNames } from "@/data";
import { whenIdle } from "@/data/remote";
import { applyPipeline, fetchPipeline } from "@/data/remote/hydrate";

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

let maria: SupabaseClient;
let anita: SupabaseClient;
let jamal: SupabaseClient;
let tasha: SupabaseClient;
let marcus: SupabaseClient;

async function clean() {
  for (const [c, id] of [
    [maria, "1"],
    [anita, "2"],
    [jamal, "4"],
    [tasha, "700"],
    [marcus, "6"],
  ] as const)
    await c.from("stage_names").delete().eq("person_id", id);
}

/** Jamal's view: what the app shows him after the pipeline tables were refetched. */
async function jamalSees(pipeline: "recruiting" | "customer", stage: string): Promise<string> {
  applyPipeline(await fetchPipeline(jamal, "4"));
  return getStageNames(pipeline).name(stage);
}

beforeAll(async () => {
  expect(IS_SUPABASE).toBe(true);
  [maria, anita, jamal, tasha, marcus] = await Promise.all(
    ["maria", "anita", "jamal", "tasha", "marcus"].map((n) => login(`${n}@demo.test`)),
  );
  await clean();
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
    await clean();
  } catch (e) {
    console.warn("[integration cleanup]", e);
  }
  await signOut();
  await Promise.all(clients.map((c) => c.auth.signOut({ scope: "local" })));
});

describe("pipeline stage names", () => {
  it("starts at the built-in names", async () => {
    expect(await jamalSees("recruiting", "first_plan")).toBe("First plan");
  });

  it("an upline's name reaches the downline, who can't read the row itself", async () => {
    const ins = await anita
      .from("stage_names")
      .insert({ pipeline: "recruiting", stage_key: "first_plan", name: "Plan call" });
    expect(ins.error).toBeNull();
    // Not readable by Jamal...
    const direct = await jamal.from("stage_names").select("*").eq("person_id", "2");
    expect(direct.data).toEqual([]);
    // ...but he sees it, and who it comes from.
    const pipeline = await fetchPipeline(jamal, "4");
    expect(pipeline.stageNames.inherited).toEqual([
      {
        pipeline: "recruiting",
        stage: "first_plan",
        name: "Plan call",
        fromId: "2",
        fromName: "Anita Patel",
      },
    ]);
    expect(await jamalSees("recruiting", "first_plan")).toBe("Plan call");
    // Other stages and the other pipeline are untouched.
    expect(getStageNames("recruiting").name("first_meeting")).toBe("First meeting");
    expect(getStageNames("customer").name("first_sale")).toBe("First sale");
  });

  it("the downline sets his own name from the app: saved, and it wins", async () => {
    expect(saveStageNames("recruiting", { first_plan: "Jamal plan" })).toEqual({ ok: true });
    await whenIdle();
    const row = await jamal.from("stage_names").select("*").eq("person_id", "4");
    expect(row.data).toHaveLength(1);
    expect(row.data?.[0]).toMatchObject({
      pipeline: "recruiting",
      stage_key: "first_plan",
      name: "Jamal plan",
      workspace_id: "w1",
    });
    expect(getStageNames("recruiting").name("first_plan")).toBe("Jamal plan");
    expect(await jamalSees("recruiting", "first_plan")).toBe("Jamal plan");
  });

  it("the upline changes theirs again: the downline and the person below him keep his", async () => {
    const up = await anita
      .from("stage_names")
      .update({ name: "Plan call v2" })
      .eq("pipeline", "recruiting")
      .eq("stage_key", "first_plan");
    expect(up.error).toBeNull();
    expect(await jamalSees("recruiting", "first_plan")).toBe("Jamal plan");
    const t = await fetchPipeline(tasha, "700");
    expect(t.stageNames.inherited).toEqual([
      {
        pipeline: "recruiting",
        stage: "first_plan",
        name: "Jamal plan",
        fromId: "4",
        fromName: "Jamal Brown",
      },
    ]);
  });

  it("a crossline and the top get nothing from Anita's branch", async () => {
    expect((await fetchPipeline(marcus, "6")).stageNames.inherited).toEqual([]);
    expect((await fetchPipeline(maria, "1")).stageNames.inherited).toEqual([]);
  });

  it("the customer pipeline is separate, and the nearest upline wins over a higher one", async () => {
    await maria
      .from("stage_names")
      .insert({ pipeline: "customer", stage_key: "contact", name: "Top" });
    await anita
      .from("stage_names")
      .insert({ pipeline: "customer", stage_key: "contact", name: "Mid" });
    expect(await jamalSees("customer", "contact")).toBe("Mid");
    const names = (await fetchPipeline(tasha, "700")).stageNames.inherited;
    expect(names.find((n) => n.pipeline === "customer")).toMatchObject({
      name: "Mid",
      fromId: "2",
    });
    expect(getStageNames("recruiting").name("contact")).toBe("Contact made");
  });

  it("refuses bad names and other people's rows", async () => {
    const long = await jamal
      .from("stage_names")
      .insert({ pipeline: "recruiting", stage_key: "contact", name: "x".repeat(31) });
    expect(long.error?.code).toBe("23514");
    const key = await jamal
      .from("stage_names")
      .insert({ pipeline: "recruiting", stage_key: "first_sale", name: "Nope" });
    expect(key.error?.code).toBe("23514");
    const theirs = await jamal
      .from("stage_names")
      .insert({ person_id: "2", pipeline: "recruiting", stage_key: "contact", name: "Nope" });
    expect(theirs.error?.code).toBe("42501");
  });

  it("clearing his own name goes back to the upline's, and is deleted in the database", async () => {
    expect(saveStageNames("recruiting", {})).toEqual({ ok: true });
    await whenIdle();
    const row = await jamal.from("stage_names").select("*").eq("person_id", "4");
    expect(row.data).toEqual([]);
    expect(await jamalSees("recruiting", "first_plan")).toBe("Plan call v2");
  });

  it("clearing several names at once is saved too", async () => {
    expect(
      saveStageNames("recruiting", { contact: "A", first_meeting: "B", registered: "C" }),
    ).toEqual({ ok: true });
    await whenIdle();
    expect((await jamal.from("stage_names").select("*").eq("person_id", "4")).data).toHaveLength(3);
    expect(saveStageNames("recruiting", {})).toEqual({ ok: true });
    await whenIdle();
    expect((await jamal.from("stage_names").select("*").eq("person_id", "4")).data).toEqual([]);
  });
});
