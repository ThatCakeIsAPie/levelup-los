/**
 * The real AgentDb: postgres.js behind the transaction pooler, connected as the `agent_connector`
 * role (index.ts creates the client from the secret AGENT_DB_URL: `prepare: false`, a small lazy
 * pool). The client is typed structurally here so this file never imports the driver.
 *
 * A tool call is ONE transaction: the login's claims and the connection id as transaction-local
 * settings, `set local role authenticated`, then `select public.agent_<tool>(...)`. Row level
 * security then decides, exactly as it does for the app. The connector role itself can do nothing
 * else (see the migration).
 */
import { DbError, type AgentDb, type Access, type Connection, type Redeemed } from "./db.ts";

type Rows = Record<string, unknown>[];
export interface QueryRunner {
  unsafe(query: string, params?: unknown[]): PromiseLike<Rows>;
}
export interface SqlClient extends QueryRunner {
  begin<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T>;
}

const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

function wrap(e: unknown): DbError {
  if (e instanceof DbError) return e;
  const err = e as { code?: unknown; message?: unknown };
  return new DbError(typeof err?.code === "string" ? err.code : "", text(err?.message ?? e));
}

export function createPostgresDb(sql: SqlClient): AgentDb {
  const one = async (query: string, params: unknown[]): Promise<Record<string, unknown> | null> => {
    try {
      const rows = await sql.unsafe(query, params);
      return rows[0] ?? null;
    } catch (e) {
      throw wrap(e);
    }
  };

  return {
    async lookupConnection(keyHash): Promise<Connection | null> {
      const r = await one("select * from agent_private.connector_lookup($1::text)", [keyHash]);
      if (!r) return null;
      return {
        id: text(r.id),
        userId: text(r.user_id),
        personId: text(r.person_id),
        workspaceId: text(r.workspace_id),
        workspaceName: text(r.workspace_name),
        label: text(r.label),
        access: r.access === "write" ? "write" : "read",
      };
    },

    async redeemPairing(codeHash, keyHash, label): Promise<Redeemed | null> {
      const r = await one(
        "select * from agent_private.connector_redeem($1::text, $2::text, $3::text)",
        [codeHash, keyHash, label],
      );
      if (!r) return null;
      return {
        connectionId: text(r.connection_id),
        access: (r.access === "write" ? "write" : "read") as Access,
        personName: r.person_name == null ? null : text(r.person_name),
        workspaceName: r.workspace_name == null ? null : text(r.workspace_name),
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : text(r.created_at),
      };
    },

    async pairBlocked(ipHash) {
      const r = await one("select agent_private.connector_pair_blocked($1::text) as blocked", [
        ipHash,
      ]);
      return r?.blocked === true;
    },

    async pairFailed(ipHash) {
      await one("select agent_private.connector_pair_failed($1::text) as done", [ipHash]);
    },

    async callTool(conn, query, params) {
      const claims = JSON.stringify({
        sub: conn.userId,
        role: "authenticated",
        aud: "authenticated",
      });
      try {
        const rows = await sql.begin(async (tx) => {
          await tx.unsafe(
            "select set_config('request.jwt.claims', $1::text, true), set_config('app.agent_connection_id', $2::text, true)",
            [claims, conn.id],
          );
          await tx.unsafe("set local role authenticated");
          return await tx.unsafe(query, params);
        });
        return rows[0]?.r ?? null;
      } catch (e) {
        throw wrap(e);
      }
    },

    async recordRefusal(connectionId, tool, args, result) {
      // ::text::jsonb: postgres.js double-encodes a string bound as jsonb
      await one(
        "select agent_private.connector_refusal($1::uuid, $2::text, $3::text::jsonb, $4::text) as done",
        [connectionId, tool, JSON.stringify(args ?? null), result],
      );
    },
  };
}
