/** POST /pair: a one-time pairing code in, the agent's own connection key out (shown once). */
import { addressHash, cleanLabel, newKey, normaliseCode, sha256Hex } from "./crypto.ts";
import type { AgentDb } from "./db.ts";
import { toolList } from "./tools.ts";
import { json, readJson } from "./http.ts";

/** One reply for every way a code can be unusable: wrong, malformed, used, expired, switched off. */
const REFUSED = {
  error: "invalid_code",
  message:
    "This code is not valid (wrong, already used, or expired). Ask the person to press 'Add agent' again.",
};
const BAD_REQUEST = {
  error: "bad_request",
  message: 'Send JSON: {"code": "<the pairing code>", "label": "<a name for yourself>"}',
};

export async function pair(req: Request, db: AgentDb, base: string): Promise<Response> {
  const ipHash = await addressHash(req.headers);
  if (await db.pairBlocked(ipHash)) {
    return json(
      { error: "too_many_attempts", message: "Too many failed attempts. Wait 10 minutes." },
      429,
      { "retry-after": "600" },
    );
  }
  const refuse = async () => {
    await db.pairFailed(ipHash);
    return json(REFUSED, 403);
  };

  const body = await readJson(req, 4096);
  if (!body.ok) return json(BAD_REQUEST, body.status);
  const b = body.value as { code?: unknown; label?: unknown } | null;
  const label = cleanLabel(b?.label);
  if (typeof b?.code !== "string" || !label) return json(BAD_REQUEST, 400);

  const code = normaliseCode(b.code);
  if (!code) return await refuse();

  const key = newKey();
  const made = await db.redeemPairing(await sha256Hex(code), await sha256Hex(key), label);
  if (!made) return await refuse();

  const mcp = `${base}/mcp`;
  return json(
    {
      connection_key: key,
      key_notice:
        "Shown once. Store it as a secret: never print it, never put it in notes or chat. It works only at the URLs below.",
      connection: {
        id: made.connectionId,
        label,
        access: made.access,
        connected_as_person: made.personName,
        team: made.workspaceName,
        created_at: made.createdAt,
      },
      urls: {
        mcp,
        tools: `${base}/tools`,
        call_tool: `${base}/tools/<name>`,
        pair: `${base}/pair`,
      },
      auth: "Send the header 'Authorization: Bearer <connection_key>' on every call.",
      tools: toolList(),
      setup: {
        claude_code: `claude mcp add --transport http crm ${mcp} --header "Authorization: Bearer $CRM_AGENT_KEY"`,
        codex: `export CRM_AGENT_KEY=<connection_key>   # keep it in your secret store\ncodex mcp add crm --url ${mcp} --bearer-token-env-var CRM_AGENT_KEY`,
        mcp_json: {
          mcpServers: {
            crm: { type: "http", url: mcp, headers: { Authorization: "Bearer <connection_key>" } },
          },
        },
        plain_http: [
          `curl -H "Authorization: Bearer $CRM_AGENT_KEY" ${base}/tools`,
          `curl -X POST -H "Authorization: Bearer $CRM_AGENT_KEY" -H "Content-Type: application/json" -d '{}' ${base}/tools/whoami`,
        ],
      },
      next: "Register the MCP server if you support MCP, otherwise use the plain HTTP calls. Save a short private note on how to use it (never the key). Call whoami and tell the person which name you are connected as.",
    },
    201,
  );
}
