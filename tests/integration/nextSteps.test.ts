/**
 * Booked next steps against the local database: Jamal books a step from the
 * app, "Done" (a move into the booked column) clears it and undo restores it,
 * a cancellation with a reason is recorded (with its activity entry) and
 * undone, and "Not interested anymore" on the customer board moves the card
 * too. Needs the local stack running and seeded (`npm run db:reset`); puts
 * every card back as it found it.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { localDate } from "@/lib/dates";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { usePipelineStore } from "@/data/pipeline/store";
import { bookNextStep, cancelBookedStep, moveCustomerCard, movePipelineCard } from "@/data";
import { useRemoteStore, whenIdle } from "@/data/remote";
import { adminClient, must } from "./admin";

const PASSWORD = "levelup-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const clients: SupabaseClient[] = [];
const cleanup: (() => PromiseLike<unknown>)[] = [];
const BOOKING = "column_id, next_column, next_step_date, next_step_time, note";

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
  expect(useRemoteStore.getState().phase).toBe("ready");
}

const card = async (c: SupabaseClient, personId: string) =>
  (await c.from("pipeline_cards").select(BOOKING).eq("person_id", personId).single()).data;
const customerCard = async (c: SupabaseClient, entryId: string) =>
  (await c.from("customer_cards").select(BOOKING).eq("entry_id", entryId).single()).data;

/** Put a card's booking and note back exactly as the seed had them. */
async function keep(table: "pipeline_cards" | "customer_cards", key: string, id: string) {
  const admin = adminClient();
  const { data } = await admin
    .from(table)
    .select("next_column, next_step_date, next_step_time, note")
    .eq(key, id)
    .single();
  cleanup.push(() => must(admin.from(table).update(data!).eq(key, id), `${table} ${id}`));
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

describe("booked next steps", () => {
  it("Jamal books a step from the app; the card holds it", async () => {
    await signInApp();
    const jamal = await login();
    await keep("pipeline_cards", "person_id", "21");
    const day = localDate(new Date(Date.now() + 2 * 86_400_000));
    const r = bookNextStep("recruiting", "21", {
      nextColumn: "first_meeting",
      nextStepDate: day,
      nextStepTime: "18:00",
    });
    expect(r.ok).toBe(true);
    await whenIdle();
    expect(await card(jamal, "21")).toMatchObject({
      next_column: "first_meeting",
      next_step_date: day,
      next_step_time: "18:00:00",
    });
    if (r.ok) r.undo();
    await whenIdle();
    expect((await card(jamal, "21"))?.next_column).toBe("s-door");
  });

  it("Done moves the card into the booked column and clears the booking; undo restores both", async () => {
    await signInApp();
    const jamal = await login();
    const before = await card(jamal, "204");
    expect(before?.next_column).toBe("first_meeting");
    const r = movePipelineCard("204", "first_meeting");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(usePipelineStore.getState().cards.find((c) => c.personId === "204")?.nextColumn).toBe(
      null,
    );
    await whenIdle();
    expect(await card(jamal, "204")).toMatchObject({
      column_id: "first_meeting",
      next_column: null,
      next_step_date: null,
    });
    r.undo();
    await whenIdle();
    expect(await card(jamal, "204")).toEqual(before);
  });

  it("a cancellation is recorded with its activity entry; undo takes both back", async () => {
    await signInApp();
    const jamal = await login();
    const before = await card(jamal, "9");
    const r = cancelBookedStep("recruiting", "9", "no_show");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toBe("F1 cancelled · No-show");
    await whenIdle();
    expect(await card(jamal, "9")).toMatchObject({ next_column: null, note: before?.note });
    const row = await jamal
      .from("pipeline_step_cancellations")
      .select("board, card_id, owner_id, column_id, reason, cancelled_by")
      .eq("id", r.cancellation.id)
      .single();
    expect(row.data).toEqual({
      board: "recruiting",
      card_id: "9",
      owner_id: "4",
      column_id: "s-f1",
      reason: "no_show",
      cancelled_by: "4",
    });
    const activity = await jamal
      .from("activity")
      .select("summary, related_person_id")
      .eq("id", `stepcancel-${r.cancellation.id}`)
      .single();
    expect(activity.data).toEqual({ summary: "F1 cancelled · No-show", related_person_id: "9" });

    r.undo();
    await whenIdle();
    expect(await card(jamal, "9")).toEqual(before);
    const gone = await jamal
      .from("pipeline_step_cancellations")
      .select("id")
      .eq("id", r.cancellation.id);
    expect(gone.data).toHaveLength(0);
    const noEntry = await jamal
      .from("activity")
      .select("id")
      .eq("id", `stepcancel-${r.cancellation.id}`);
    expect(noEntry.data).toHaveLength(0);
  });

  it("'Not interested anymore' on the customer board can move the card too", async () => {
    await signInApp();
    const jamal = await login();
    const before = await customerCard(jamal, "le-4-6");
    const r = cancelBookedStep("customer", "le-4-6", "not_interested");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = moveCustomerCard("le-4-6", "not_interested");
    expect(m.ok).toBe(true);
    await whenIdle();
    expect(await customerCard(jamal, "le-4-6")).toMatchObject({
      column_id: "not_interested",
      next_column: null,
      note: before?.note,
    });
    if (m.ok) m.undo();
    r.undo();
    await whenIdle();
    expect(await customerCard(jamal, "le-4-6")).toEqual(before);
  });
});
