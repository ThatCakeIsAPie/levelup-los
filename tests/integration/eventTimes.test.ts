/**
 * Event start and end times against the local database, through the app's own writes: a timed event is
 * saved and loaded back as "HH:mm", a repeating event carries its times to every occurrence, a time changed
 * on one occurrence is remembered as its own, "this and following" changes the times from that occurrence
 * on, clearing the times makes an event all-day again, a client that writes no time column leaves times as
 * they are, `events.updated_at` moves on every update, and the team's time zone is loaded with the team.
 * Needs the local stack running and seeded (`npm run db:reset`).
 */
import { addDays, format } from "date-fns";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { useEventsStore } from "@/stores/eventsStore";
import { addEvent, makeEventRepeat, saveEventFollowing, updateEvent } from "@/data";
import { whenIdle } from "@/data/remote";
import { getWorkspaceTimezone } from "@/data/workspaceTimezone";
import { adminClient, must } from "./admin";

const PASSWORD = "demo-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const stamp = Date.now().toString(36);
const cleanup: (() => PromiseLike<unknown>)[] = [];
const clients: SupabaseClient[] = [];

async function signInApp(name: string): Promise<void> {
  await signOut();
  const { error } = await getSupabase().auth.signInWithPassword({
    email: `${name}@demo.test`,
    password: PASSWORD,
  });
  if (error) throw error;
  await refreshAccount();
  expect(useSessionStore.getState().status).toBe("ready");
}

async function login(name: string): Promise<SupabaseClient> {
  const c = createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await c.auth.signInWithPassword({
    email: `${name}@demo.test`,
    password: PASSWORD,
  });
  if (error) throw error;
  clients.push(c);
  return c;
}

async function workspaceToday(c: SupabaseClient): Promise<Date> {
  const { data, error } = await c.rpc("workspace_today", { p_workspace_id: "w1" });
  expect(error).toBeNull();
  const [y, m, d] = (data as string).split("-").map(Number);
  return new Date(y, m - 1, d);
}
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

const row = async (id: string) => {
  const { data, error } = await adminClient()
    .from("events")
    .select("id, start_time, end_time, series_overrides, updated_at, created_at")
    .eq("id", id)
    .single();
  expect(error).toBeNull();
  return data!;
};
async function occurrences(seriesId: string) {
  const { data, error } = await adminClient()
    .from("events")
    .select("id, series_date, start_time, end_time, series_overrides")
    .eq("series_id", seriesId)
    .order("series_date");
  expect(error).toBeNull();
  return data ?? [];
}
const times = (r: { start_time: string | null; end_time: string | null }) =>
  `${r.start_time?.slice(0, 5) ?? ""}-${r.end_time?.slice(0, 5) ?? ""}`;

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

describe("event times from the app", () => {
  it("saves a timed event, repeats it with its times, and changes them one occurrence or many at a time", async () => {
    await signInApp("maria");
    // The team's time zone arrives with the team.
    expect(getWorkspaceTimezone()).toBe("America/Chicago");

    const start = addDays(await workspaceToday(getSupabase()), 3);
    const e = addEvent({
      name: `Timed ${stamp}`,
      categoryId: "w1-info_session",
      date: ymd(start),
      startTime: "19:00",
      endTime: "20:30",
      format: "in_person",
    });
    cleanup.push(() => must(adminClient().from("events").delete().eq("id", e.id), "event"));
    await whenIdle();
    const saved = await row(e.id);
    expect(times(saved)).toBe("19:00-20:30");
    expect(saved.updated_at).toBeTruthy();

    // Repeating: every occurrence carries the times, and so does the app's copy.
    expect(await makeEventRepeat(e.id, { freq: "weekly" })).toEqual({ ok: true });
    const state = () => useEventsStore.getState();
    const seriesId = state().events.find((x) => x.id === e.id)!.seriesId!;
    cleanup.push(async () => {
      await must(adminClient().from("events").delete().eq("series_id", seriesId), "series events");
      await must(adminClient().from("event_series").delete().eq("id", seriesId), "series");
    });
    const mine = () =>
      state()
        .events.filter((x) => x.seriesId === seriesId)
        .sort((a, b) => a.seriesDate!.localeCompare(b.seriesDate!));
    expect(mine()).toHaveLength(8);
    expect(mine().map((x) => `${x.startTime}-${x.endTime}`)).toEqual(Array(8).fill("19:00-20:30"));
    expect((await occurrences(seriesId)).map(times)).toEqual(Array(8).fill("19:00-20:30"));

    // This event: the third starts earlier on its own.
    const before = await row(mine()[2].id);
    updateEvent(mine()[2].id, { startTime: "18:00" });
    await whenIdle();
    let rows = await occurrences(seriesId);
    expect(rows[2]).toMatchObject({ series_overrides: ["start_time"] });
    expect(times(rows[2])).toBe("18:00-20:30");
    expect(rows.filter((r) => r.series_overrides)).toHaveLength(1);
    expect((await row(mine()[2].id)).updated_at > before.updated_at).toBe(true);

    // This and following: new times from the fourth on; the third keeps its own start.
    expect(
      await saveEventFollowing(mine()[3].id, { startTime: "17:00", endTime: "18:30" }, undefined),
    ).toEqual({
      ok: true,
    });
    rows = await occurrences(seriesId);
    expect(rows.map(times)).toEqual([
      "19:00-20:30",
      "19:00-20:30",
      "18:00-20:30",
      ...Array(5).fill("17:00-18:30"),
    ]);
    expect(mine().map((x) => `${x.startTime}-${x.endTime}`)).toEqual(rows.map(times));

    // The times of a refused edit: an end before the start is not saved.
    const refused = await saveEventFollowing(
      mine()[4].id,
      { startTime: "19:00", endTime: "18:00" },
      undefined,
    );
    expect(refused.ok).toBe(false);
    expect((await occurrences(seriesId)).map(times)).toEqual(rows.map(times));

    // Clearing the times from the fifth on makes the later events all-day again.
    expect(
      await saveEventFollowing(
        mine()[4].id,
        { startTime: undefined, endTime: undefined },
        undefined,
      ),
    ).toEqual({
      ok: true,
    });
    rows = await occurrences(seriesId);
    expect(rows.map(times)).toEqual([
      "19:00-20:30",
      "19:00-20:30",
      "18:00-20:30",
      "17:00-18:30",
      ...Array(4).fill("-"),
    ]);
  });

  it("an event with its times cleared is all-day again", async () => {
    await signInApp("maria");
    const start = addDays(await workspaceToday(getSupabase()), 4);
    const e = addEvent({
      name: `Cleared ${stamp}`,
      categoryId: "w1-info_session",
      date: ymd(start),
      startTime: "09:00",
      endTime: "10:00",
      format: "in_person",
    });
    cleanup.push(() => must(adminClient().from("events").delete().eq("id", e.id), "event"));
    await whenIdle();
    expect(times(await row(e.id))).toBe("09:00-10:00");
    updateEvent(e.id, { startTime: undefined, endTime: undefined });
    await whenIdle();
    const after = await row(e.id);
    expect(after.start_time).toBeNull();
    expect(after.end_time).toBeNull();
    expect(useEventsStore.getState().events.find((x) => x.id === e.id)?.startTime).toBeUndefined();
  });
});

describe("a client that knows nothing about times", () => {
  it("writes events and edits timed ones without touching their times", async () => {
    const jamal = await login("jamal");
    const start = ymd(addDays(await workspaceToday(jamal), 5));
    const id = `old-${stamp}`;
    cleanup.push(() => must(adminClient().from("events").delete().eq("id", id), "event"));
    const made = await jamal
      .from("events")
      .insert({ id, name: `Old client ${stamp}`, category_id: "w1-work_session", date: start });
    expect(made.error).toBeNull();
    expect(times(await row(id))).toBe("-");
    // Someone with the new app gave it times; the old client edits the name and place.
    await must(
      adminClient().from("events").update({ start_time: "19:00", end_time: "20:00" }).eq("id", id),
      "times",
    );
    const edit = await jamal
      .from("events")
      .update({ name: `Old client ${stamp} (edited)`, location: "Dallas" })
      .eq("id", id)
      .select("id");
    expect(edit.error).toBeNull();
    expect(edit.data).toHaveLength(1);
    expect(times(await row(id))).toBe("19:00-20:00");
    // The database refuses times that break the rule, whoever writes them.
    const bad = await jamal.from("events").update({ end_time: "18:00" }).eq("id", id);
    expect(bad.error?.code).toBe("23514");
  });
});
