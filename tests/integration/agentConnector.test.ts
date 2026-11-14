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
      ["agent_add_prospect", { p_name: "Sneaky" }],
      ["agent_update_prospect", { p_id: "x", p_patch: { notes: "n" } }],
      ["agent_list_upcoming_events", {}],
      ["agent_set_event_answer", { p_event_id: "x", p_answer: "yes" }],
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
    const seen = (await (await post("/tools/list_prospects", { limit: 200 }, key)).json())
      .result as { id: string }[];
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

    // events and the person's own answer
    const events = (await (await post("/tools/list_upcoming_events", {}, key)).json()).result as {
      id: string;
      my_answer: string | null;
    }[];
    expect(events.length).toBeGreaterThan(0);
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

    // exactly one audit row per call that reached a tool (the invalid update was refused before it)
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
      "list_upcoming_events",
      "set_event_answer",
    ]);
    expect(tools[2].result).toMatch(/^refused: no such prospect/);
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

  it("refuses writes on a read connection, and records the refusal", async () => {
    const { key, id } = await connect("read", "Reader");
    expect((await post("/tools/list_prospects", {}, key)).status).toBe(200);
    const before = await count("select count(*)::int as n from public.people");
    const res = await post("/tools/add_prospect", { name: "Nope" }, key);
    expect(res.status).toBe(403);
    expect(await count("select count(*)::int as n from public.people")).toBe(before);
    const rows = await admin.unsafe(
      "select result from public.agent_audit where connection_id = $1 order by id",
      [id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].result).toMatch(/ rows$/);
    expect(rows[1].result).toBe("refused: read-only connection");
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
