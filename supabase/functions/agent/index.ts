// The agent connector's Deno entry (Supabase Edge Function `agent`): wiring only. All logic is in
// the plain modules next to this file, which vitest tests without Deno (app.ts, tools.ts, pg.ts, ...).
// It connects to Postgres as the role `agent_connector` through the transaction pooler, using the
// function secret AGENT_DB_URL; without it every request is answered 503 (fail closed).
import postgres from "npm:postgres@3.4.9";
import { createHandler } from "./app.ts";
import { createPostgresDb, type SqlClient } from "./pg.ts";

const url = Deno.env.get("AGENT_DB_URL");

// A small lazy pool per isolate; `prepare: false` because the transaction pooler cannot keep
// prepared statements.
let sql: SqlClient | null = null;
if (url) {
  try {
    sql = postgres(url, {
      max: 3,
      prepare: false,
      idle_timeout: 30,
      connect_timeout: 10,
    }) as unknown as SqlClient;
  } catch (e) {
    console.error("agent connector: AGENT_DB_URL is not usable:", String(e).replace(url, "<url>"));
  }
}

const handler = createHandler({
  db: sql ? createPostgresDb(sql) : null,
  baseUrl: `${(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "")}/functions/v1/agent`,
});

Deno.serve(handler);
