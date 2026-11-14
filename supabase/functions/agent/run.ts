/** The one code path for a tool call: the plain HTTP surface and MCP both end here. */
import { DbError, type AgentDb, type Connection } from "./db.ts";
import { findTool, validateArgs } from "./tools.ts";

export type Outcome = { ok: true; result: unknown } | { ok: false; status: number; error: string };

/** Messages our own SQL raises for a refused call; anything else a database says is not repeated. */
const OWN_REFUSALS =
  /^(agent functions can only|agent connection|this connection is read-only|Agents are not switched on|Only registered team members|This login is not attached)/;
const GENERIC_REFUSAL = "This request was refused.";

export async function runTool(
  db: AgentDb,
  conn: Connection,
  name: string,
  rawArgs: unknown,
  log: (msg: string) => void = console.error,
): Promise<Outcome> {
  const tool = findTool(name);
  if (!tool)
    return { ok: false, status: 404, error: `Unknown tool '${name}'. GET /tools lists them.` };
  const v = validateArgs(tool, rawArgs);
  if (!v.ok) return { ok: false, status: 400, error: v.error };

  const audit = async (result: string) => {
    try {
      await db.recordRefusal(conn.id, tool.name, v.args, result);
    } catch (e) {
      log(`audit of a refusal failed: ${String(e)}`);
    }
  };

  if (tool.write && conn.access !== "write") {
    await audit("refused: read-only connection");
    return {
      ok: false,
      status: 403,
      error: "This connection is read-only. The person can add a new agent with write access.",
    };
  }

  try {
    const r = await db.callTool(conn, tool.sql, tool.params(v.args));
    // A refusal the tool understood (already audited in SQL): {"error": "..."}
    if (
      r &&
      typeof r === "object" &&
      !Array.isArray(r) &&
      typeof (r as { error?: unknown }).error === "string"
    ) {
      return { ok: false, status: 422, error: (r as { error: string }).error };
    }
    return { ok: true, result: r };
  } catch (e) {
    const code = e instanceof DbError ? e.code : "";
    const message = e instanceof Error ? e.message : String(e);
    if (code === "42501" || code === "28000") {
      await audit(`refused: ${message}`.slice(0, 500));
      return {
        ok: false,
        status: 403,
        error: OWN_REFUSALS.test(message) ? message : GENERIC_REFUSAL,
      };
    }
    log(`tool ${tool.name} failed: ${code} ${message}`);
    await audit("failed: the request could not be completed");
    return { ok: false, status: 500, error: "The request could not be completed." };
  }
}
