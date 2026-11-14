/**
 * The text a person gives their AI agent (Settings > AI agents > Add agent). The wording is final
 * and lives in docs/plans/agent-connector-2026-11-14.md, "The text the button will show";
 * `text.test.ts` compares this template with that block, so the two cannot drift apart.
 * Nothing in it has to be fetched from a web page: an agent is never told to obey a page.
 */

export type AgentAccess = "read" | "write";

/** How long a pairing code works (`create_agent_pairing` sets ten minutes in the database). */
export const PAIRING_MINUTES = 10;

/** `{ACCESS}` in the text, per access level. */
export const ACCESS_LINE: Record<AgentAccess, string> = {
  write: "read and change my CRM data",
  read: "only read my CRM data",
};

const TEMPLATE: readonly string[] = [
  "Please connect to my team CRM. I just created a one-time pairing code; it works once and expires in {MINUTES} minutes.",
  "Connector: {CONNECTOR}",
  "Pairing code: {CODE}",
  "Access: {ACCESS}",
  '1. POST {CONNECTOR}/pair with JSON {"code": "<the code>", "label": "<a name for yourself>"}. The reply holds your connection key, shown only once.',
  "2. Store the key as a secret. Never show it, print it, or write it into notes or chat. It works only at this connector, and I can disconnect it in the CRM at any time.",
  '3. If you support MCP, register {CONNECTOR}/mcp as a remote HTTP MCP server with the header "Authorization: Bearer <your key>" (the /pair reply has ready-made setup lines). Otherwise call GET {CONNECTOR}/tools and POST {CONNECTOR}/tools/<name> with a JSON body, sending the same header.',
  "4. Save a short private note or skill: the connector URL, the tool names, how to call them, and where the key is stored (never the key itself).",
  "5. Call the whoami tool and tell me which name you are connected as.",
];

/** The connector's base URL for a project: `<Supabase URL>/functions/v1/agent`. */
export function connectorUrl(supabaseUrl: string): string {
  return `${supabaseUrl.trim().replace(/\/+$/, "")}/functions/v1/agent`;
}

export interface PairingTextInput {
  /** `{CONNECTOR}`: the function URL, without a trailing slash. */
  connector: string;
  /** `{CODE}`: the one-time code as `create_agent_pairing` returned it. */
  code: string;
  access: AgentAccess;
  /** `{MINUTES}` */
  minutes?: number;
}

/** The whole text for the agent, ready to copy. */
export function pairingText(i: PairingTextInput): string {
  const values: Record<string, string> = {
    "{MINUTES}": String(i.minutes ?? PAIRING_MINUTES),
    "{CONNECTOR}": i.connector,
    "{CODE}": i.code,
    "{ACCESS}": ACCESS_LINE[i.access],
  };
  return TEMPLATE.join("\n").replace(
    /\{(MINUTES|CONNECTOR|CODE|ACCESS)\}/g,
    (token) => values[token],
  );
}
