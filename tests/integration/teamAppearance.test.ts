/**
 * The team's look against the local database: the leader saves a background
 * picture, glass, a logo and colours through the app (pictures uploaded to the
 * public `team-appearance` bucket, then `set_workspace_appearance()`), a member
 * loads the app data and gets the same look, a member cannot change it, a
 * replaced picture's file is removed, and reset clears everything.
 * Needs the local stack running and seeded (`npm run db:reset`).
 *
 * Maria (1) is the workspace leader, Marcus (6) her deputy, Jamal (4) a member.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { teamImageUrl } from "@/lib/teamLook";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { getTeamLook, resetTeamLook, saveTeamLook, defaultLook } from "@/data";
import { isLookPath } from "@/data/teamLook/rules";
import { fetchSnapshot } from "@/data/remote/hydrate";
import type { Encoded } from "@/lib/pictureFiles";
import { adminClient, must } from "./admin";

const PASSWORD = "demo-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const BUCKET = "team-appearance";

const clients: SupabaseClient[] = [];

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

/** Stand-ins for the pictures the browser would have prepared (the bucket checks the type, not the bytes). */
const picture = (mime: Encoded["mime"], first: number[], size = 3000): Encoded => ({
  blob: new Blob([new Uint8Array(size).map((_, i) => first[i] ?? i % 251)], { type: mime }),
  mime,
  width: 1600,
  height: 900,
});
const JPEG = () => picture("image/jpeg", [0xff, 0xd8, 0xff]);
const WEBP = () =>
  picture("image/webp", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const PNG = () => picture("image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 1200);

const COLORS = { main: "#0f766e", highlight: "#e3c271", sidebar: "#0b2b26" };

const service = () => adminClient();

async function filesInBucket(): Promise<string[]> {
  const { data, error } = await service().storage.from(BUCKET).list("w1", { limit: 100 });
  if (error) throw error;
  return (data ?? []).map((o) => `w1/${o.name}`);
}

/** Put the workspace back as the seed has it (and empty the bucket): db:test runs after this file. */
async function restore(): Promise<void> {
  await must(
    service()
      .from("workspaces")
      .update({
        background_mode: "default",
        background_path: null,
        glass: null,
        logo_path: null,
        colors: {},
      })
      .eq("id", "w1"),
    "workspace look",
  );
  const files = await filesInBucket();
  if (files.length)
    await must(service().storage.from(BUCKET).remove(files), "team-appearance files");
}

beforeAll(async () => {
  expect(IS_SUPABASE).toBe(true);
  await restore();
});

afterAll(async () => {
  try {
    await restore();
  } catch (e) {
    console.warn("[integration cleanup]", e);
  }
  await signOut();
  await Promise.all(clients.map((c) => c.auth.signOut({ scope: "local" })));
});

describe("the team's look", () => {
  let backgroundPath = "";
  let logoPath = "";

  it("starts as the brand's own look for a member", async () => {
    const snap = await fetchSnapshot(await login("jamal"), "4");
    expect(snap.crm.look?.workspaceId).toBe("w1");
    expect(snap.crm.look?.look).toEqual(defaultLook());
  });

  it("the leader saves a picture, glass, a logo and colours through the app", async () => {
    await signInApp("maria");
    await saveTeamLook(
      {
        background: "picture",
        backgroundPath: null,
        glass: true,
        logoPath: null,
        colors: COLORS,
      },
      { background: JPEG(), logo: PNG() },
    );
    const saved = getTeamLook();
    expect(saved).toMatchObject({ background: "picture", glass: true, colors: COLORS });
    backgroundPath = saved.backgroundPath!;
    logoPath = saved.logoPath!;
    expect(isLookPath(backgroundPath, "w1", "bg")).toBe(true);
    expect(backgroundPath).toMatch(/^w1\/bg-[0-9a-f]{32}\.jpg$/);
    expect(isLookPath(logoPath, "w1", "logo")).toBe(true);
    expect(logoPath).toMatch(/^w1\/logo-[0-9a-f]{32}\.png$/);

    const { data } = await service()
      .from("workspaces")
      .select("background_mode, background_path, glass, logo_path, colors")
      .eq("id", "w1")
      .single();
    expect(data).toEqual({
      background_mode: "picture",
      background_path: backgroundPath,
      glass: true,
      logo_path: logoPath,
      colors: COLORS,
    });
    expect((await filesInBucket()).sort()).toEqual([backgroundPath, logoPath].sort());
  });

  it("the pictures load by their public URL, with no sign-in", async () => {
    const url = teamImageUrl(backgroundPath)!;
    expect(url).toBe(
      getSupabase().storage.from(BUCKET).getPublicUrl(backgroundPath).data.publicUrl,
    );
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/jpeg");
    expect((await res.arrayBuffer()).byteLength).toBe(3000);
    // A path nobody uploaded is not there.
    const missing = await fetch(teamImageUrl("w1/bg-00000000000000000000000000000000.jpg")!);
    expect(missing.status).toBeGreaterThanOrEqual(400);
  });

  it("a member loads the app data and gets the same look", async () => {
    const snap = await fetchSnapshot(await login("jamal"), "4");
    expect(snap.crm.look?.look).toEqual({
      background: "picture",
      backgroundPath,
      glass: true,
      logoPath,
      colors: COLORS,
    });
    // A deputy too: the look is the team's, not the viewer's.
    const marcus = await fetchSnapshot(await login("marcus"), "6");
    expect(marcus.crm.look?.look.backgroundPath).toBe(backgroundPath);
  });

  it("a member and a deputy cannot change it, by the app, the function, a direct update or an upload", async () => {
    for (const [name, person] of [
      ["jamal", "4"],
      ["marcus", "6"],
      ["anita", "2"],
    ] as const) {
      const c = await login(name);
      const rpc = await c.rpc("set_workspace_appearance", { p_background: "none" });
      expect(rpc.error?.code, `${name} rpc`).toBe("42501");
      const direct = await c.from("workspaces").update({ background_mode: "none" }).eq("id", "w1");
      expect(direct.error, `${name} update`).not.toBeNull();
      const up = await c.storage
        .from(BUCKET)
        .upload(`w1/bg-ffffffffffffffffffffffffffffffff.jpg`, JPEG().blob, {
          contentType: "image/jpeg",
        });
      expect(up.error, `${name} upload`).not.toBeNull();
      const list = await c.storage.from(BUCKET).list("w1");
      expect(list.data ?? [], `${name} list`).toHaveLength(0);
      const snap = await fetchSnapshot(c, person);
      expect(snap.crm.look?.look.background).toBe("picture");
    }
    // Through the app as a member.
    await signInApp("jamal");
    await expect(saveTeamLook(defaultLook())).rejects.toThrow(/leader/);
    expect(getTeamLook().background).toBe("picture");
  });

  it("the leader cannot upload an SVG, another folder, or a made-up file name", async () => {
    const maria = await login("maria");
    const bucket = maria.storage.from(BUCKET);
    const svg = await bucket.upload(
      "w1/bg-ffffffffffffffffffffffffffffffff.svg",
      new Blob(["<svg/>"], { type: "image/svg+xml" }),
      {
        contentType: "image/svg+xml",
      },
    );
    expect(svg.error).not.toBeNull();
    const other = await bucket.upload("w2/bg-ffffffffffffffffffffffffffffffff.jpg", JPEG().blob, {
      contentType: "image/jpeg",
    });
    expect(other.error).not.toBeNull();
    const named = await bucket.upload("w1/holiday.jpg", JPEG().blob, { contentType: "image/jpeg" });
    expect(named.error).not.toBeNull();
    const ok = await bucket.upload("w1/bg-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.jpg", JPEG().blob, {
      contentType: "image/jpeg",
    });
    expect(ok.error).toBeNull();
    // An uploaded file is not part of the look until the function says so; a path that was never uploaded is refused.
    const never = await maria.rpc("set_workspace_appearance", {
      p_background: "picture",
      p_background_path: "w1/bg-dddddddddddddddddddddddddddddddd.jpg",
    });
    expect(never.error?.code).toBe("P0002");
    const bad = await maria.rpc("set_workspace_appearance", {
      p_background: "none",
      p_main: "red",
    });
    expect(bad.error?.code).toBe("22023");
    await must(
      service().storage.from(BUCKET).remove(["w1/bg-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.jpg"]),
      "stray test file",
    );
  });

  it("replacing the picture removes the old file", async () => {
    await signInApp("maria");
    const before = getTeamLook();
    await saveTeamLook(before, { background: WEBP() });
    const after = getTeamLook();
    expect(after.backgroundPath).not.toBe(before.backgroundPath);
    expect(after.backgroundPath).toMatch(/\.webp$/);
    expect(after.logoPath).toBe(logoPath);
    expect((await filesInBucket()).sort()).toEqual([after.backgroundPath, logoPath].sort());
    backgroundPath = after.backgroundPath!;
  });

  it("turning the picture off and the logo back to the default removes both files", async () => {
    await saveTeamLook({
      ...getTeamLook(),
      background: "none",
      backgroundPath: null,
      glass: false,
      logoPath: null,
    });
    expect(await filesInBucket()).toEqual([]);
    expect(getTeamLook()).toMatchObject({
      background: "none",
      backgroundPath: null,
      glass: false,
      logoPath: null,
      colors: COLORS,
    });
  });

  it("reset clears every choice", async () => {
    await saveTeamLook(
      { ...getTeamLook(), background: "picture", backgroundPath: null },
      { background: JPEG() },
    );
    expect((await filesInBucket()).length).toBe(1);
    await resetTeamLook();
    expect(getTeamLook()).toEqual(defaultLook());
    expect(await filesInBucket()).toEqual([]);
    const snap = await fetchSnapshot(await login("jamal"), "4");
    expect(snap.crm.look?.look).toEqual(defaultLook());
  });
});
