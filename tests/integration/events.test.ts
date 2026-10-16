/**
 * Event categories and missed-event follow-ups against the local database: what
 * each demo login's follow-ups are, an upline logging a downline's attendance
 * (in person / virtual) and a check-in or an "already handled" note clearing
 * a follow-up for every upline, and a note from a downline refused.
 * Needs the local stack running and seeded (`npm run db:reset`).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { localDate } from "@/lib/dates";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import {
  addMissedNote,
  logContact,
  missedAudience,
  missedEventStreaks,
  openMissedFollowUps,
  removeContact,
  removeMissedNote,
  setEventAttendance,
} from "@/data";
import { whenIdle } from "@/data/remote";
import { fetchSnapshot, type Snapshot } from "@/data/remote/hydrate";
import { adminClient, must } from "./admin";

const PASSWORD = "levelup-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const clients: SupabaseClient[] = [];
const cleanup: (() => PromiseLike<unknown>)[] = [];

type Name = "maria" | "anita" | "jamal" | "tasha";
const ID: Record<Name, string> = { maria: "1", anita: "2", jamal: "4", tasha: "700" };

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

/** The open follow-ups a person's Today list shows, from what they load. */
function openFollowUps(snap: Snapshot, me: string): string[] {
  const streaks = missedEventStreaks({
    events: snap.crm.events,
    attendances: snap.crm.attendances,
    contacts: snap.crm.contacts,
    notes: snap.crm.missedNotes,
    today: localDate(),
    categories: snap.crm.eventCategories,
  });
  return openMissedFollowUps(streaks, me, missedAudience(snap.crm.people, me))
    .map((s) => `${s.personId}:${s.latest.id}`)
    .sort();
}

const followUpsOf = async (name: Name) =>
  openFollowUps(await fetchSnapshot(await login(name), ID[name]), ID[name]);

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

describe("event categories and missed-event follow-ups", () => {
  it("loads the six starting categories and the same follow-ups as the browser demo", async () => {
    const snap = await fetchSnapshot(await login("jamal"), "4");
    const starting = snap.crm.eventCategories.filter((c) => c.id.startsWith("w1-"));
    expect(starting.map((c) => c.name)).toEqual([
      "Night Owls",
      "Work session",
      "Info session",
      "Training",
      "Monthly team meeting",
      "Conference",
    ]);
    expect(new Set(snap.crm.events.map((e) => e.categoryId)).size).toBe(6);
    expect(snap.crm.events.find((e) => e.id === "no5")?.categoryId).toBe("w1-night_owls");
    expect(snap.crm.events.find((e) => e.id === "is2")?.format).toBe("both");
    expect(snap.crm.attendances.find((a) => a.id === "is1-21")?.attended).toBe(true);
    expect(openFollowUps(snap, "4")).toEqual(["700:no5"]);
    expect(await followUpsOf("maria")).toEqual(["4:ws2", "700:no5", "7:tr2"]);
    expect(await followUpsOf("anita")).toEqual(["4:ws2", "700:no5"]);
    expect(await followUpsOf("tasha")).toEqual([]);
  });

  it("Jamal logs that Tasha came: her follow-up is gone for everyone", async () => {
    await signInApp("jamal");
    const undo = setEventAttendance("no5", "700", "in_person");
    const row = useAttendanceStore.getState().forEventAndPerson("no5", "700")!;
    cleanup.push(() =>
      must(adminClient().from("activity").delete().eq("entity_id", row.id), "activity"),
    );
    await whenIdle();
    const db = await (
      await login("tasha")
    )
      .from("attendances")
      .select("attended, mode")
      .eq("id", row.id)
      .single();
    expect(db.data).toEqual({ attended: true, mode: "in_person" });
    expect(await followUpsOf("maria")).toEqual(["4:ws2", "7:tr2"]);

    undo();
    await whenIdle();
    expect(await followUpsOf("anita")).toEqual(["4:ws2", "700:no5"]);
  });

  it("a check-in from Jamal clears Tasha's follow-up for Anita and Maria", async () => {
    await signInApp("jamal");
    const c = logContact({ personId: "700", note: "Missed you at Night Owls" });
    await whenIdle();
    expect(await followUpsOf("anita")).toEqual(["4:ws2"]);
    removeContact(c.id);
    await whenIdle();
    expect(await followUpsOf("maria")).toEqual(["4:ws2", "700:no5", "7:tr2"]);
  });

  it("Anita's note on Jamal's miss clears it for Maria, who reads who wrote it", async () => {
    await signInApp("anita");
    const n = addMissedNote("4", "ws2", "Talked at the gym, he was sick");
    await whenIdle();
    const maria = await fetchSnapshot(await login("maria"), "1");
    expect(openFollowUps(maria, "1")).toEqual(["700:no5", "7:tr2"]);
    expect(maria.crm.missedNotes.find((x) => x.id === n.id)).toMatchObject({
      byId: "2",
      note: "Talked at the gym, he was sick",
    });
    removeMissedNote(n.id);
    await whenIdle();
    expect(await followUpsOf("maria")).toEqual(["4:ws2", "700:no5", "7:tr2"]);
  });

  it("Tasha can't leave a note about her upline: refused and rolled back", async () => {
    await signInApp("tasha");
    addMissedNote("4", "ws2", "He was busy");
    expect(useAttendanceStore.getState().missedNotes).toHaveLength(1);
    await whenIdle();
    expect(useAttendanceStore.getState().missedNotes).toHaveLength(0);
    const rows = await adminClient().from("missed_event_notes").select("id").eq("person_id", "4");
    expect(rows.data).toEqual([]);
  });
});
