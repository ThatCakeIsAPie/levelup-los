/**
 * The library against the local database: what each role loads (visibility,
 * locked teasers, names), write-through of items / channels / progress, the
 * learning row the database logs once when an item is finished, and uploads
 * to the private `library` bucket read through signed URLs. Needs the local
 * stack running and seeded (`npm run db:reset`); cleans up after itself.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { useCrmStore } from "@/stores/crmStore";
import { useLibraryStore } from "@/data/library/store";
import { useLibraryExtras } from "@/data/library/extras";
import { libraryLearningId } from "@/data/library/mutations";
import {
  addCatalogItem,
  addItemsToChannel,
  createChannel,
  markLibraryItemDone,
  markLibraryItemNotDone,
  saveLibraryFile,
  saveLibraryPosition,
} from "@/data";
import { scheduleRefresh, whenIdle } from "@/data/remote";
import { fetchLibrary } from "@/data/remote/hydrate";
import { librarySignedUrl } from "@/data/remote/storage";

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
}

async function until<T>(fn: () => T | Promise<T>, what: string, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
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
  it("Jamal: team talks and his upline's downline channel; the IBO channel only as a teaser", async () => {
    const lib = await fetchLibrary(await login("jamal"));
    const items = new Set(lib.data.items.map((i) => i.id));
    expect(items.has("lib-1")).toBe(true);
    expect(items.has("lib-35")).toBe(true);
    expect(items.has("lib-28")).toBe(false);
    const channels = lib.data.channels.map((c) => c.id);
    expect(channels).toContain("booking-the-first-meeting");
    expect(channels).not.toContain("developing-leaders");
    expect(lib.extras.teasers.map((t) => [t.id, t.lessonCount])).toEqual([
      ["developing-leaders", 6],
    ]);
    // Channels come back with their sections and lessons in order.
    const rec = lib.data.channels.find((c) => c.id === "recruiting-a-to-z")!;
    expect(rec.sections.map((s) => s.title)).toEqual(["Basics", "Inviting", "The first meeting"]);
    expect(rec.sections[1].itemIds).toEqual(["lib-12", "lib-13", "lib-1", "lib-14"]);
    // Speakers and topics are attached; his progress only.
    const panel = lib.data.items.find((i) => i.id === "lib-27")!;
    expect(panel.speakers.map((s) => s.personId)).toEqual(["1", "2", "3"]);
    expect(panel.topicIds).toContain("t-leadership");
    expect(new Set(lib.data.progress.map((p) => p.personId))).toEqual(new Set(["4"]));
    expect(lib.data.progress.find((p) => p.itemId === "lib-1")?.positionSec).toBe(662);
  });

  it("Beau (candidate): team talks only, with the names of who gave them", async () => {
    const lib = await fetchLibrary(await login("beau"));
    const items = new Set(lib.data.items.map((i) => i.id));
    expect(items.has("lib-1")).toBe(true);
    expect(items.has("lib-35")).toBe(false);
    expect(items.has("lib-28")).toBe(false);
    expect(lib.data.channels.map((c) => c.id)).not.toContain("booking-the-first-meeting");
    expect(lib.extras.names["1"]).toBe("Maria Reyes");
    expect(lib.extras.teasers.map((t) => t.id)).toEqual(["developing-leaders"]);
  });

  it("Maria (leader): IBO-only talks too, no teasers", async () => {
    const lib = await fetchLibrary(await login("maria"));
    expect(lib.data.items.some((i) => i.id === "lib-28")).toBe(true);
    expect(lib.extras.teasers).toHaveLength(0);
  });

  it("signing in fills the library store", async () => {
    await signInApp("jamal");
    expect(useLibraryStore.getState().items.some((i) => i.id === "lib-35")).toBe(true);
    expect(useLibraryExtras.getState().teasers.map((t) => t.id)).toEqual(["developing-leaders"]);
  });
});

describe("progress and the learning log", () => {
  it("finishing a talk logs one learning row (the database's), shown at once in the app", async () => {
    await signInApp("jamal");
    const jamal = await login("jamal");
    const id = libraryLearningId("4", "lib-21");
    cleanup.push(() =>
      jamal.from("library_progress").delete().match({ person_id: "4", item_id: "lib-21" }),
    );
    cleanup.push(() => jamal.from("learning").delete().eq("id", id));

    saveLibraryPosition("lib-21", 300, 19 * 60);
    await whenIdle();
    const saved = await jamal
      .from("library_progress")
      .select("position_sec, completed_at")
      .match({ person_id: "4", item_id: "lib-21" })
      .single();
    expect(Number(saved.data?.position_sec)).toBe(300);
    expect(saved.data?.completed_at).toBeNull();

    const r = saveLibraryPosition("lib-21", 19 * 60 - 30, 19 * 60);
    expect(r).toEqual({ completedNow: true, logged: true });
    // The app shows the row at once, with the database's id.
    expect(useCrmStore.getState().learning.filter((l) => l.id === id)).toHaveLength(1);
    await whenIdle();
    const rows = await jamal.from("learning").select("id, kind, amount, title").eq("id", id);
    expect(rows.data).toEqual([
      { id, kind: "podcast", amount: 1, title: "Your first five customers" },
    ]);

    // Not done, done again: still one row, in the database and in the app.
    markLibraryItemNotDone("lib-21");
    await whenIdle();
    expect(markLibraryItemDone("lib-21").logged).toBe(false);
    await whenIdle();
    const again = await jamal.from("learning").select("id").like("id", "library:lib-21:%");
    expect(again.data).toHaveLength(1);
    scheduleRefresh(["crm", "library"], 0);
    await until(
      () =>
        useLibraryStore.getState().progress.find((p) => p.itemId === "lib-21")?.loggedAt
          ? true
          : null,
      "the refetched progress row",
    );
    expect(useCrmStore.getState().learning.filter((l) => l.id === id)).toHaveLength(1);
  });

  it("documents log their pages", async () => {
    await signInApp("jamal");
    const jamal = await login("jamal");
    const id = libraryLearningId("4", "lib-2");
    cleanup.push(() =>
      jamal.from("library_progress").delete().match({ person_id: "4", item_id: "lib-2" }),
    );
    cleanup.push(() => jamal.from("learning").delete().eq("id", id));
    expect(markLibraryItemDone("lib-2").logged).toBe(true);
    await whenIdle();
    const row = await jamal.from("learning").select("kind, amount").eq("id", id).single();
    expect(row.data).toEqual({ kind: "pages", amount: 4 });
  });
});

describe("sharing: uploads, signed URLs and channels", () => {
  it("Anita uploads a talk for her downline: Jamal gets a signed URL, Beau doesn't", async () => {
    await signInApp("anita");
    const anita = await login("anita");
    const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 5, 6, 7, 8]);
    const blob = new Blob([bytes], { type: "audio/wav" });
    const id = crypto.randomUUID();
    const path = await saveLibraryFile(blob, id);
    expect(path.startsWith(`w1/${id}/`)).toBe(true);
    cleanup.push(() => anita.storage.from("library").remove([path]));
    const res = addCatalogItem(
      {
        title: `IT talk ${stamp}`,
        kind: "audio",
        source: "upload",
        storagePath: path,
        mime: "audio/wav",
        sizeBytes: blob.size,
        fileName: "it.wav",
        durationSec: 1,
        speakers: [
          { personId: "2", name: null },
          { personId: null, name: "Guest Speaker" },
        ],
        format: "talk",
        topicIds: ["t-recruiting"],
        permissionConfirmed: true,
        visibility: "downline",
      },
      { id },
    );
    expect(res.ok).toBe(true);
    cleanup.push(() => anita.from("library_items").delete().eq("id", id));
    await whenIdle();

    const jamal = await login("jamal");
    const row = await jamal.from("library_items").select("storage_path").eq("id", id).single();
    expect(row.data?.storage_path).toBe(path);
    const speakers = await jamal
      .from("library_item_speakers")
      .select("position, person_id, name")
      .eq("item_id", id)
      .order("position");
    expect(speakers.data).toEqual([
      { position: 0, person_id: "2", name: null },
      { position: 1, person_id: null, name: "Guest Speaker" },
    ]);
    const url = await librarySignedUrl(jamal, path);
    expect(url).toBeTruthy();
    const got = await fetch(url!);
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    // Not in Anita's downline: no row, no URL.
    const beau = await login("beau");
    expect((await beau.from("library_items").select("id").eq("id", id)).data).toHaveLength(0);
    expect(await librarySignedUrl(beau, path)).toBeNull();
  });

  it("a channel with sections and ordered lessons reaches the database", async () => {
    await signInApp("anita");
    const anita = await login("anita");
    const made = createChannel({
      title: `IT channel ${stamp}`,
      icon: "rocket",
      color: "sky",
      visibility: "downline",
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    cleanup.push(() => anita.from("library_channels").delete().eq("id", made.value.id));
    addItemsToChannel(made.value.id, ["lib-35", "lib-1", "lib-2"]);
    await whenIdle();
    const jamal = await login("jamal");
    const lib = await fetchLibrary(jamal);
    const ch = lib.data.channels.find((c) => c.id === made.value.id);
    expect(ch?.sections.flatMap((s) => s.itemIds)).toEqual(["lib-35", "lib-1", "lib-2"]);
    // Not in Anita's downline: Beau doesn't get the channel.
    const beau = await login("beau");
    const forBeau = await fetchLibrary(beau);
    expect(forBeau.data.channels.some((c) => c.id === made.value.id)).toBe(false);
  });
});
