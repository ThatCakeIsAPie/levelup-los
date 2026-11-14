/**
 * MCP over Streamable HTTP, stateless: every POST to /mcp is answered with one JSON response
 * (the transport allows that instead of an event stream), no sessions, no server-initiated
 * messages. Only what a tool server needs: initialize, ping, tools/list, tools/call. Tool calls go
 * through the same runTool() as the plain HTTP surface.
 */
import type { AgentDb, Connection } from "./db.ts";
import { empty, json, readJson } from "./http.ts";
import { runTool } from "./run.ts";
import { TOOLS, inputSchema } from "./tools.ts";

const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type Id = string | number | null;
interface RpcMessage {
  jsonrpc?: unknown;
  id?: Id;
  method?: unknown;
  params?: unknown;
}
type RpcReply =
  | { jsonrpc: "2.0"; id: Id; result: unknown }
  | { jsonrpc: "2.0"; id: Id; error: { code: number; message: string } };

const ok = (id: Id, result: unknown): RpcReply => ({ jsonrpc: "2.0", id, result });
const fail = (id: Id, code: number, message: string): RpcReply => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/** The MCP server's name is the team's name in the database (never a constant of this code). */
export function serverName(conn: Connection): string {
  return conn.workspaceName.trim().slice(0, 80) || "Team CRM";
}

async function handleOne(db: AgentDb, conn: Connection, m: RpcMessage): Promise<RpcReply | null> {
  if (m === null || typeof m !== "object" || m.jsonrpc !== "2.0")
    return fail(null, -32600, "Invalid Request");
  const hasId = m.id !== undefined;
  // A response or a notification from the client: nothing to answer.
  if (typeof m.method !== "string")
    return hasId ? fail(m.id ?? null, -32600, "Invalid Request") : null;
  if (!hasId) return null;
  const id = m.id ?? null;
  const params = (m.params ?? {}) as Record<string, unknown>;

  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: serverName(conn), version: "1.0.0" },
        instructions:
          "Manage the connected person's own and team data. Call whoami first. Nothing can be deleted through this connection.",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: inputSchema(t),
          annotations: { readOnlyHint: !t.write, destructiveHint: false, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!TOOLS.some((t) => t.name === name))
        return fail(id, -32602, `Unknown tool: ${name || "(none)"}`);
      const o = await runTool(db, conn, name, params.arguments);
      return ok(
        id,
        o.ok
          ? { content: [{ type: "text", text: JSON.stringify(o.result) }], isError: false }
          : { content: [{ type: "text", text: o.error }], isError: true },
      );
    }
    default:
      return fail(id, -32601, `Method not found: ${m.method}`);
  }
}

export async function handleMcp(req: Request, db: AgentDb, conn: Connection): Promise<Response> {
  if (req.method !== "POST") {
    // No server-sent event stream and no sessions to end.
    return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
  }
  const body = await readJson(req, 64 * 1024);
  if (!body.ok) {
    return json(
      fail(
        null,
        body.status === 413 ? -32600 : -32700,
        body.status === 413 ? "Request too large" : "Parse error",
      ),
      body.status,
    );
  }
  const value = body.value;
  if (Array.isArray(value)) {
    if (value.length === 0 || value.length > 20)
      return json(fail(null, -32600, "Invalid Request"), 400);
    const replies = (await Promise.all(value.map((m) => handleOne(db, conn, m)))).filter(
      (r) => r !== null,
    );
    return replies.length ? json(replies) : empty(202);
  }
  const reply = await handleOne(db, conn, value as RpcMessage);
  return reply ? json(reply) : empty(202);
}
