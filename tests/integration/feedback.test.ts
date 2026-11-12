/**
 * The Feedback button against the local database: Jamal sends a report with a
 * snapshot from the app, he reads it back, an app admin reads the row and the
 * image and closes it, and nobody else (his upline) sees either. Needs the
 * local stack running and seeded.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { sendFeedback } from "@/data";
import { buildFeedbackContext } from "@/data/feedback/rules";
import { adminClient, must } from "./admin";

const PASSWORD = "demo-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const clients: SupabaseClient[] = [];
const ids: string[] = [];

async function login(email: string): Promise<SupabaseClient> {
  const c = createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  clients.push(c);
  return c;
}

/** A small stand-in for a JPEG (the bucket checks the type, not the bytes). */
const JPEG = new Uint8Array(2048).map((_, i) => (i === 0 ? 0xff : i === 1 ? 0xd8 : i % 251));

let jamal: SupabaseClient;
let anita: SupabaseClient;
let admin: SupabaseClient;

beforeAll(async () => {
  expect(IS_SUPABASE).toBe(true);
  jamal = await login("jamal@demo.test");
  anita = await login("anita@demo.test");
  admin = await login("admin@demo.test");
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
    const service = adminClient();
    for (const id of ids) {
      await must(service.storage.from("feedback").remove([`w1/${id}.jpg`]), "feedback image");
      await must(service.from("feedback").delete().eq("id", id), "feedback row");
    }
  } catch (e) {
    console.warn("[integration cleanup]", e);
  }
  await signOut();
  await Promise.all(clients.map((c) => c.auth.signOut({ scope: "local" })));
});

describe("feedback", () => {
  const id = crypto.randomUUID();

  it("sends a report with a snapshot from the app and reads it back", async () => {
    ids.push(id);
    await sendFeedback({
      id,
      message: "Show the phone number on the pipeline cards",
      context: testContext(),
      image: new Blob([JPEG], { type: "image/jpeg" }),
    });
    const row = await jamal.from("feedback").select("*").eq("id", id).single();
    expect(row.error).toBeNull();
    expect(row.data).toMatchObject({
      person_id: "4",
      workspace_id: "w1",
      message: "Show the phone number on the pipeline cards",
      screenshot_path: `w1/${id}.jpg`,
      status: "new",
    });
    expect(row.data?.context).toMatchObject({ path: "/pipeline", senderName: "Jamal Brown" });
    const own = await jamal.storage.from("feedback").download(`w1/${id}.jpg`);
    expect(own.error).toBeNull();
    expect(new Uint8Array(await own.data!.arrayBuffer())).toEqual(JPEG);
  });

  it("lets an app admin read the row and the image and close the report", async () => {
    const row = await admin.from("feedback").select("id, status, person_id").eq("id", id).single();
    expect(row.data).toEqual({ id, status: "new", person_id: "4" });
    const image = await admin.storage.from("feedback").download(`w1/${id}.jpg`);
    expect(image.error).toBeNull();
    expect(new Uint8Array(await image.data!.arrayBuffer())).toEqual(JPEG);

    const done = await admin.from("feedback").update({ status: "done" }).eq("id", id).select("id");
    expect(done.data).toEqual([{ id }]);
    const reopened = await admin
      .from("feedback")
      .update({ status: "new" })
      .eq("id", id)
      .select("status");
    expect(reopened.data).toEqual([{ status: "new" }]);
  });

  it("keeps it from the sender's upline, and the sender can't close it", async () => {
    const seen = await anita.from("feedback").select("id").eq("id", id);
    expect(seen.data).toEqual([]);
    const image = await anita.storage.from("feedback").download(`w1/${id}.jpg`);
    expect(image.error).not.toBeNull();
    const closed = await jamal
      .from("feedback")
      .update({ status: "done" })
      .eq("id", id)
      .select("id");
    expect(closed.data ?? []).toEqual([]);
  });

  it("sends a report without a snapshot", async () => {
    const plain = crypto.randomUUID();
    ids.push(plain);
    await sendFeedback({
      id: plain,
      message: "No picture this time",
      context: testContext(),
      image: null,
    });
    const row = await jamal
      .from("feedback")
      .select("screenshot_path, person_id")
      .eq("id", plain)
      .single();
    expect(row.data).toEqual({ screenshot_path: null, person_id: "4" });
  });
});

/** The context the app would save (the test run has no browser window, so fixed values). */
function testContext() {
  return buildFeedbackContext({
    path: "/pipeline",
    search: "",
    title: "Pipeline",
    width: 1440,
    height: 900,
    dark: false,
    userAgent: "vitest",
    brandSlug: "test",
    appVersion: "dev",
    now: new Date(),
    senderName: "Jamal Brown",
  });
}
