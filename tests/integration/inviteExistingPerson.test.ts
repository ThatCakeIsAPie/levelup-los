/**
 * Inviting a person who is already on the roster, against the local database:
 * an upline invites an apprentice who was added as a record (no member row, a
 * logged contact and a stage history), the invite is replaced and withdrawn
 * through the app's own calls, a crossline cannot create one, the wrong
 * account cannot claim the record, and the invited account - arriving the way
 * the emailed link brings them, with session tokens in the URL fragment -
 * accepts and then loads the app as THAT person: the same id, sponsor, history
 * and contact, with no second record. The email itself is not sent here (CI
 * runs without the mail catcher); the link is made with the admin API.
 * Needs the local stack running and seeded; removes everything it creates.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { acceptInvite, fetchInvite } from "@/modules/invites/api";
import { parseLinkTokens, sessionFromLinkHash } from "@/modules/invites/emailLink";
import {
  createPersonInvite,
  deletePersonInvites,
  fetchPersonInviteState,
} from "@/modules/invites/personInviteApi";
import { usePeopleStore } from "@/stores/peopleStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useRemoteStore } from "@/data/remote";
import { adminClient, must } from "./admin";

const PASSWORD = "demo-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const stamp = Date.now().toString(36);

const PERSON = `inv-${stamp}`;
const NAME = `Ivy Invited ${stamp}`;
const EMAIL = `ivy.${stamp}@invite.test`;
const OTHER_EMAIL = `other.${stamp}@invite.test`;

const clients: SupabaseClient[] = [];
const userIds: string[] = [];

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

/** Sign the app itself in (its own client, the sync layer and the stores). */
async function signInApp(email: string): Promise<void> {
  await signOut();
  const { error } = await getSupabase().auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  await refreshAccount();
}

async function createUser(email: string, password?: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("no user");
  userIds.push(data.user.id);
  return data.user.id;
}

/**
 * What opening the emailed link in the invitee's own browser does: the auth
 * server verifies it and redirects to the app with the session in the URL
 * fragment. (Made with the admin API: no mail is sent in CI.)
 */
async function linkHashFor(email: string, token: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `http://localhost:5173/auth/callback?invite=${token}` },
  });
  if (error || !data.properties?.action_link) throw error ?? new Error("no link");
  const res = await fetch(data.properties.action_link, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  expect(location).toContain(`/auth/callback?invite=${token}#`);
  return location.slice(location.indexOf("#"));
}

async function unusedInvites(): Promise<
  { token: string; email: string; sponsor_person_id: string | null }[]
> {
  const { data, error } = await adminClient()
    .from("invites")
    .select("token, email, sponsor_person_id")
    .eq("person_id", PERSON)
    .is("used_at", null);
  if (error) throw error;
  return data ?? [];
}

beforeAll(async () => {
  expect(IS_SUPABASE).toBe(true);
  const a = adminClient();
  // A person added as a record: an apprentice under Anita, no email, no member row, one contact.
  await must(
    a.from("people").insert({
      id: PERSON,
      workspace_id: "w1",
      name: NAME,
      biz_class: "apprentice",
      pipeline_stage: "apprentice",
      sponsor_id: "2",
      business_start_date: "2026-09-01",
      stage_history: [
        { stage: "prospect", at: "2026-08-01T00:00:00.000Z" },
        { stage: "apprentice", at: "2026-09-01T00:00:00.000Z" },
      ],
    }),
    "add person",
  );
  await must(
    a.from("contacts").insert({
      id: `c-${PERSON}`,
      workspace_id: "w1",
      person_id: PERSON,
      by_id: "2",
      note: "met at the expo",
    }),
    "add contact",
  );
  expect((await a.from("members").select("person_id").eq("person_id", PERSON)).data).toEqual([]);
});

afterAll(async () => {
  const a = adminClient();
  const steps: [string, PromiseLike<{ error: { message: string } | null }>][] = [
    ["invites", a.from("invites").delete().eq("person_id", PERSON)],
    ["activity", a.from("activity").delete().eq("related_person_id", PERSON)],
    ["person", a.from("people").delete().eq("id", PERSON)],
  ];
  for (const [what, q] of steps) {
    try {
      await must(q, what);
    } catch (e) {
      console.warn("[integration cleanup]", e);
    }
  }
  for (const id of userIds) await a.auth.admin.deleteUser(id).catch(() => undefined);
  await signOut();
  await Promise.all(clients.map((c) => c.auth.signOut({ scope: "local" })));
});

describe("inviting an existing person", () => {
  it("the upline invites through the app's calls; a new invite replaces the old; withdrawing works", async () => {
    await signInApp("maria@demo.test");
    expect(await fetchPersonInviteState(PERSON)).toEqual({ hasLogin: false, invite: null });

    const first = await createPersonInvite(PERSON, EMAIL);
    expect(first.error).toBeNull();
    expect(first.invite?.email).toBe(EMAIL);
    const second = await createPersonInvite(PERSON, EMAIL);
    expect(second.invite?.token).not.toBe(first.invite?.token);

    const open = await unusedInvites();
    expect(open).toHaveLength(1); // the first was withdrawn by the second
    expect(open[0]).toMatchObject({
      token: second.invite?.token,
      email: EMAIL,
      sponsor_person_id: "2",
    });
    const state = await fetchPersonInviteState(PERSON);
    expect(state.hasLogin).toBe(false);
    expect(state.invite?.token).toBe(second.invite?.token);

    expect(await deletePersonInvites(PERSON)).toBeNull();
    expect(await unusedInvites()).toHaveLength(0);
    expect((await fetchPersonInviteState(PERSON)).invite).toBeNull();
  });

  it("someone who is not upline of the person cannot invite them", async () => {
    // Jamal is under Anita too, but the person is not in his downline.
    const jamal = await login("jamal");
    const r = await jamal.from("invites").insert({ person_id: PERSON, email: EMAIL });
    expect(r.error?.code).toBe("42501");
    // Nor can a candidate.
    const beau = await login("beau");
    expect(
      (await beau.from("invites").insert({ person_id: PERSON, email: EMAIL })).error?.code,
    ).toBe("42501");
    expect(await unusedInvites()).toHaveLength(0);
  });

  it("the anonymous preview shows the person's own name and a masked email only", async () => {
    await signInApp("maria@demo.test");
    const { invite } = await createPersonInvite(PERSON, EMAIL);
    await signOut();
    const { preview } = await fetchInvite(invite!.token);
    expect(preview).toMatchObject({
      for_person: true,
      name: NAME,
      sponsor_name: "Anita Patel",
      stage: "apprentice",
      is_valid: true,
    });
    expect(preview?.email).toBe(`i***@invite.test`);
    expect(JSON.stringify(preview)).not.toContain(EMAIL);
  });

  it("the wrong account cannot claim the record; the invited one signs in to the same person", async () => {
    const token = (await unusedInvites())[0].token;
    const peopleBefore = (
      await adminClient().from("people").select("id", { count: "exact", head: true })
    ).count;

    // Another confirmed account is refused, and nothing is used.
    await createUser(OTHER_EMAIL, PASSWORD);
    await signOut();
    const wrong = await getSupabase().auth.signInWithPassword({
      email: OTHER_EMAIL,
      password: PASSWORD,
    });
    expect(wrong.error).toBeNull();
    const refused = await acceptInvite(token);
    expect(refused.failure).toBe("wrongEmail");
    expect(await unusedInvites()).toHaveLength(1);
    await signOut();

    // The invited account arrives the way the emailed link brings it.
    await createUser(EMAIL);
    const hash = await linkHashFor(EMAIL, token);
    expect(parseLinkTokens(hash)).not.toBeNull();
    expect(await sessionFromLinkHash(hash)).toBe("");
    const accepted = await acceptInvite(token);
    expect(accepted.error).toBeNull();
    expect(accepted.personId).toBe(PERSON);

    // No second record, the member row is theirs, the invite is used.
    const a = adminClient();
    expect((await a.from("people").select("id", { count: "exact", head: true })).count).toBe(
      peopleBefore,
    );
    expect((await a.from("people").select("id").eq("name", NAME)).data).toEqual([{ id: PERSON }]);
    const member = (await a.from("members").select("user_id, role").eq("person_id", PERSON)).data;
    expect(member).toEqual([{ user_id: userIds[userIds.length - 1], role: "member" }]);
    expect(await unusedInvites()).toHaveLength(0);
    expect((await a.from("people").select("email").eq("id", PERSON).single()).data?.email).toBe(
      EMAIL,
    );

    // Loaded as that person, the app shows the existing record.
    expect(await refreshAccount()).toBe("ready");
    expect(useRemoteStore.getState().phase).toBe("ready");
    expect(useSessionStore.getState().user?.personId).toBe(PERSON);
    const me = usePeopleStore.getState().people.find((p) => p.id === PERSON);
    expect(me).toMatchObject({ name: NAME, sponsorId: "2", bizClass: "apprentice", email: EMAIL });
    expect(me?.stageHistory?.map((s) => s.stage)).toEqual(["prospect", "apprentice"]);
    expect(
      (await getSupabase().from("contacts").select("note").eq("person_id", PERSON)).data,
    ).toEqual([{ note: "met at the expo" }]);
    const joined = await a
      .from("activity")
      .select("summary")
      .eq("related_person_id", PERSON)
      .eq("summary", "Joined from an invite link");
    expect(joined.data).toHaveLength(1);
  });

  it("the used link cannot be used again, and nobody can invite a person who signs in", async () => {
    await signInApp("maria@demo.test");
    expect((await fetchPersonInviteState(PERSON)).hasLogin).toBe(true);
    const again = await createPersonInvite(PERSON, EMAIL);
    expect(again.invite).toBeNull();
    expect(again.error).toMatch(/can't invite/i);
  });
});
