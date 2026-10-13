/**
 * The pipeline against the local database: what each role loads, moves from
 * the app going through move_pipeline_card() (and counting), undo,
 * registering from the board, crosslines kept out, and a stat request
 * approved through the inbox flow. Needs the local stack running and seeded
 * (`npm run db:reset`); cleans up after itself.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { usePipelineStore } from "@/data/pipeline/store";
import { reachesOf } from "@/data/pipeline/rules";
import { addPipelineProspect, answerStatRequest, movePipelineCard, requestStats } from "@/data";
import { useRemoteStore, whenIdle } from "@/data/remote";
import { fetchPipeline } from "@/data/remote/hydrate";
import { adminClient, must } from "./admin";

const PASSWORD = "levelup-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const stamp = Date.now().toString(36);
type Who = "maria" | "anita" | "jamal" | "beau";

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

/** Milestones reached around today by these owners (pipeline_person_counts). */
async function counts(c: SupabaseClient, owner: string) {
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await c.rpc("pipeline_person_counts", {
    p_owner_ids: [owner],
    p_from: day(-1),
    p_to: day(1),
  });
  if (error) throw error;
  return data?.[0];
}

async function cardColumn(c: SupabaseClient, personId: string) {
  const { data } = await c
    .from("pipeline_cards")
    .select("column_id")
    .eq("person_id", personId)
    .maybeSingle();
  return data?.column_id ?? null;
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

describe("what each person loads", () => {
  it("Jamal: his line's steps, his team's cards and moves, and his sponsor line", async () => {
    const p = await fetchPipeline(await login("jamal"), "4");
    expect(p.chain.map((c) => c.personId)).toEqual(["1", "2", "4"]);
    expect(p.chain[0].name).toBe("Maria Reyes");
    expect(p.data.steps.map((s) => s.id).sort()).toEqual(
      [
        "s-3way",
        "s-book",
        "s-door",
        "s-f1",
        "s-f2",
        "s-f3",
        "s-info2",
        "s-info3",
        "s-mg2",
        "s-story",
      ].sort(),
    );
    const cards = new Set(p.data.cards.map((c) => c.personId));
    expect(cards.has("9")).toBe(true);
    expect(cards.has("5")).toBe(false); // his upline's prospect
    expect(cards.has("103")).toBe(false); // a crossline's
    const owners = new Set(p.data.moves.map((m) => m.ownerId));
    expect(owners.has("4")).toBe(true);
    expect(owners.has("2")).toBe(false);
    expect(p.data.settings.map((s) => s.personId).sort()).toEqual(["1", "2", "4"]);
    expect(p.data.requests.map((r) => r.id)).toEqual(["req-4-1"]);
  });

  it("Beau (candidate): no pipeline at all", async () => {
    const p = await fetchPipeline(await login("beau"), "20");
    expect(p.data.cards).toHaveLength(0);
    expect(p.data.moves).toHaveLength(0);
    expect(p.data.steps).toHaveLength(0);
  });

  it("signing in fills the pipeline store and the sponsor line", async () => {
    await signInApp("jamal");
    expect(usePipelineStore.getState().cards.some((c) => c.personId === "9")).toBe(true);
    expect(useRemoteStore.getState().chain.map((c) => c.personId)).toEqual(["1", "2", "4"]);
  });
});

describe("crosslines", () => {
  it("Anita can't read David's moves or move his prospects; Marcus shares totals only", async () => {
    const anita = await login("anita");
    const moves = await anita.from("pipeline_moves").select("id").eq("owner_id", "3");
    expect(moves.data).toHaveLength(0);
    const moved = await anita.rpc("move_pipeline_card", { p_person_id: "103", p_to: "contact" });
    expect(moved.error?.code).toBe("P0002");
    const shared = await anita.from("pipeline_moves").select("id").eq("owner_id", "6");
    expect(shared.data).toHaveLength(0);
    const totals = await anita.rpc("pipeline_person_counts", {
      p_owner_ids: ["3", "6"],
      p_from: "2000-01-01",
      p_to: "2100-01-01",
    });
    expect((totals.data ?? []).map((r) => r.owner_id)).toEqual(["6"]);
  });
});

describe("moves from the app", () => {
  it("a move goes through move_pipeline_card(), counts, and undo takes it back", async () => {
    await signInApp("anita");
    const anita = await login("anita");
    const people = usePeopleStore.getState().people;
    const { cards, moves } = usePipelineStore.getState();
    const met = new Set(
      reachesOf(moves)
        .filter((r) => r.milestone === "first_meeting")
        .map((r) => r.personId),
    );
    const card = cards.find(
      (c) =>
        ["contact", "s-story", "s-door"].includes(c.column) &&
        !met.has(c.personId) &&
        people.find((p) => p.id === c.personId)?.sponsorId === "2",
    )!;
    expect(card).toBeTruthy();
    const before = await counts(anita, "2");

    const r = movePipelineCard(card.personId, "first_meeting");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await whenIdle();
    const row = await anita
      .from("pipeline_moves")
      .select("to_column, milestone, moved_by, from_column")
      .eq("id", r.move.id)
      .single();
    expect(row.data).toEqual({
      to_column: "first_meeting",
      milestone: "first_meeting",
      moved_by: "2",
      from_column: card.column,
    });
    expect(await cardColumn(anita, card.personId)).toBe("first_meeting");
    const after = await counts(anita, "2");
    expect(after?.first_meeting).toBe((before?.first_meeting ?? 0) + 1);

    r.undo();
    await whenIdle();
    const gone = await anita.from("pipeline_moves").select("id").eq("id", r.move.id);
    expect(gone.data).toHaveLength(0);
    expect(await cardColumn(anita, card.personId)).toBe(card.column);
    expect((await counts(anita, "2"))?.first_meeting).toBe(before?.first_meeting ?? 0);
  });

  it("registering from the board makes an apprentice; undo puts them back", async () => {
    await signInApp("anita");
    const anita = await login("anita");
    const added = addPipelineProspect({ name: `Pipeline Test ${stamp}`, source: "Gym" });
    expect(added).toBeTruthy();
    const id = added!.person.id;
    // Runs last (after the person is gone): their timeline, including the
    // "Removed …" entry the delete itself writes.
    const admin = adminClient();
    cleanup.push(() =>
      must(admin.from("activity").delete().eq("related_person_id", id), "test person activity"),
    );
    cleanup.push(() => anita.from("people").delete().eq("id", id));
    await whenIdle();
    expect(await cardColumn(anita, id)).toBe("contact");
    const card = await anita.from("pipeline_cards").select("source").eq("person_id", id).single();
    expect(card.data?.source).toBe("Gym");

    const r = movePipelineCard(id, "registered");
    expect(r.ok && r.registered).toBe(true);
    if (!r.ok) return;
    // The app shows it at once; the database does the registering.
    expect(usePeopleStore.getState().people.find((p) => p.id === id)?.bizClass).toBe("apprentice");
    await whenIdle();
    const person = await anita
      .from("people")
      .select("biz_class, pipeline_stage, business_start_date")
      .eq("id", id)
      .single();
    expect(person.data?.biz_class).toBe("apprentice");
    expect(person.data?.pipeline_stage).toBe("apprentice");
    expect(person.data?.business_start_date).toBeTruthy();
    expect(await cardColumn(anita, id)).toBe("registered");
    const log = await anita
      .from("activity")
      .select("summary")
      .eq("related_person_id", id)
      .eq("kind", "stage_changed");
    expect(log.data?.map((a) => a.summary)).toContain("Pipeline → apprentice");

    r.undo();
    await whenIdle();
    const back = await anita.from("people").select("biz_class").eq("id", id).single();
    expect(back.data?.biz_class).toBe("prospect");
    expect(await cardColumn(anita, id)).toBe("contact");

    // Undo the "added" too: card, move, contact and person go.
    added!.undo();
    await whenIdle();
    const p = await anita.from("people").select("id").eq("id", id);
    expect(p.data).toHaveLength(0);
    const m = await anita.from("pipeline_moves").select("id").eq("person_id", id);
    expect(m.data).toHaveLength(0);
  });
});

describe("stat requests", () => {
  it("Anita asks Maria; Maria approves; Anita is told and gets Maria's totals", async () => {
    const maria = await login("maria");
    const anita = await login("anita");
    cleanup.push(() => maria.from("stat_shares").delete().match({ owner_id: "1", viewer_id: "2" }));

    await signInApp("anita");
    expect((await counts(anita, "1")) ?? null).toBeNull();
    expect(requestStats("1")).toEqual({ ok: true });
    await whenIdle();
    const req = usePipelineStore
      .getState()
      .requests.find((r) => r.requesterId === "2" && r.ownerId === "1" && r.status === "pending")!;
    // An answered request can't be withdrawn by either person: the service
    // role removes it and both notifications (012_pipeline expects the seed's).
    const admin = adminClient();
    cleanup.push(
      () => must(admin.from("notifications").delete().eq("ref_id", req.id), "request notes"),
      () => must(admin.from("stat_requests").delete().eq("id", req.id), "stat request"),
    );
    const note = await maria
      .from("notifications")
      .select("type, actor_id")
      .eq("ref_id", req.id)
      .single();
    expect(note.data).toEqual({ type: "stat_request", actor_id: "2" });

    await signInApp("maria");
    answerStatRequest(req.id, true);
    await whenIdle();
    const answered = await anita.from("stat_requests").select("status").eq("id", req.id).single();
    expect(answered.data?.status).toBe("approved");
    const share = await anita
      .from("stat_shares")
      .select("owner_id")
      .match({ owner_id: "1", viewer_id: "2" });
    expect(share.data).toHaveLength(1);
    const told = await anita
      .from("notifications")
      .select("type")
      .eq("ref_id", req.id)
      .eq("recipient_id", "2");
    expect(told.data?.map((n) => n.type)).toEqual(["stat_request_answered"]);
    const totals = await anita.rpc("pipeline_person_counts", {
      p_owner_ids: ["1"],
      p_from: "2000-01-01",
      p_to: "2100-01-01",
    });
    expect(totals.data?.[0]?.contact).toBeGreaterThan(0);
    // Still no access to Maria's prospects themselves.
    const moves = await anita.from("pipeline_moves").select("id").eq("owner_id", "1");
    expect(moves.data).toHaveLength(0);
  });
});
