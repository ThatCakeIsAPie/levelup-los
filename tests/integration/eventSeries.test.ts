/**
 * Repeating events against the local database: the series functions and their rules as the app and
 * other clients use them. Twelve top-ups at the very same moment, from three different people, make one
 * occurrence per date; a plain delete of one occurrence is never undone by a later top-up; a client can't
 * write a series or an occurrence's place in it; and the app's own writes (make an event repeat, change
 * "this and following", delete one occurrence, delete "this and following") round-trip through the
 * database. Needs the local stack running and seeded (`npm run db:reset`).
 */
import { addDays, format } from "date-fns";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { useEventsStore } from "@/stores/eventsStore";
import {
  addEvent,
  makeEventRepeat,
  removeEvent,
  removeEventFollowing,
  saveEventFollowing,
  topUpSeries,
  updateEvent,
} from "@/data";
import { whenIdle } from "@/data/remote";
import { addDaysTo } from "@/data/recurrence/rule";
import { adminClient, must } from "./admin";

const PASSWORD = "demo-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const clients: SupabaseClient[] = [];
const cleanup: (() => PromiseLike<unknown>)[] = [];
const stamp = Date.now().toString(36);

type Name = "maria" | "anita" | "jamal" | "tasha" | "beau";

async function login(name: Name): Promise<SupabaseClient> {
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

async function signInApp(name: Name): Promise<void> {
  await signOut();
  const { error } = await getSupabase().auth.signInWithPassword({
    email: `${name}@demo.test`,
    password: PASSWORD,
  });
  if (error) throw error;
  await refreshAccount();
  expect(useSessionStore.getState().status).toBe("ready");
}

/** Today in the team's time zone, as the database counts it. */
async function workspaceToday(c: SupabaseClient): Promise<Date> {
  const { data, error } = await c.rpc("workspace_today", { p_workspace_id: "w1" });
  expect(error).toBeNull();
  const [y, m, d] = (data as string).split("-").map(Number);
  return new Date(y, m - 1, d);
}
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/** Remove a series and its events, whatever state a test left them in. */
function dropSeries(id: string) {
  cleanup.push(async () => {
    const admin = adminClient();
    await must(admin.from("events").delete().eq("series_id", id), "series events");
    await must(admin.from("event_series").delete().eq("id", id), "series");
  });
}
function dropEvent(id: string) {
  cleanup.push(() => must(adminClient().from("events").delete().eq("id", id), "event"));
}

async function occurrences(seriesId: string) {
  const { data, error } = await adminClient()
    .from("events")
    .select("id, date, series_date, name, location, created_by, series_overrides")
    .eq("series_id", seriesId)
    .order("series_date");
  expect(error).toBeNull();
  return data ?? [];
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

describe("repeating events: one per date, whoever asks and however often", () => {
  it("twelve top-ups at once from three people make exactly one occurrence per series date", async () => {
    const maria = await login("maria");
    const people = [maria, await login("jamal"), await login("beau")];
    const start = addDays(await workspaceToday(maria), 3);
    const id = `rep-${stamp}-a`;
    const made = await maria
      .from("events")
      .insert({ id, name: `Weekly ${stamp}`, category_id: "w1-info_session", date: ymd(start) });
    expect(made.error).toBeNull();
    dropEvent(id);
    const r = await maria.rpc("make_event_repeat", {
      p_event_id: id,
      p_freq: "weekly",
      p_ends_on: null,
    });
    expect(r.error).toBeNull();
    const { data: ev } = await adminClient()
      .from("events")
      .select("series_id")
      .eq("id", id)
      .single();
    const seriesId = ev!.series_id as string;
    dropSeries(seriesId);
    expect(await occurrences(seriesId)).toHaveLength(8);

    // The team hasn't opened the app for weeks: the later occurrences are gone.
    const admin = adminClient();
    await must(
      admin.from("events").delete().eq("series_id", seriesId).neq("series_date", ymd(start)),
      "drain",
    );
    await must(admin.from("event_series").update({ skipped: [] }).eq("id", seriesId), "skipped");
    expect(await occurrences(seriesId)).toHaveLength(1);

    for (const round of [1, 2]) {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => people[i % people.length].rpc("topup_event_series")),
      );
      for (const res of results) expect(res.error).toBeNull();
      const rows = await occurrences(seriesId);
      const perDate = new Map<string, number>();
      for (const row of rows) perDate.set(row.series_date, (perDate.get(row.series_date) ?? 0) + 1);
      expect(rows, `after round ${round}`).toHaveLength(8);
      expect([...perDate.values()].every((n) => n === 1)).toBe(true);
      // Made as Maria's, whichever app asked.
      expect(rows.every((row) => row.created_by === "1")).toBe(true);
    }
  });

  it("an occurrence deleted by a plain delete is never made again", async () => {
    const maria = await login("maria");
    const start = addDays(await workspaceToday(maria), 2);
    const id = `rep-${stamp}-b`;
    await maria
      .from("events")
      .insert({ id, name: `Weekly b ${stamp}`, category_id: "w1-info_session", date: ymd(start) });
    dropEvent(id);
    await maria.rpc("make_event_repeat", { p_event_id: id, p_freq: "weekly", p_ends_on: null });
    const { data: ev } = await adminClient()
      .from("events")
      .select("series_id")
      .eq("id", id)
      .single();
    const seriesId = ev!.series_id as string;
    dropSeries(seriesId);
    const rows = await occurrences(seriesId);
    const victim = rows[3];
    const del = await maria.from("events").delete().eq("id", victim.id).select("id");
    expect(del.data).toHaveLength(1);
    await Promise.all(Array.from({ length: 6 }, () => maria.rpc("topup_event_series")));
    const after = await occurrences(seriesId);
    expect(after.map((x) => x.series_date)).not.toContain(victim.series_date);
    expect(after).toHaveLength(rows.length - 1);
  });

  it("a client can't write a series, or an occurrence's place in it; only the people who may edit may repeat", async () => {
    const maria = await login("maria");
    const jamal = await login("jamal");
    const beau = await login("beau");
    const start = addDays(await workspaceToday(maria), 5);
    const id = `rep-${stamp}-c`;
    await maria
      .from("events")
      .insert({ id, name: `Weekly c ${stamp}`, category_id: "w1-info_session", date: ymd(start) });
    dropEvent(id);
    // Jamal didn't add it; a candidate can't either.
    expect(
      (await jamal.rpc("make_event_repeat", { p_event_id: id, p_freq: "daily", p_ends_on: null }))
        .error?.code,
    ).toBe("42501");
    expect(
      (await beau.rpc("make_event_repeat", { p_event_id: id, p_freq: "daily", p_ends_on: null }))
        .error?.code,
    ).toBe("42501");
    expect(
      (await maria.rpc("make_event_repeat", { p_event_id: id, p_freq: "weekly", p_ends_on: null }))
        .error,
    ).toBeNull();
    const { data: ev } = await adminClient()
      .from("events")
      .select("series_id")
      .eq("id", id)
      .single();
    const seriesId = ev!.series_id as string;
    dropSeries(seriesId);

    // Everyone on the team reads the series; nobody writes it directly.
    expect((await jamal.from("event_series").select("id").eq("id", seriesId)).data).toHaveLength(1);
    const ins = await maria
      .from("event_series")
      .insert({ freq: "daily", starts_on: ymd(start), name: "x", category_id: "w1-info_session" });
    expect(ins.error?.code).toBe("42501");
    const upd = await maria
      .from("event_series")
      .update({ ends_on: ymd(start) })
      .eq("id", seriesId)
      .select();
    expect(upd.error?.code).toBe("42501");
    const rm = await maria.from("event_series").delete().eq("id", seriesId).select();
    expect(rm.error?.code).toBe("42501");
    expect((await maria.from("events").update({ series_id: null }).eq("id", id)).error?.code).toBe(
      "42501",
    );

    // Jamal can't change or delete Maria's occurrences "and the following ones".
    expect(
      (
        await jamal.rpc("update_event_series_following", {
          p_event_id: id,
          p_patch: { location: "x" },
          p_repeat: null,
        })
      ).error?.code,
    ).toBe("42501");
    expect((await jamal.rpc("delete_event_following", { p_event_id: id })).error?.code).toBe(
      "42501",
    );
    // A plain edit of one occurrence by Anita (a moderator) is remembered on it.
    const anita = await login("anita");
    const one = (await occurrences(seriesId))[2];
    const edit = await anita
      .from("events")
      .update({ name: `Own name ${stamp}` })
      .eq("id", one.id)
      .select("id");
    expect(edit.data).toHaveLength(1);
    expect((await occurrences(seriesId))[2].series_overrides).toEqual(["name"]);
  });
});

describe("repeating events from the app", () => {
  it("makes an event repeat, changes this and following, deletes one and then the rest", async () => {
    await signInApp("maria");
    const start = addDays(await workspaceToday(getSupabase()), 3);
    const e = addEvent({
      name: `App weekly ${stamp}`,
      categoryId: "w1-info_session",
      date: ymd(start),
      location: "Dallas, TX",
      format: "in_person",
    });
    dropEvent(e.id);
    expect(await makeEventRepeat(e.id, { freq: "weekly" })).toEqual({ ok: true });
    const state = () => useEventsStore.getState();
    const seriesId = state().events.find((x) => x.id === e.id)!.seriesId!;
    expect(seriesId).toBeTruthy();
    dropSeries(seriesId);
    expect(state().series.find((x) => x.id === seriesId)?.freq).toBe("weekly");
    const mine = () =>
      state()
        .events.filter((x) => x.seriesId === seriesId)
        .sort((a, b) => a.seriesDate!.localeCompare(b.seriesDate!));
    expect(mine()).toHaveLength(8);
    expect(await occurrences(seriesId)).toHaveLength(8);

    // This event: rename the third on its own.
    const third = mine()[2];
    updateEvent(third.id, { name: "Third only" });
    await whenIdle();
    expect((await occurrences(seriesId))[2]).toMatchObject({
      name: "Third only",
      series_overrides: ["name"],
    });

    // This and following: a new location from the fourth on.
    expect(await saveEventFollowing(mine()[3].id, { location: "Room 9" }, undefined)).toEqual({
      ok: true,
    });
    let rows = await occurrences(seriesId);
    expect(rows.map((r) => r.location)).toEqual([
      "Dallas, TX",
      "Dallas, TX",
      "Dallas, TX",
      ...Array(5).fill("Room 9"),
    ]);
    expect(mine().map((x) => x.location)).toEqual(rows.map((r) => r.location));
    expect(rows[2].name).toBe("Third only");

    // This event: delete the fifth; a top-up doesn't bring it back.
    const fifth = mine()[4];
    removeEvent(fifth.id);
    await whenIdle();
    await topUpSeries();
    await Promise.all(Array.from({ length: 4 }, () => getSupabase().rpc("topup_event_series")));
    rows = await occurrences(seriesId);
    expect(rows.map((r) => r.series_date)).not.toContain(fifth.seriesDate);
    expect(rows).toHaveLength(7);

    // This and following: delete from the sixth (now index 4) on.
    const keep = mine()
      .slice(0, 4)
      .map((x) => x.id);
    const stopAt = mine()[4].seriesDate!;
    expect(await removeEventFollowing(mine()[4].id)).toEqual({ ok: true });
    expect(mine().map((x) => x.id)).toEqual(keep);
    expect((await occurrences(seriesId)).map((r) => r.id)).toEqual(keep);
    const { data: s } = await adminClient()
      .from("event_series")
      .select("ends_on")
      .eq("id", seriesId)
      .single();
    expect(s!.ends_on).toBe(addDaysTo(stopAt, -1));
    await Promise.all(Array.from({ length: 3 }, () => getSupabase().rpc("topup_event_series")));
    expect(await occurrences(seriesId)).toHaveLength(4);
  });
});
