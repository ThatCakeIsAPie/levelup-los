import { describe, expect, it } from "vitest";
import { createHandler } from "./app.ts";
import { sha256Hex } from "./crypto.ts";
import { BASE, CODE, FakeDb, KEY_RE, WORKSPACE, req, throwing } from "./test-support.ts";

const KEY = "crmak_" + "k".repeat(43);

function setup() {
  const db = new FakeDb();
  const handle = createHandler({ db, baseUrl: BASE });
  return { db, handle };
}

describe("fail closed", () => {
  it("answers 503 with a clear message on every route when the database secret is missing", async () => {
    const handle = createHandler({ db: null, baseUrl: BASE });
    for (const [path, init] of [
      ["/pair", { method: "POST", body: { code: CODE, label: "x" } }],
      ["/tools", { method: "GET", key: KEY }],
      ["/mcp", { method: "POST", key: KEY, body: {} }],
      ["/anything", { method: "GET" }],
    ] as const) {
      const res = await handle(req(path, init));
      expect(res.status).toBe(503);
      expect((await res.json()).message).toContain("AGENT_DB_URL");
    }
  });
});

describe("POST /pair", () => {
  it("turns a code into a connection key, once, and shows the key only in that reply", async () => {
    const { db, handle } = setup();
    await db.addPairing("ABCDEFGHJKLMNPQR");
    const res = await handle(
      req("/pair", { method: "POST", body: { code: CODE, label: "  Dot\n" } }),
    );
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.connection_key).toMatch(KEY_RE);
    expect(j.connection).toMatchObject({
      label: "Dot",
      access: "write",
      connected_as_person: "Alex Apprentice",
      team: WORKSPACE,
    });
    expect(j.urls.mcp).toBe(`${BASE}/mcp`);
    expect(j.tools.map((t: { name: string }) => t.name)).toHaveLength(6);
    expect(j.setup.claude_code).toContain(`${BASE}/mcp`);
    expect(JSON.stringify(j.setup)).not.toContain(j.connection_key);
    // only the hash of the key reached the database
    expect(db.connections.has(await sha256Hex(j.connection_key))).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts the code in any case and with or without dashes and spaces", async () => {
    for (const typed of ["abcd-efgh-jklm-npqr", "ABCD EFGH JKLM NPQR", " abcdefghjklmnpqr "]) {
      const { db, handle } = setup();
      await db.addPairing("ABCDEFGHJKLMNPQR");
      const res = await handle(req("/pair", { method: "POST", body: { code: typed, label: "a" } }));
      expect(res.status).toBe(201);
    }
  });

  it("is single use: a second redemption of the same code is refused", async () => {
    const { db, handle } = setup();
    await db.addPairing("ABCDEFGHJKLMNPQR");
    const first = await handle(req("/pair", { method: "POST", body: { code: CODE, label: "a" } }));
    const second = await handle(req("/pair", { method: "POST", body: { code: CODE, label: "b" } }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(403);
    expect(db.connections.size).toBe(1);
  });

  it("gives the byte-identical refusal for wrong, malformed, used, expired and switched-off codes", async () => {
    const { db, handle } = setup();
    db.blockAfter = 1000;
    await db.addPairing("ABCDEFGHJKLMNPQR", "write", { used: true });
    await db.addPairing("BBBBCCCCDDDDEEEE", "write", { expired: true });
    await db.addPairing("FFFFGGGGHHHHJJJJ", "write", { allowed: false });
    const bodies = new Set<string>();
    for (const code of [
      CODE,
      "WWWWXXXXYYYYZZZZ",
      "WRONGWRONGWRONG2",
      "short",
      "",
      "ABCD-EFGH-JKLM-NPQ0",
      "BBBB-CCCC-DDDD-EEEE",
      "FFFF-GGGG-HHHH-JJJJ",
      "x".repeat(200),
    ]) {
      const res = await handle(req("/pair", { method: "POST", body: { code, label: "a" } }));
      expect(res.status).toBe(403);
      bodies.add(await res.text());
    }
    expect(bodies.size).toBe(1);
    expect([...bodies][0]).toContain("invalid_code");
    expect(db.connections.size).toBe(0);
  });

  it("throttles an address after 8 failures (429), not before, and records each failure", async () => {
    const { db, handle } = setup();
    const attempt = () =>
      handle(
        req("/pair", {
          method: "POST",
          body: { code: "WWWWXXXXYYYYZZZZ", label: "a" },
          headers: { "x-forwarded-for": "203.0.113.9" },
        }),
      );
    for (let i = 0; i < 8; i++) expect((await attempt()).status).toBe(403);
    expect(db.failures).toHaveLength(8);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("600");
    expect(db.failures).toHaveLength(8);
    // another address is not blocked, and a real code from the blocked one is not tried
    const other = await handle(
      req("/pair", {
        method: "POST",
        body: { code: "WWWWXXXXYYYYZZZZ", label: "a" },
        headers: { "x-forwarded-for": "198.51.100.1" },
      }),
    );
    expect(other.status).toBe(403);
    expect(db.redeems).toBe(9);
  });

  it("never stores or passes an address, only a hash", async () => {
    const { db, handle } = setup();
    await handle(
      req("/pair", {
        method: "POST",
        body: { code: "WWWWXXXXYYYYZZZZ", label: "a" },
        headers: { "cf-connecting-ip": "203.0.113.77" },
      }),
    );
    expect(db.failures[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(db.failures[0]).not.toContain("203");
  });

  it("answers 400 for a bad request without counting it as a failed attempt", async () => {
    const { db, handle } = setup();
    for (const body of [
      "not json",
      "[]",
      "{}",
      { code: CODE },
      { label: "a" },
      { code: 5, label: "a" },
      { code: CODE, label: "\n\t" },
    ]) {
      const res = await handle(req("/pair", { method: "POST", body }));
      expect(res.status).toBe(400);
    }
    expect(db.failures).toHaveLength(0);
    expect(db.redeems).toBe(0);
  });

  it("limits the body size, and the label to 80 clean characters", async () => {
    const { db, handle } = setup();
    expect(
      (
        await handle(
          req("/pair", { method: "POST", body: { code: CODE, label: "x".repeat(10_000) } }),
        )
      ).status,
    ).toBe(413);
    await db.addPairing("ABCDEFGHJKLMNPQR");
    const res = await handle(
      req("/pair", { method: "POST", body: { code: CODE, label: "a".repeat(100) + "\u0007" } }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).connection.label).toHaveLength(80);
  });

  it("only takes POST", async () => {
    const { handle } = setup();
    for (const method of ["GET", "PUT", "DELETE"]) {
      const res = await handle(req("/pair", { method }));
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });
});

describe("authentication", () => {
  it("refuses a missing, malformed, unknown or revoked key with 401", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY, "write", { revoked: true });
    const bad = [
      "",
      "Bearer",
      "Bearer abc",
      "Basic xyz",
      `Bearer ${KEY}x`,
      `Bearer ${KEY.slice(1)}`,
      "Bearer crmak_" + "!".repeat(43),
    ];
    for (const h of bad) {
      const res = await handle(req("/tools", { headers: h ? { authorization: h } : {} }));
      expect(res.status).toBe(401);
    }
    expect(db.lookups).toBe(0); // wrong shapes never reach the database
    for (const key of [KEY, "crmak_" + "z".repeat(43)]) {
      const res = await handle(req("/tools", { key }));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Bearer");
    }
    expect(db.lookups).toBe(2);
  });

  it("covers /mcp and /tools/<name> too, before any body is read", async () => {
    const { db, handle } = setup();
    expect((await handle(req("/mcp", { method: "POST", body: {} }))).status).toBe(401);
    expect((await handle(req("/tools/whoami", { method: "POST", body: {} }))).status).toBe(401);
    expect(db.toolCalls).toHaveLength(0);
  });

  it("accepts the Bearer scheme in any case", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    const res = await handle(req("/tools", { headers: { authorization: `bearer ${KEY}` } }));
    expect(res.status).toBe(200);
  });
});

describe("no browser access", () => {
  it("sets no CORS header on any answer, and does not answer preflights", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    const answers = [
      await handle(
        req("/pair", {
          method: "POST",
          body: { code: "WWWWXXXXYYYYZZZZ", label: "a" },
          headers: { origin: "https://evil.test" },
        }),
      ),
      await handle(req("/tools", { key: KEY, headers: { origin: "https://evil.test" } })),
      await handle(req("/tools", { headers: { origin: "https://evil.test" } })),
      await handle(
        req("/pair", {
          method: "OPTIONS",
          headers: { origin: "https://evil.test", "access-control-request-method": "POST" },
        }),
      ),
      await handle(req("/nothing", { headers: { origin: "https://evil.test" } })),
    ];
    for (const r of answers) {
      for (const [k] of r.headers)
        expect(k.toLowerCase().startsWith("access-control-")).toBe(false);
    }
    expect(answers[3].status).toBe(405);
  });
});

describe("plain HTTP surface", () => {
  it("lists the tools", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY, "read");
    const res = await handle(req("/tools", { key: KEY }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.connection).toEqual({ label: "Dot", access: "read" });
    expect(j.tools.map((t: { name: string }) => t.name)).toEqual([
      "whoami",
      "list_prospects",
      "add_prospect",
      "update_prospect",
      "list_upcoming_events",
      "set_event_answer",
    ]);
    expect(j.tools[2]).toMatchObject({ changes_data: true });
    expect(j.tools[0]).toMatchObject({ changes_data: false });
  });

  it("runs a tool as the connection's person through one database call", async () => {
    const { db, handle } = setup();
    const c = await db.addConnection(KEY);
    db.toolResult = { person: { name: "Alex" } };
    const res = await handle(req("/tools/whoami", { method: "POST", key: KEY, body: {} }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { person: { name: "Alex" } } });
    expect(db.toolCalls).toHaveLength(1);
    expect(db.toolCalls[0].conn.id).toBe(c.id);
    expect(db.toolCalls[0].sql).toBe("select public.agent_whoami() as r");
  });

  it("takes an empty body and a path with a trailing slash", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    const res = await handle(req("/tools/whoami/", { method: "POST", key: KEY }));
    expect(res.status).toBe(200);
  });

  it("answers 404 for an unknown tool (and for malformed names), 400 for bad arguments, 405 for the wrong method", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    for (const name of [
      "nope",
      "agent_whoami",
      "whoami%20",
      "%E0%A4%A",
      "..%2Fwhoami",
      "constructor",
      "__proto__",
    ]) {
      const res = await handle(req(`/tools/${name}`, { method: "POST", key: KEY, body: {} }));
      expect(res.status, name).toBe(404);
    }
    expect(
      (await handle(req("/tools/add_prospect", { method: "POST", key: KEY, body: {} }))).status,
    ).toBe(400);
    expect(
      (await handle(req("/tools/whoami", { method: "POST", key: KEY, body: "nope" }))).status,
    ).toBe(400);
    expect((await handle(req("/tools/whoami", { method: "GET", key: KEY }))).status).toBe(405);
    expect((await handle(req("/tools", { method: "POST", key: KEY, body: {} }))).status).toBe(405);
    expect(db.toolCalls).toHaveLength(0);
  });

  it("refuses a write tool on a read connection with 403, records the refusal and does not reach the database", async () => {
    const { db, handle } = setup();
    const c = await db.addConnection(KEY, "read");
    const res = await handle(
      req("/tools/add_prospect", { method: "POST", key: KEY, body: { name: "Pat" } }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("read-only");
    expect(db.toolCalls).toHaveLength(0);
    expect(db.refusals).toEqual([
      {
        connectionId: c.id,
        tool: "add_prospect",
        args: { name: "Pat" },
        result: "refused: read-only connection",
      },
    ]);
    // reads still work
    expect(
      (await handle(req("/tools/list_prospects", { method: "POST", key: KEY, body: {} }))).status,
    ).toBe(200);
  });

  it("reads a refused (too large) body to its end instead of cancelling it, so the gateway's connection is not left hanging", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    for (const [path, chunks] of [
      ["/tools/add_prospect", 40], // 40 x 4 KB = 160 KB, no content-length: refused while reading
      ["/mcp", 40],
      ["/pair", 40],
    ] as const) {
      let pulled = 0;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled === chunks) return controller.close();
          pulled++;
          controller.enqueue(new Uint8Array(4096).fill(120));
        },
        cancel() {
          cancelled = true;
        },
      });
      const res = await handle(
        new Request(`${BASE}${path}`, {
          method: "POST",
          headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
          body,
          // @ts-expect-error Node's fetch needs this for a streamed request body
          duplex: "half",
        }),
      );
      expect(res.status, path).toBe(413);
      expect(pulled, path).toBe(chunks);
      expect(cancelled, path).toBe(false);
    }
    expect(db.toolCalls).toHaveLength(0);
  });

  it("audits a call refused for its arguments (a field outside the whitelist leaves a trace), over HTTP and MCP", async () => {
    const { db, handle } = setup();
    const c = await db.addConnection(KEY);
    const res = await handle(
      req("/tools/update_prospect", {
        method: "POST",
        key: KEY,
        body: { id: "p1", stage: "ibo", notes: "x" },
      }),
    );
    expect(res.status).toBe(400);
    expect(db.toolCalls).toHaveLength(0);
    expect(db.refusals).toHaveLength(1);
    expect(db.refusals[0]).toMatchObject({
      connectionId: c.id,
      tool: "update_prospect",
      args: { id: "p1", stage: "ibo", notes: "x" },
    });
    expect(db.refusals[0].result).toMatch(/^refused: Invalid arguments: stage: not a field/);

    const viaMcp = await handle(
      req("/mcp", {
        method: "POST",
        key: KEY,
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "set_event_answer", arguments: { event_id: "e1", answer: "perhaps" } },
        },
      }),
    );
    expect((await viaMcp.json()).result.isError).toBe(true);
    expect(db.refusals).toHaveLength(2);
    expect(db.refusals[1]).toMatchObject({ tool: "set_event_answer" });
    expect(db.refusals[1].result).toContain("answer: must be one of");

    // an oversized argument object is not copied into the audit row
    await handle(
      req("/tools/update_prospect", {
        method: "POST",
        key: KEY,
        body: { id: "p1", stage: "x".repeat(5000) },
      }),
    );
    expect(db.refusals[2].args).toMatchObject({ truncated: true });
    expect(db.refusals[2].result.length).toBeLessThanOrEqual(500);
    // an unknown tool is not audited (nothing to attribute it to)
    await handle(req("/tools/nope", { method: "POST", key: KEY, body: {} }));
    expect(db.refusals).toHaveLength(3);
  });

  it("turns a tool's own refusal into 422", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    db.toolResult = {
      error: "No such prospect among the people you can see. Nothing was changed.",
    };
    const res = await handle(
      req("/tools/update_prospect", { method: "POST", key: KEY, body: { id: "x", notes: "n" } }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("No such prospect");
    expect(db.refusals).toHaveLength(0); // already audited in SQL
  });

  it("maps a database refusal to 403 with our own message, audits it, and hides other messages", async () => {
    const { db, handle } = setup();
    const c = await db.addConnection(KEY);
    db.toolResult = throwing("42501", "Agents are not switched on for this team");
    let res = await handle(req("/tools/whoami", { method: "POST", key: KEY, body: {} }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Agents are not switched on for this team");
    expect(db.refusals[0]).toMatchObject({
      connectionId: c.id,
      tool: "whoami",
      result: "refused: Agents are not switched on for this team",
    });
    db.toolResult = throwing("42501", "permission denied for function secret_thing");
    res = await handle(req("/tools/whoami", { method: "POST", key: KEY, body: {} }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("This request was refused.");
    db.toolResult = throwing("28000", "agent connection is not active");
    res = await handle(req("/tools/whoami", { method: "POST", key: KEY, body: {} }));
    expect((await res.json()).error).toBe("agent connection is not active");
  });

  it("answers 500 without details for any other failure, and audits it", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    db.toolResult = throwing("XX000", 'relation "secret" exploded at host db.internal');
    const res = await handle(req("/tools/whoami", { method: "POST", key: KEY, body: {} }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(db.refusals[0].result).toBe("failed: the request could not be completed");
  });

  it("survives the database being down", async () => {
    const { db, handle } = setup();
    db.lookupConnection = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const res = await handle(req("/tools", { key: KEY }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
  });

  it("returns 404 for anything else", async () => {
    const { handle } = setup();
    expect((await handle(req("/"))).status).toBe(404);
    expect((await handle(req("/admin"))).status).toBe(404);
  });
});

describe("MCP", () => {
  const rpc = (key: string, body: unknown, init: RequestInit = {}) =>
    req("/mcp", {
      method: "POST",
      key,
      body,
      headers: { accept: "application/json, text/event-stream" },
      ...init,
    });

  it("initializes with the team's name as the server name and the protocol version it was asked for", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    const res = await handle(
      rpc(KEY, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "c", version: "1" },
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const j = await res.json();
    expect(j.id).toBe(1);
    expect(j.result.serverInfo.name).toBe(WORKSPACE);
    expect(j.result.protocolVersion).toBe("2025-06-18");
    expect(j.result.capabilities).toEqual({ tools: { listChanged: false } });
    // an unknown version gets the newest supported one
    const res2 = await handle(
      rpc(KEY, {
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { protocolVersion: "1999-01-01" },
      }),
    );
    expect((await res2.json()).result.protocolVersion).toBe("2025-11-25");
  });

  it("names the server after each team's own name", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY, "write", { workspaceName: "Another Group" });
    const j = await (
      await handle(rpc(KEY, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }))
    ).json();
    expect(j.result.serverInfo.name).toBe("Another Group");
  });

  it("answers notifications with 202 and no body", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    const res = await handle(rpc(KEY, { jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("lists the six tools with schemas and read-only hints", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    const j = await (
      await handle(rpc(KEY, { jsonrpc: "2.0", id: 3, method: "tools/list" }))
    ).json();
    const tools = j.result.tools as {
      name: string;
      inputSchema: { type: string };
      annotations: { readOnlyHint: boolean };
    }[];
    expect(tools).toHaveLength(6);
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    expect(tools.find((t) => t.name === "whoami")?.annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "add_prospect")?.annotations.readOnlyHint).toBe(false);
  });

  it("calls a tool through the same path as plain HTTP", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    db.toolResult = [{ id: "p1" }];
    const j = await (
      await handle(
        rpc(KEY, {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "list_prospects", arguments: { limit: 5 } },
        }),
      )
    ).json();
    expect(j.result.isError).toBe(false);
    expect(JSON.parse(j.result.content[0].text)).toEqual([{ id: "p1" }]);
    expect(db.toolCalls[0]).toMatchObject({
      sql: "select public.agent_list_prospects($1::int) as r",
      params: [5],
    });
  });

  it("reports a refused tool call as isError and an unknown tool as a protocol error", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY, "read");
    let j = await (
      await handle(
        rpc(KEY, {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "add_prospect", arguments: { name: "x" } },
        }),
      )
    ).json();
    expect(j.result.isError).toBe(true);
    expect(j.result.content[0].text).toContain("read-only");
    j = await (
      await handle(
        rpc(KEY, {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: { name: "delete_person", arguments: {} },
        }),
      )
    ).json();
    expect(j.error.code).toBe(-32602);
    expect(db.toolCalls).toHaveLength(0);
  });

  it("answers ping, rejects unknown methods, bad JSON and bad shapes", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    expect(
      (await (await handle(rpc(KEY, { jsonrpc: "2.0", id: 7, method: "ping" }))).json()).result,
    ).toEqual({});
    expect(
      (await (await handle(rpc(KEY, { jsonrpc: "2.0", id: 8, method: "resources/list" }))).json())
        .error.code,
    ).toBe(-32601);
    const bad = await handle(rpc(KEY, "{nope"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe(-32700);
    expect((await (await handle(rpc(KEY, { id: 9, method: "ping" }))).json()).error.code).toBe(
      -32600,
    );
  });

  it("handles a batch and refuses an empty one", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    const res = await handle(
      rpc(KEY, [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ]),
    );
    expect((await res.json()).map((r: { id: number }) => r.id)).toEqual([1, 2]);
    expect((await handle(rpc(KEY, []))).status).toBe(400);
  });

  it("offers no event stream and no sessions: GET and DELETE are 405", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    for (const method of ["GET", "DELETE"]) {
      const res = await handle(req("/mcp", { method, key: KEY }));
      expect(res.status).toBe(405);
    }
  });

  it("does not run an update_prospect that names a field outside the whitelist", async () => {
    const { db, handle } = setup();
    await db.addConnection(KEY);
    const j = await (
      await handle(
        rpc(KEY, {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "update_prospect", arguments: { id: "p1", sponsor_id: "x" } },
        }),
      )
    ).json();
    expect(j.result.isError).toBe(true);
    expect(j.result.content[0].text).toContain("sponsor_id: not a field of update_prospect");
    expect(db.toolCalls).toHaveLength(0);
  });
});
