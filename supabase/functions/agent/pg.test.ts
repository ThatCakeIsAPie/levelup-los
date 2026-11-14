import { describe, expect, it } from "vitest";
import { DbError, type Connection } from "./db.ts";
import { createPostgresDb, type QueryRunner, type SqlClient } from "./pg.ts";

const conn: Connection = {
  id: "00000000-0000-4000-8000-00000000c001",
  userId: "00000000-0000-4000-8000-0000000a9002",
  personId: "p1",
  workspaceId: "w1",
  workspaceName: "Team",
  label: "Dot",
  access: "write",
};

/** A scripted client that records every statement, as the postgres.js client would receive it. */
function fakeSql(
  reply: (query: string, params: unknown[]) => Record<string, unknown>[] | Error = () => [],
) {
  const log: { query: string; params: unknown[]; inTx: boolean }[] = [];
  const run = (inTx: boolean): QueryRunner => ({
    unsafe: (query, params = []) => {
      log.push({ query, params, inTx });
      const r = reply(query, params);
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
  });
  const sql: SqlClient = {
    ...run(false),
    begin: async (fn) => await fn(run(true)),
  };
  return { sql, log };
}

describe("callTool", () => {
  it("runs the tool as the person in one transaction: settings, role, then the tool", async () => {
    const { sql, log } = fakeSql((q) =>
      q.startsWith("select public.agent_") ? [{ r: { ok: 1 } }] : [],
    );
    const out = await createPostgresDb(sql).callTool(conn, "select public.agent_whoami() as r", []);
    expect(out).toEqual({ ok: 1 });
    expect(log.map((l) => l.inTx)).toEqual([true, true, true]);
    expect(log[0].query).toContain("set_config('request.jwt.claims', $1::text, true)");
    expect(log[0].query).toContain("set_config('app.agent_connection_id', $2::text, true)");
    expect(JSON.parse(log[0].params[0] as string)).toEqual({
      sub: conn.userId,
      role: "authenticated",
      aud: "authenticated",
    });
    expect(log[0].params[1]).toBe(conn.id);
    expect(log[1].query).toBe("set local role authenticated");
    expect(log[2].query).toBe("select public.agent_whoami() as r");
  });

  it("passes the tool's parameters as bound values, never in the SQL text", async () => {
    const { sql, log } = fakeSql(() => [{ r: null }]);
    await createPostgresDb(sql).callTool(
      conn,
      "select public.agent_add_prospect($1::text, $2::text) as r",
      ["Robert'); drop table people;--", null],
    );
    expect(log[2].params).toEqual(["Robert'); drop table people;--", null]);
    expect(log.map((l) => l.query).join(" ")).not.toContain("drop table");
  });

  it("returns null for no row and wraps database errors with their SQLSTATE", async () => {
    const { sql } = fakeSql((q) =>
      q.startsWith("select public.agent_")
        ? Object.assign(new Error("agent connection is not active"), { code: "28000" })
        : [],
    );
    await expect(
      createPostgresDb(sql).callTool(conn, "select public.agent_whoami() as r", []),
    ).rejects.toMatchObject({
      name: "DbError",
      code: "28000",
      message: "agent connection is not active",
    });
    const empty = fakeSql();
    expect(
      await createPostgresDb(empty.sql).callTool(conn, "select public.agent_whoami() as r", []),
    ).toBeNull();
  });

  it("gives connection errors an empty code", async () => {
    const { sql } = fakeSql(() => new Error("connect ECONNREFUSED"));
    let e: unknown = null;
    try {
      await createPostgresDb(sql).callTool(conn, "select 1", []);
    } catch (x) {
      e = x;
    }
    expect(e).toBeInstanceOf(DbError);
    expect((e as DbError).code).toBe("");
  });
});

describe("the connector functions", () => {
  it("looks a connection up by hash through the private function only", async () => {
    const { sql, log } = fakeSql(() => [
      {
        id: "i",
        user_id: "u",
        person_id: "p",
        workspace_id: "w",
        workspace_name: "Team",
        label: "Dot",
        access: "write",
      },
    ]);
    const c = await createPostgresDb(sql).lookupConnection("a".repeat(64));
    expect(c).toEqual({
      id: "i",
      userId: "u",
      personId: "p",
      workspaceId: "w",
      workspaceName: "Team",
      label: "Dot",
      access: "write",
    });
    expect(log).toEqual([
      {
        query: "select * from agent_private.connector_lookup($1::text)",
        params: ["a".repeat(64)],
        inTx: false,
      },
    ]);
    expect(await createPostgresDb(fakeSql().sql).lookupConnection("b")).toBeNull();
  });

  it("treats anything but 'write' as read access", async () => {
    const { sql } = fakeSql(() => [
      {
        id: "i",
        user_id: "u",
        person_id: "p",
        workspace_id: "w",
        workspace_name: "T",
        label: "x",
        access: "admin",
      },
    ]);
    expect((await createPostgresDb(sql).lookupConnection("a"))?.access).toBe("read");
  });

  it("redeems, blocks and records through the private functions", async () => {
    const { sql, log } = fakeSql((q) => {
      if (q.includes("connector_redeem"))
        return [
          {
            connection_id: "c",
            access: "read",
            person_name: "Alex",
            workspace_name: "Team",
            created_at: new Date("2026-11-14T00:00:00Z"),
          },
        ];
      if (q.includes("pair_blocked")) return [{ blocked: true }];
      return [{ done: "" }];
    });
    const db = createPostgresDb(sql);
    expect(await db.redeemPairing("h1", "h2", "Dot")).toEqual({
      connectionId: "c",
      access: "read",
      personName: "Alex",
      workspaceName: "Team",
      createdAt: "2026-11-14T00:00:00.000Z",
    });
    expect(await db.pairBlocked("ip")).toBe(true);
    await db.pairFailed("ip");
    expect(log.map((l) => l.query.match(/agent_private\.(\w+)/)?.[1])).toEqual([
      "connector_redeem",
      "connector_pair_blocked",
      "connector_pair_failed",
    ]);
    expect(await createPostgresDb(fakeSql().sql).redeemPairing("h1", "h2", "Dot")).toBeNull();
  });

  it("records a refusal with the arguments as JSON text cast to jsonb", async () => {
    const { sql, log } = fakeSql(() => [{ done: "" }]);
    await createPostgresDb(sql).recordRefusal(
      conn.id,
      "add_prospect",
      { name: "Pat" },
      "refused: read-only connection",
    );
    expect(log[0].query).toContain("$3::text::jsonb");
    expect(log[0].params).toEqual([
      conn.id,
      "add_prospect",
      '{"name":"Pat"}',
      "refused: read-only connection",
    ]);
  });

  it("only ever calls agent_private.connector_* and the registry's own SQL", async () => {
    const { sql, log } = fakeSql((q) => (q.includes("blocked") ? [{ blocked: false }] : [{}]));
    const db = createPostgresDb(sql);
    await db.lookupConnection("a");
    await db.redeemPairing("a", "b", "c");
    await db.pairBlocked("a");
    await db.pairFailed("abcdefgh");
    await db.recordRefusal(conn.id, "t", {}, "r");
    for (const l of log) expect(l.query).toMatch(/^select (\* from )?agent_private\.connector_/);
  });
});
