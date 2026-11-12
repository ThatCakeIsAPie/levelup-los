/**
 * Referral sources and "Referred by" against the local database: what Jamal
 * and his upline load, names and prospects added with who referred them (a
 * name on a list as the referrer, across boards), changing it and undoing it,
 * and a referrer the writer can't see refused by the database and rolled
 * back. Needs the local stack running and seeded (`npm run db:reset`);
 * cleans up after itself.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { useCustomerPipelineStore } from "@/data/customerPipeline/store";
import {
  NOT_CONTACTED,
  REFERRAL_SOURCE,
  addListEntry,
  addPipelineProspect,
  getViewer,
  removeListEntry,
  setReferredBy,
  updatePerson,
} from "@/data";
import { currentReferralIndex } from "@/data/referrals/hooks";
import { useRemoteStore, whenIdle } from "@/data/remote";
import { adminClient, must } from "./admin";

const PASSWORD = "levelup-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const stamp = Date.now().toString(36);
const startedAt = new Date().toISOString();
type Who = "anita" | "jamal";

const clients: SupabaseClient[] = [];
const cleanup: (() => PromiseLike<unknown>)[] = [];

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

const rayId = () =>
  useCustomerPipelineStore.getState().entries.find((e) => e.name === "Ray Dunn")!.id;

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

describe("referrals", () => {
  it("Jamal loads his referral sources and who they referred; his upline sees them too", async () => {
    await signInApp("jamal");
    const index = currentReferralIndex(getViewer());
    expect(index.referrerOf({ kind: "person", id: "21" })?.name).toBe("Zane Hayes");
    expect(index.count({ kind: "person", id: "205" })).toBe(1);
    const ray = useCustomerPipelineStore.getState().cards.find((c) => c.entryId === rayId());
    expect(ray?.column).toBe(REFERRAL_SOURCE);

    const anita = await login("anita");
    const andre = await anita.from("people").select("referred_by").eq("id", "21").single();
    expect(andre.data?.referred_by).toBe("205");
  });

  it("a name added with who referred them, changed and undone, is saved each time", async () => {
    await signInApp("jamal");
    const jamal = await login("jamal");
    const ray = rayId();
    const r = addListEntry({
      name: `Toni Dunn ${stamp}`,
      ownerId: "4",
      referredBy: { kind: "entry", id: ray },
    });
    if (!r.ok) throw new Error(r.error);
    const id = r.entry.id;
    cleanup.push(() =>
      must(adminClient().from("list_entries").delete().eq("id", id), "list entry"),
    );
    await whenIdle();
    const row = async () =>
      (
        await jamal
          .from("list_entries")
          .select("referred_by, referred_by_entry")
          .eq("id", id)
          .single()
      ).data;
    expect(await row()).toEqual({ referred_by: null, referred_by_entry: ray });

    const changed = setReferredBy({ kind: "entry", id }, { kind: "person", id: "21" });
    if (!changed.ok) throw new Error(changed.error);
    await whenIdle();
    expect(await row()).toEqual({ referred_by: "21", referred_by_entry: null });

    changed.undo();
    await whenIdle();
    expect(await row()).toEqual({ referred_by: null, referred_by_entry: ray });
    expect(currentReferralIndex(getViewer()).count({ kind: "entry", id: ray })).toBe(1);

    removeListEntry(id);
    await whenIdle();
  });

  it("a prospect referred by a name on the list goes on the recruiting board", async () => {
    await signInApp("jamal");
    const jamal = await login("jamal");
    const ray = rayId();
    const r = addPipelineProspect({
      name: `Luis Park ${stamp}`,
      sponsorId: "4",
      column: NOT_CONTACTED,
      referredBy: { kind: "entry", id: ray },
    });
    if (!r) throw new Error("not added");
    const id = r.person.id;
    const admin = adminClient();
    cleanup.push(
      () => must(admin.from("pipeline_moves").delete().eq("person_id", id), "moves"),
      () => must(admin.from("activity").delete().eq("related_person_id", id), "activity"),
      () => must(admin.from("people").delete().eq("id", id), "prospect"),
    );
    await whenIdle();
    const saved = await jamal.from("people").select("referred_by_entry").eq("id", id).single();
    expect(saved.data?.referred_by_entry).toBe(ray);
    const card = await jamal
      .from("pipeline_cards")
      .select("column_id")
      .eq("person_id", id)
      .single();
    expect(card.data?.column_id).toBe(NOT_CONTACTED);
    expect(
      currentReferralIndex(getViewer())
        .referralsOf({ kind: "entry", id: ray })
        .map((c) => c.personId),
    ).toContain(id);
    r.undo();
    await whenIdle();
  });

  it("a referrer the writer can't see is refused and rolled back", async () => {
    await signInApp("jamal");
    cleanup.push(() =>
      must(
        adminClient()
          .from("activity")
          .delete()
          .eq("related_person_id", "21")
          .eq("summary", "Edited referredBy")
          .gte("timestamp", startedAt),
        "refused edit activity",
      ),
    );
    // Maria (1) is Jamal's upline, outside his view: the app's rules never
    // offer her, so write the link by hand to reach the database's check.
    updatePerson("21", { referredBy: "1" });
    expect(usePeopleStore.getState().people.find((p) => p.id === "21")?.referredBy).toBe("1");
    await whenIdle();
    expect(usePeopleStore.getState().people.find((p) => p.id === "21")?.referredBy).toBe("205");
    const row = await (
      await login("jamal")
    )
      .from("people")
      .select("referred_by")
      .eq("id", "21")
      .single();
    expect(row.data?.referred_by).toBe("205");
  });
});
