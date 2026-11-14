/**
 * The hosted database calls behind the AI agents card ("supabase" mode only). These tables and
 * functions are not part of the store sync: the card reads them when it needs them.
 * Migration 20261105000100_agent_connector.sql; docs/backend.md, "Agent connector".
 */
import { getSupabase } from "@/lib/supabase";
import { SUPABASE_URL } from "@/lib/config";
import { parseAgentAccess, type AgentAccessInfo, type AuditEntry } from "./rules";
import { connectorUrl, PAIRING_MINUTES, type AgentAccess } from "./text";

/** The connector's address for this deployment's Supabase project. */
export const CONNECTOR_URL = connectorUrl(SUPABASE_URL);

/** One of the person's connected (not revoked) agents. `label` was chosen by the agent: plain text only. */
export interface AgentConnection {
  id: string;
  label: string;
  access: AgentAccess;
  createdAt: string;
  lastUsedAt: string | null;
}

/** A fresh one-time code. `createdAt` is the database's clock (the code lasts ten minutes from it). */
export interface Pairing {
  code: string;
  access: AgentAccess;
  expiresAt: string;
  createdAt: string;
}

/** `agent_connections` is read by named columns (`key_hash` is not granted: `select *` is refused). */
const CONNECTION_COLUMNS = "id,label,access,created_at,last_used_at";

interface ConnectionRow {
  id: string;
  label: string;
  access: string;
  created_at: string;
  last_used_at: string | null;
}

const toConnection = (r: ConnectionRow): AgentConnection => ({
  id: r.id,
  label: r.label,
  access: r.access === "read" ? "read" : "write",
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
});

/** An error from the database as an Error carrying the server's own message. */
function fail(error: { message?: string } | null | undefined, fallback: string): Error {
  return new Error(error?.message || fallback);
}

/** May this person use the feature (the team's switch, or an app admin's preview)? */
export async function fetchAgentAccess(): Promise<AgentAccessInfo> {
  const { data, error } = await getSupabase().rpc("my_agent_access");
  if (error) throw fail(error, "Could not check access");
  return parseAgentAccess(data);
}

/** A one-time pairing code for the signed-in person. Throws with the server's message when refused. */
export async function createAgentPairing(access: AgentAccess): Promise<Pairing> {
  const { data, error } = await getSupabase().rpc("create_agent_pairing", { p_access: access });
  if (error) throw fail(error, "Could not create a code");
  const o = (data ?? {}) as { code?: unknown; expires_at?: unknown; access?: unknown };
  if (typeof o.code !== "string" || typeof o.expires_at !== "string")
    throw new Error("Could not create a code");
  const expires = Date.parse(o.expires_at);
  return {
    code: o.code,
    access: o.access === "read" ? "read" : "write",
    expiresAt: o.expires_at,
    // The database's clock, not the browser's: the code was made `PAIRING_MINUTES` before it expires.
    createdAt: new Date(expires - PAIRING_MINUTES * 60_000).toISOString(),
  };
}

/** Disconnect one of the person's agents (it cannot be undone). */
export async function revokeAgentConnection(id: string): Promise<void> {
  const { error } = await getSupabase().rpc("revoke_agent_connection", { p_id: id });
  if (error) throw fail(error, "Could not disconnect");
}

/** The person's connected agents, newest first. */
export async function fetchConnections(): Promise<AgentConnection[]> {
  const { data, error } = await getSupabase()
    .from("agent_connections")
    .select(CONNECTION_COLUMNS)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw fail(error, "Could not load connected agents");
  return ((data ?? []) as ConnectionRow[]).map(toConnection);
}

/** The newest connected agent created after `since` (an ISO time of the database's clock), or null. */
export async function fetchConnectionSince(since: string): Promise<AgentConnection | null> {
  const { data, error } = await getSupabase()
    .from("agent_connections")
    .select(CONNECTION_COLUMNS)
    .is("revoked_at", null)
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw fail(error, "Could not check for a new agent");
  const row = ((data ?? []) as ConnectionRow[])[0];
  return row ? toConnection(row) : null;
}

/**
 * What an activity entry needs from `agent_audit`: the tool, the result line, the time and the
 * prospect's name where the tool names one. Arguments and old and new values are not loaded whole:
 * only those names are picked out (PostgREST JSON paths), so no other detail reaches the page.
 */
const AUDIT_COLUMNS =
  "id,tool,result,at,args_name:arguments->>name,new_name:new_values->>name,old_name:old_values->>name";

interface AuditRow {
  id: number;
  tool: string;
  result: string | null;
  at: string;
  args_name: string | null;
  new_name: string | null;
  old_name: string | null;
}

/** The 20 newest calls this connection made (the person's own rows only). */
export async function fetchActivity(connectionId: string): Promise<AuditEntry[]> {
  const { data, error } = await getSupabase()
    .from("agent_audit")
    .select(AUDIT_COLUMNS)
    .eq("connection_id", connectionId)
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(20);
  if (error) throw fail(error, "Could not load activity");
  return ((data ?? []) as unknown as AuditRow[]).map((r) => ({
    id: r.id,
    tool: r.tool,
    result: r.result ?? "",
    at: r.at,
    argsName: r.args_name,
    newName: r.new_name,
    oldName: r.old_name,
  }));
}
