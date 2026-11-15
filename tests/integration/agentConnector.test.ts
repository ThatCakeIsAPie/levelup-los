/**
 * The agent connector against the local database, through the real function logic: a person pairs an
 * agent in the app (an RPC as that person), the agent redeems the code at /pair and calls tools at
 * /tools/<name>, over a REAL connection logged in as the `agent_connector` role (the pgTAP tests
 * cannot log in as it). Needs the local stack running and seeded; the Edge Function's Deno entry is
 * the only piece not exercised (supabase/functions/agent/index.ts: it just wires these modules).
 *
 * The role is NOLOGIN in the migration (a deployment sets its password outside the repository): the
 * test gives it a throwaway password and takes the login away again afterwards.
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler } from "../../supabase/functions/agent/app.ts";
import { createPostgresDb, type SqlClient } from "../../supabase/functions/agent/pg.ts";

const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const ADMIN_DB =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const BASE = `${URL_}/functions/v1/agent`;
const PASSWORD = "demo-local";

let admin: postgres.Sql;
let connector: postgres.Sql;
let handle: (r: Request) => Promise<Response>;
let jamal: SupabaseClient;
const addedPeople: string[] = [];

async function login(email: string): Promise<SupabaseClient> {
  const c = createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return c;
}

const post = (path: string, body: unknown, key?: string, ip = "198.51.100.20") =>
  handle(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
const get = (path: string, key: string) =>
  handle(new Request(`${BASE}${path}`, { headers: { authorization: `Bearer ${key}` } }));

/** Pairing as Jamal in the app, then the agent's /pair: returns its key and connection id. */
async function connect(access: "read" | "write", label: string) {
  const { data, error } = await jamal.rpc("create_agent_pairing", { p_access: access });
  expect(error).toBeNull();
  const res = await post("/pair", { code: data.code, label });
  expect(res.status).toBe(201);
  const j = await res.json();
  return { key: j.connection_key as string, id: j.connection.id as string, reply: j };
}

async function count(query: string, ...params: string[]): Promise<number> {
  const rows = await admin.unsafe(query, params);
  return Number(rows[0].n);
}

beforeAll(async () => {
  admin = postgres(ADMIN_DB, { max: 2, prepare: false, onnotice: () => {} });
  const pw = randomBytes(16).toString("hex");
  await admin.unsafe(`alter role agent_connector with login password '${pw}'`);
  const u = new URL(ADMIN_DB);
  u.username = "agent_connector";
  u.password = pw;
  connector = postgres(u.toString(), { max: 3, prepare: false, onnotice: () => {} });
  handle = createHandler({
    db: createPostgresDb(connector as unknown as SqlClient),
    baseUrl: BASE,
  });
  await admin.unsafe(
    "insert into public.feature_switches (workspace_id, feature, enabled) values ('w1', 'agents', true) on conflict (workspace_id, feature) do update set enabled = true",
  );
  jamal = await login("jamal@demo.test");
});

afterAll(async () => {
  try {
    for (const id of addedPeople)
      await admin.unsafe("delete from public.people where id = $1", [id]);
    await admin.unsafe("delete from public.agent_audit");
    await admin.unsafe("delete from public.agent_connections");
    await admin.unsafe("delete from public.agent_pairings");
    await admin.unsafe("delete from public.agent_pair_attempts");
    await admin.unsafe("delete from public.feature_switches where feature = 'agents'");
    await admin.unsafe("alter role agent_connector with nologin password null");
  } finally {
    await connector?.end({ timeout: 5 });
    await admin?.end({ timeout: 5 });
  }
});

describe("the connector role, logged in for real", () => {
  it("is refused every table and every tool function when it does not `set role`", async () => {
    await expect(connector.unsafe("select count(*) from public.people")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      connector.unsafe("select count(*) from public.agent_connections"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      connector.unsafe("select count(*) from public.agent_pairings"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(connector.unsafe("select public.agent_whoami()")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      connector.unsafe("select agent_private.access_for(gen_random_uuid())"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(connector.unsafe("select agent_private.ctx(false)")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("is a session_user the guard recognises, and the people it acts as are not", async () => {
    const [who] = await connector.unsafe("select session_user as s, current_user as c");
    expect(who).toEqual({ s: "agent_connector", c: "agent_connector" });
    const rows = await connector.begin(async (tx) => {
      await tx.unsafe(
        "select set_config('request.jwt.claims', '{\"role\":\"authenticated\"}', true)",
      );
      await tx.unsafe("set local role authenticated");
      return await tx.unsafe("select session_user as s, current_user as c");
    });
    expect(rows[0]).toEqual({ s: "agent_connector", c: "authenticated" });
  });
});

describe("an ordinary signed-in session", () => {
  it("is refused every agent_ function through the Data API", async () => {
    for (const [fn, args] of [
      ["agent_whoami", {}],
      ["agent_list_prospects", {}],
      ["agent_list_team", {}],
      ["agent_list_customers", {}],
      ["agent_get_person", { p_id: "4" }],
      ["agent_update_my_profile", { p_patch: { phone: "1" } }],
      ["agent_log_learning", { p_kind: "workshop" }],
      ["agent_list_learning", {}],
      ["agent_add_prospect", { p_name: "Sneaky" }],
      ["agent_update_prospect", { p_id: "x", p_patch: { notes: "n" } }],
      ["agent_list_upcoming_events", {}],
      ["agent_export_events_ics", {}],
      ["agent_set_event_answer", { p_event_id: "x", p_answer: "yes" }],
      ["agent_list_cards", {}],
      ["agent_get_card", { p_person_id: "x" }],
      ["agent_list_card_tasks", {}],
      ["agent_add_card_task", { p_person_id: "x", p_title: "Sneaky" }],
      ["agent_update_card_task", { p_task_id: "x", p_patch: { title: "n" } }],
      ["agent_complete_card_task", { p_task_id: "x" }],
      ["agent_add_card_note", { p_person_id: "x", p_body: "Sneaky" }],
    ] as const) {
      const { error } = await jamal.rpc(fn, args);
      expect(error?.code, fn).toBe("42501");
    }
    expect(await count("select count(*)::int as n from public.agent_audit")).toBe(0);
  });

  it("cannot read the key hash or write the new tables", async () => {
    await connect("read", "Probe");
    const own = await jamal.from("agent_connections").select("id, label, access, revoked_at");
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    expect((await jamal.from("agent_connections").select("key_hash")).error?.code).toBe("42501");
    expect((await jamal.from("agent_connections").select("*")).error?.code).toBe("42501");
    expect((await jamal.from("agent_pairings").select("id")).error?.code).toBe("42501");
    expect(
      (await jamal.from("agent_connections").update({ access: "write" }).eq("id", own.data![0].id))
        .error?.code,
    ).toBe("42501");
    await admin.unsafe("delete from public.agent_connections");
  });
});

describe("pairing and the tools", () => {
  it("pairs once, then the agent works as Jamal and no further than he can see", async () => {
    const { data: pairing } = await jamal.rpc("create_agent_pairing", { p_access: "write" });
    expect(pairing.code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    const first = await post("/pair", { code: pairing.code, label: "Test agent" });
    const second = await post("/pair", { code: pairing.code, label: "Again" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(403);
    const reply = await first.json();
    const key = reply.connection_key as string;
    expect(await count("select count(*)::int as n from public.agent_connections")).toBe(1);
    expect(
      await count(
        "select count(*)::int as n from public.agent_connections where key_hash = encode(sha256(convert_to($1, 'utf8')), 'hex')",
        key,
      ),
    ).toBe(1);
    expect(reply.connection).toMatchObject({
      connected_as_person: "Jamal Brown",
      access: "write",
      label: "Test agent",
    });

    // whoami
    const who = await (await post("/tools/whoami", {}, key)).json();
    expect(who.result.person.name).toBe("Jamal Brown");
    expect(who.result.access).toBe("write");

    // the prospects the agent sees are exactly the ones Jamal's own session sees
    const mine = await jamal.from("people").select("id").eq("biz_class", "prospect");
    const seen = (await (await post("/tools/list_prospects", { limit: 200 }, key)).json()).result
      .prospects as { id: string }[];
    expect(seen.map((p) => p.id).sort()).toEqual((mine.data ?? []).map((p) => p.id).sort());

    // one he cannot see: refused, and nothing changes
    const all = await admin.unsafe(
      "select id, notes from public.people where biz_class = 'prospect'",
    );
    const hidden = all.find((p) => !seen.some((s) => s.id === p.id));
    expect(hidden, "the seed has a prospect outside Jamal's view").toBeDefined();
    const refused = await post(
      "/tools/update_prospect",
      { id: hidden!.id, notes: "agent was here" },
      key,
    );
    expect(refused.status).toBe(422);
    const [after] = await admin.unsafe("select notes from public.people where id = $1", [
      hidden!.id,
    ]);
    expect(after.notes).toBe(hidden!.notes);

    // add and change one of his own; counts before and after
    const before = await count(
      "select count(*)::int as n from public.people where biz_class = 'prospect'",
    );
    const added = await (
      await post("/tools/add_prospect", { name: "Integration Prospect", phone: "555-0100" }, key)
    ).json();
    expect(added.ok).toBe(true);
    addedPeople.push(added.result.id);
    expect(
      await count("select count(*)::int as n from public.people where biz_class = 'prospect'"),
    ).toBe(before + 1);
    const [row] = await admin.unsafe(
      "select sponsor_id, biz_class from public.people where id = $1",
      [added.result.id],
    );
    expect(row).toEqual({ sponsor_id: "4", biz_class: "prospect" });
    const upd = await (
      await post(
        "/tools/update_prospect",
        { id: added.result.id, notes: "called", email: "pat@example.com" },
        key,
      )
    ).json();
    expect(upd.result).toMatchObject({ notes: "called", email: "pat@example.com" });
    const bad = await post("/tools/update_prospect", { id: added.result.id, sponsor_id: "1" }, key);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("sponsor_id: not a field of update_prospect");

    // events (iCalendar's terms) and the person's own answer
    const until = new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10);
    const list = (await (await post("/tools/list_upcoming_events", { until }, key)).json())
      .result as {
      from: string;
      until: string;
      timezone: string;
      events: {
        id: string;
        uid: string;
        summary: string;
        all_day: boolean;
        last_modified: string;
        my_answer: string | null;
        partstat: string;
      }[];
      series: { series_uid: string; rrule: string; exdates: string[] }[];
    };
    const events = list.events;
    expect(events.length).toBeGreaterThan(0);
    expect(list.timezone).toMatch(/^[A-Za-z_]+\/[A-Za-z_]+/);
    for (const e of events) {
      expect(e.uid).toMatch(/@events\.invalid$/);
      expect(e.summary).toBeTruthy();
      expect(e.last_modified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(["ACCEPTED", "DECLINED", "TENTATIVE", "NEEDS-ACTION"]).toContain(e.partstat);
    }
    for (const s of list.series) {
      expect(s.series_uid).toMatch(/@series\.invalid$/);
      expect(s.rrule).toMatch(/^FREQ=(DAILY|WEEKLY|MONTHLY)/);
      expect(Array.isArray(s.exdates)).toBe(true);
    }
    // the same window as a file, and what changed since a far-off time (nothing), and a refused window
    const ics = (await (await post("/tools/export_events_ics", { until }, key)).json())
      .result as string;
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
    expect(ics).toMatch(/END:VCALENDAR\r\n$/);
    expect(ics.match(/BEGIN:VEVENT/g)?.length ?? 0).toBeGreaterThan(0);
    for (const e of events.filter((x) => !("series_uid" in x)))
      expect(ics).toContain(`UID:${e.uid}`);
    const none = (
      await (
        await post("/tools/list_upcoming_events", { changed_since: "2999-01-01T00:00:00Z" }, key)
      ).json()
    ).result as { events: unknown[] };
    expect(none.events).toEqual([]);
    const refusedWindow = await post(
      "/tools/list_upcoming_events",
      { from: "2026-11-10", until: "2026-11-09" },
      key,
    );
    expect(refusedWindow.status).toBe(422);
    expect((await refusedWindow.json()).error).toBe("until must not be before from.");
    const ev = events[0];
    const [seeded] = await admin.unsafe(
      "select desire_to_attend from public.attendances where event_id = $1 and person_id = '4'",
      [ev.id],
    );
    const set = await (
      await post("/tools/set_event_answer", { event_id: ev.id, answer: "maybe" }, key)
    ).json();
    expect(set.result).toMatchObject({ event_id: ev.id, answer: "maybe" });
    expect(
      await count(
        "select count(*)::int as n from public.attendances where event_id = $1 and person_id = '4' and desire_to_attend = 'maybe'",
        ev.id,
      ),
    ).toBe(1);
    // put back what the seed had for that event
    if (seeded)
      await admin.unsafe(
        "update public.attendances set desire_to_attend = $2 where event_id = $1 and person_id = '4'",
        [ev.id, seeded.desire_to_attend],
      );
    else
      await admin.unsafe("delete from public.attendances where event_id = $1 and person_id = '4'", [
        ev.id,
      ]);

    // exactly one audit row per call that reached a tool, and one for the update refused for its
    // arguments (a field outside the whitelist leaves a trace)
    const tools = await admin.unsafe(
      "select tool, result from public.agent_audit where connection_id = $1 order by id",
      [reply.connection.id],
    );
    expect(tools.map((t) => t.tool)).toEqual([
      "whoami",
      "list_prospects",
      "update_prospect",
      "add_prospect",
      "update_prospect",
      "update_prospect",
      "list_upcoming_events",
      "export_events_ics",
      "list_upcoming_events",
      "list_upcoming_events",
      "set_event_answer",
    ]);
    expect(tools[2].result).toMatch(/^refused: no such prospect/);
    expect(tools[5].result).toMatch(/^refused: Invalid arguments: sponsor_id: not a field/);
    // and Jamal reads them through the Data API, the details included
    const mineAudit = await jamal
      .from("agent_audit")
      .select("tool, arguments")
      .eq("tool", "add_prospect");
    expect(mineAudit.data).toHaveLength(1);

    // the key is refused anywhere else
    expect((await handle(new Request(`${BASE}/tools`))).status).toBe(401);
    expect((await get("/tools", key.slice(0, -1) + "x")).status).toBe(401);
    const rest = await fetch(`${URL_}/rest/v1/people?select=id`, {
      headers: { apikey: KEY, authorization: `Bearer ${key}` },
    });
    expect(rest.status).toBeGreaterThanOrEqual(400);
    const authApi = await fetch(`${URL_}/auth/v1/user`, {
      headers: { apikey: KEY, authorization: `Bearer ${key}` },
    });
    expect(authApi.status).toBeGreaterThanOrEqual(400);
  });

  it("lists the team, looks one person up, changes only the own profile and logs learning, as Jamal", async () => {
    const { key, id } = await connect("write", "People agent");
    let calls = 0;
    const bodies: string[] = [];
    const call = async (tool: string, args: unknown) => {
      calls++;
      const res = await post(`/tools/${tool}`, args, key);
      const text = await res.text();
      bodies.push(text);
      return { status: res.status, json: JSON.parse(text) };
    };

    // list_team is exactly Jamal's registered downline, with levels
    const team = (await call("list_team", { limit: 200 })).json.result as {
      total: number;
      team: { id: string; level: number; full_name: string; stage: string }[];
      note?: string;
    };
    const expected = await admin.unsafe(
      `with recursive d (id, level) as (
         select id, 1 from public.people where sponsor_id = '4' and biz_class <> 'customer'
         union
         select p.id, d.level + 1 from public.people p join d on p.sponsor_id = d.id where p.biz_class <> 'customer')
       select d.id, d.level from d join public.people p on p.id = d.id
        where public.effective_biz_class(p.biz_class, p.business_start_date) in ('apprentice', 'ibo')
        order by 2, 1`,
    );
    expect(team.total).toBe(expected.length);
    expect(
      team.team.map((t) => `${t.id}:${t.level}`).sort(),
      "the agent's team is Jamal's downline, level by level",
    ).toEqual(expected.map((r) => `${r.id}:${r.level}`).sort());
    expect(team.team.every((t) => t.id !== "4" && ["apprentice", "ibo"].includes(t.stage))).toBe(
      true,
    );
    if (expected.length === 0)
      expect(team.note).toBe("You have no registered team members under you yet.");
    const mine = await call("list_customers", {});
    const customers = mine.json.result as { total: number; customers: { owner_id: string }[] };
    expect(customers.customers.every((c) => c.owner_id === "4")).toBe(true);

    // get_person: himself, a person of his team, and one he cannot see
    const self = (await call("get_person", { id: "4" })).json.result;
    expect(self).toMatchObject({ id: "4", kind: "self", full_name: "Jamal Brown" });
    if (team.team.length) {
      const first = team.team[0];
      const one = (await call("get_person", { id: first.id })).json.result;
      expect(one).toMatchObject({ id: first.id, kind: "team", level: first.level });
    }
    const visible = new Set<string>(["4", ...team.team.map((t) => t.id)]);
    const seenIds = [...visible];
    const [stranger] = await admin.unsafe(
      `select id from public.people where biz_class in ('apprentice', 'ibo') and id not in (${seenIds
        .map((_, i) => `$${i + 1}`)
        .join(", ")}) limit 1`,
      seenIds,
    );
    expect(stranger, "the seed has a registered person outside Jamal's view").toBeDefined();
    const hidden = await call("get_person", { id: stranger.id });
    expect(hidden.status).toBe(422);
    expect(hidden.json.error).toBe("No such person among the people you can see.");
    const nobody = await call("get_person", { id: "no-such-id" });
    expect(nobody.json.error).toBe(hidden.json.error);

    // update_my_profile: the allowed fields change, nothing else does
    const [before] = await admin.unsafe(
      "select name, phone, email, location, biz_class, sponsor_id, business_start_date, ibo_number, ltd_number, tags, stage_history from public.people where id = '4'",
    );
    const upd = await call("update_my_profile", { phone: "404-555-0199", location: "Decatur, GA" });
    expect(upd.status).toBe(200);
    expect(upd.json.result).toMatchObject({
      id: "4",
      full_name: "Jamal Brown",
      phone: "404-555-0199",
      location: "Decatur, GA",
    });
    const [after] = await admin.unsafe(
      "select name, phone, email, location, biz_class, sponsor_id, business_start_date, ibo_number, ltd_number, tags, stage_history from public.people where id = '4'",
    );
    expect({ ...after, phone: before.phone, location: before.location }).toEqual(before);
    expect(after.phone).toBe("404-555-0199");
    for (const field of ["biz_class", "sponsor_id", "ibo_number", "business_start_date"]) {
      const refused = await call("update_my_profile", { [field]: "x" });
      expect(refused.status, field).toBe(400);
      expect(refused.json.error, field).toContain(`${field}: not a field of update_my_profile`);
    }
    const [still] = await admin.unsafe(
      "select name, phone, email, location, biz_class, sponsor_id, business_start_date, ibo_number, ltd_number, tags, stage_history from public.people where id = '4'",
    );
    expect(still).toEqual(after);
    await admin.unsafe("update public.people set phone = $1, location = $2 where id = '4'", [
      before.phone,
      before.location,
    ]);

    // log_learning then list_learning, counts before and after
    const learningBefore = await count(
      "select count(*)::int as n from public.learning where person_id = '4'",
    );
    const logged = await call("log_learning", {
      kind: "podcast",
      title: "Integration show",
      amount: 25,
      unit: "minutes",
    });
    expect(logged.status).toBe(200);
    const entry = logged.json.result as { id: string };
    expect(logged.json.result).toMatchObject({
      kind: "podcast",
      title: "Integration show",
      amount: 25,
      unit: "minutes",
    });
    expect(
      await count("select count(*)::int as n from public.learning where person_id = '4'"),
    ).toBe(learningBefore + 1);
    const refusedUnit = await call("log_learning", { kind: "workshop", unit: "minutes" });
    expect(refusedUnit.status).toBe(422);
    expect(refusedUnit.json.error).toBe("a workshop takes no unit. Nothing was logged.");
    expect(
      await count("select count(*)::int as n from public.learning where person_id = '4'"),
    ).toBe(learningBefore + 1);
    const listed = (await call("list_learning", {})).json.result as {
      entries: { id: string }[];
      totals: { kind: string; unit: string; entries: number; amount: number }[];
    };
    expect(listed.entries.map((e) => e.id)).toContain(entry.id);
    expect(
      listed.totals.find((x) => x.kind === "podcast" && x.unit === "minutes")?.amount,
    ).toBeGreaterThanOrEqual(25);
    await admin.unsafe("delete from public.learning where id = $1", [entry.id]);

    // the numbers never leave
    const numbers = await admin.unsafe(
      "select ibo_number, ltd_number from public.people where ibo_number is not null or ltd_number is not null",
    );
    const text = bodies.join("\n");
    for (const n of numbers)
      for (const v of [n.ibo_number, n.ltd_number].filter(Boolean))
        expect(text, `no ${v} in any answer`).not.toContain(v as string);

    // one audit row per call
    expect(
      await count("select count(*)::int as n from public.agent_audit where connection_id = $1", id),
    ).toBe(calls);
  });

  it("refuses writes on a read connection, and records the refusal", async () => {
    const { key, id } = await connect("read", "Reader");
    expect((await post("/tools/list_prospects", {}, key)).status).toBe(200);
    const before = await count("select count(*)::int as n from public.people");
    const res = await post("/tools/add_prospect", { name: "Nope" }, key);
    expect(res.status).toBe(403);
    expect((await post("/tools/update_my_profile", { phone: "1" }, key)).status).toBe(403);
    expect((await post("/tools/log_learning", { kind: "workshop" }, key)).status).toBe(403);
    expect((await post("/tools/list_team", {}, key)).status).toBe(200);
    expect(await count("select count(*)::int as n from public.people")).toBe(before);
    const rows = await admin.unsafe(
      "select result from public.agent_audit where connection_id = $1 order by id",
      [id],
    );
    expect(rows).toHaveLength(5);
    expect(rows[0].result).toMatch(/ rows$/);
    expect(rows[1].result).toBe("refused: read-only connection");
    expect(rows[2].result).toBe("refused: read-only connection");
    expect(rows[3].result).toBe("refused: read-only connection");
    expect(rows[4].result).toMatch(/ rows$/);
  });

  it("adds, lists, ticks and notes card tasks as Jamal, on his own prospect, and a read connection only reads", async () => {
    const { key, id } = await connect("write", "Card agent");
    const added = await (
      await post("/tools/add_prospect", { name: "Card Integration Prospect" }, key)
    ).json();
    addedPeople.push(added.result.id);
    const cards = () =>
      count(
        "select count(*)::int as n from public.card_tasks where person_id = $1",
        added.result.id,
      );
    const notes = () =>
      count(
        "select count(*)::int as n from public.card_notes where person_id = $1",
        added.result.id,
      );
    expect(await cards()).toBe(0);

    // one read tool and one write tool, counts before and after
    const task = await (
      await post(
        "/tools/add_card_task",
        {
          person_id: added.result.id,
          title: "Text to confirm",
          due_date: "2026-11-19",
          due_time: "09:00",
        },
        key,
      )
    ).json();
    expect(task.ok).toBe(true);
    expect(await cards()).toBe(1);
    expect(task.result.task).toMatchObject({
      summary: "Text to confirm",
      status: "NEEDS-ACTION",
      due: "2026-11-19T09:00:00",
    });
    expect(typeof task.result.task.timezone).toBe("string");
    expect(task.result).toMatchObject({
      tasks_total: 1,
      tasks_done: 0,
      next_due: "2026-11-19T09:00:00",
    });

    const listed = (
      await (
        await post("/tools/list_card_tasks", { person_id: added.result.id, status: "all" }, key)
      ).json()
    ).result;
    expect(listed.total).toBe(1);
    expect(listed.tasks[0].id).toBe(task.result.task.id);

    const ticked = (
      await (await post("/tools/complete_card_task", { task_id: task.result.task.id }, key)).json()
    ).result;
    expect(ticked.task.status).toBe("COMPLETED");
    expect(ticked.tasks_done).toBe(1);
    expect(await cards()).toBe(1);

    const note = await (
      await post(
        "/tools/add_card_note",
        { person_id: added.result.id, body: "Called, will confirm" },
        key,
      )
    ).json();
    expect(note.result.notes_count).toBe(1);
    expect(await notes()).toBe(1);
    const card = (await (await post("/tools/get_card", { person_id: added.result.id }, key)).json())
      .result;
    expect(card.notes).toHaveLength(1);
    expect(card.tasks).toHaveLength(1);
    expect(Object.keys(card)).not.toContain("next_column");

    // refused in words, and nothing changes: a patch key outside the list, a time with no date
    const bad = await post(
      "/tools/update_card_task",
      { task_id: ticked.task.id, done: false },
      key,
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("done: not a field of update_card_task");
    const noDate = await post(
      "/tools/update_card_task",
      { task_id: ticked.task.id, due_date: null },
      key,
    );
    expect(noDate.status).toBe(422);
    expect(await cards()).toBe(1);

    // Jamal sees the same task through his own session (the Data API and the tools follow one rule)
    const mine = await jamal
      .from("card_tasks")
      .select("id, title, done")
      .eq("person_id", added.result.id);
    expect(mine.data).toEqual([{ id: task.result.task.id, title: "Text to confirm", done: true }]);
    expect(
      (await jamal.from("card_tasks").delete().eq("id", task.result.task.id)).error,
    ).toBeNull();
    expect(await cards()).toBe(0);

    // a read connection reads, and every write tool is refused
    const reader = await connect("read", "Card reader");
    expect((await post("/tools/list_cards", {}, reader.key)).status).toBe(200);
    for (const [name, args] of [
      ["add_card_task", { person_id: added.result.id, title: "No" }],
      ["add_card_note", { person_id: added.result.id, body: "No" }],
      ["complete_card_task", { task_id: "x" }],
      ["update_card_task", { task_id: "x", title: "No" }],
    ] as const)
      expect((await post(`/tools/${name}`, args, reader.key)).status, name).toBe(403);
    expect(await cards()).toBe(0);
    expect(await notes()).toBe(1);

    // one audit row per call; a card tool records the card's person where add_prospect records its prospect
    const rows = await admin.unsafe(
      "select tool, new_values ->> 'name' as name from public.agent_audit where connection_id = $1 order by id",
      [id],
    );
    expect(rows.map((r) => r.tool)).toEqual([
      "add_prospect",
      "add_card_task",
      "list_card_tasks",
      "complete_card_task",
      "add_card_note",
      "get_card",
      "update_card_task",
      "update_card_task",
    ]);
    expect(rows[1].name).toBe("Card Integration Prospect");
    expect(
      await count(
        "select count(*)::int as n from public.agent_audit where connection_id = $1",
        reader.id,
      ),
    ).toBe(5);
  });

  it("is cut off on the next call when the person revokes it, and when the team switches agents off", async () => {
    const { key, id } = await connect("write", "Revocable");
    expect((await post("/tools/whoami", {}, key)).status).toBe(200);

    await admin.unsafe(
      "update public.feature_switches set enabled = false where workspace_id = 'w1' and feature = 'agents'",
    );
    const off = await post("/tools/whoami", {}, key);
    expect(off.status).toBe(403);
    expect((await off.json()).error).toBe("Agents are not switched on for this team");
    expect(
      await count(
        "select count(*)::int as n from public.agent_audit where connection_id = $1 and result like 'refused: Agents are not switched on%'",
        id,
      ),
    ).toBe(1);
    const { error: noPairing } = await jamal.rpc("create_agent_pairing", { p_access: "write" });
    expect(noPairing?.message).toBe("Agents are not switched on for this team");
    await admin.unsafe(
      "update public.feature_switches set enabled = true where workspace_id = 'w1' and feature = 'agents'",
    );
    expect((await post("/tools/whoami", {}, key)).status).toBe(200);

    const { error } = await jamal.rpc("revoke_agent_connection", { p_id: id });
    expect(error).toBeNull();
    expect((await post("/tools/whoami", {}, key)).status).toBe(401);
    expect((await post("/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }, key)).status).toBe(401);
  });

  it("answers MCP with the team's name as the server name", async () => {
    const { key } = await connect("write", "MCP agent");
    const init = await (
      await post(
        "/mcp",
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
        key,
      )
    ).json();
    const [ws] = await admin.unsafe("select name from public.workspaces where id = 'w1'");
    expect(init.result.serverInfo.name).toBe(ws.name);
    const call = await (
      await post(
        "/mcp",
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami", arguments: {} } },
        key,
      )
    ).json();
    expect(JSON.parse(call.result.content[0].text).person.name).toBe("Jamal Brown");
  });

  it("throttles an address after 8 wrong codes", async () => {
    const ip = "203.0.113.200";
    for (let i = 0; i < 8; i++)
      expect(
        (await post("/pair", { code: "WWWW-XXXX-YYYY-ZZZZ", label: "x" }, undefined, ip)).status,
      ).toBe(403);
    expect(
      (await post("/pair", { code: "WWWW-XXXX-YYYY-ZZZZ", label: "x" }, undefined, ip)).status,
    ).toBe(429);
  });
});
