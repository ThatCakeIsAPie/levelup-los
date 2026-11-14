/**
 * The agent connector's request handler: routing, authentication by connection key, the plain
 * HTTP surface and the pairing endpoint. Web-standard Request/Response over the AgentDb
 * interface: no Deno, no driver, testable with vitest. index.ts wires it to the real thing.
 *
 *   POST /pair                        one-time code + label -> connection key (shown once)
 *   POST /mcp                         MCP over Streamable HTTP (mcp.ts)
 *   GET  /tools                       the tool list, as JSON
 *   POST /tools/<name>                one tool call, JSON body = the arguments
 */
import { bearerKey, sha256Hex } from "./crypto.ts";
import type { AgentDb, Connection } from "./db.ts";
import { json, readJson } from "./http.ts";
import { handleMcp } from "./mcp.ts";
import { pair } from "./pair.ts";
import { runTool } from "./run.ts";
import { toolList } from "./tools.ts";

export interface AppDeps {
  /** null when AGENT_DB_URL is not set: everything answers 503 (fail closed). */
  db: AgentDb | null;
  /** https://<project>.supabase.co/functions/v1/agent, no trailing slash. */
  baseUrl: string;
}

const unauthorized = () =>
  json({ error: "invalid_key", message: "Unknown, malformed or revoked connection key." }, 401, {
    "www-authenticate": 'Bearer realm="agent"',
  });

/** The path below the function's name, whatever prefix the gateway puts in front. */
function routePath(url: URL): string {
  return url.pathname.replace(/^.*?\/agent(?=\/|$)/, "").replace(/\/+$/, "") || "/";
}

async function authenticate(req: Request, db: AgentDb): Promise<Connection | null> {
  const key = bearerKey(req.headers.get("authorization"));
  if (!key) return null; // wrong shape: refused without touching the database
  return await db.lookupConnection(await sha256Hex(key));
}

export function createHandler(deps: AppDeps): (req: Request) => Promise<Response> {
  const { db, baseUrl } = deps;
  return async (req) => {
    try {
      // No browser is a supported client and there are no CORS headers: a request that says it comes
      // from a web page is refused before anything else, on every route (MCP 2025-11-25, Streamable
      // HTTP: "servers MUST validate the Origin header ... invalid Origin: 403").
      if (req.headers.has("origin")) {
        return json(
          {
            error: "origin_not_allowed",
            message:
              "This connector is not for web pages: a request with an Origin header is refused.",
          },
          403,
        );
      }
      if (!db) {
        return json(
          {
            error: "not_configured",
            message:
              "The agent connector is not set up on this server: its database secret (AGENT_DB_URL) is missing.",
          },
          503,
        );
      }
      const path = routePath(new URL(req.url));

      if (path === "/pair") {
        return req.method === "POST"
          ? await pair(req, db, baseUrl)
          : json({ error: "method_not_allowed" }, 405, { allow: "POST" });
      }

      if (path === "/mcp" || path === "/tools" || path.startsWith("/tools/")) {
        const conn = await authenticate(req, db);
        if (!conn) return unauthorized();
        if (path === "/mcp") return await handleMcp(req, db, conn);
        if (path === "/tools") {
          if (req.method !== "GET")
            return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
          return json({
            connection: { label: conn.label, access: conn.access },
            tools: toolList(),
          });
        }
        if (req.method !== "POST")
          return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
        let name: string;
        try {
          name = decodeURIComponent(path.slice("/tools/".length));
        } catch {
          return json({ ok: false, error: "Unknown tool." }, 404);
        }
        const body = await readJson(req, 64 * 1024);
        if (!body.ok)
          return json({ ok: false, error: "Body must be JSON of at most 64 KB." }, body.status);
        const o = await runTool(db, conn, name, body.value ?? {});
        return o.ok
          ? json({ ok: true, result: o.result })
          : json({ ok: false, error: o.error }, o.status);
      }

      return json({ error: "not_found" }, 404);
    } catch (e) {
      console.error("agent connector: unhandled", String(e));
      return json({ error: "server_error" }, 500);
    }
  };
}
