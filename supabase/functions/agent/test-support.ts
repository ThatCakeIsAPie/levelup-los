/** A fake AgentDb for the unit tests (not imported by the function itself). */
import { sha256Hex } from "./crypto.ts";
import { DbError, type AgentDb, type Access, type Connection, type Redeemed } from "./db.ts";

export const WORKSPACE = "Test Team";

export class FakeDb implements AgentDb {
  /** code hash -> state */
  pairings = new Map<
    string,
    { access: Access; used: boolean; expired: boolean; allowed: boolean }
  >();
  /** key hash -> connection */
  connections = new Map<string, Connection & { revoked: boolean }>();
  failures: string[] = [];
  blockAfter = 8;
  lookups = 0;
  redeems = 0;
  toolCalls: { conn: Connection; sql: string; params: unknown[] }[] = [];
  refusals: { connectionId: string; tool: string; args: unknown; result: string }[] = [];
  /** What the next tool call returns, or throws. */
  toolResult: unknown | (() => unknown) = { ok: true };
  nextConnection = 1;

  async addPairing(
    code: string,
    access: Access = "write",
    over: Partial<{ used: boolean; expired: boolean; allowed: boolean }> = {},
  ) {
    this.pairings.set(await sha256Hex(code), {
      access,
      used: false,
      expired: false,
      allowed: true,
      ...over,
    });
  }
  async addConnection(
    key: string,
    access: Access = "write",
    over: Partial<Connection & { revoked: boolean }> = {},
  ) {
    const c = {
      id: `00000000-0000-4000-8000-00000000c0${this.nextConnection++}`,
      userId: "00000000-0000-4000-8000-0000000a9002",
      personId: "p1",
      workspaceId: "w1",
      workspaceName: WORKSPACE,
      label: "Dot",
      access,
      revoked: false,
      ...over,
    };
    this.connections.set(await sha256Hex(key), c);
    return c;
  }

  async lookupConnection(keyHash: string) {
    this.lookups++;
    const c = this.connections.get(keyHash);
    return c && !c.revoked ? c : null;
  }
  async redeemPairing(codeHash: string, keyHash: string, label: string): Promise<Redeemed | null> {
    this.redeems++;
    const p = this.pairings.get(codeHash);
    if (!p || p.used || p.expired || !p.allowed) return null;
    p.used = true;
    const id = `00000000-0000-4000-8000-00000000c0${this.nextConnection++}`;
    this.connections.set(keyHash, {
      id,
      userId: "u",
      personId: "p1",
      workspaceId: "w1",
      workspaceName: WORKSPACE,
      label,
      access: p.access,
      revoked: false,
    });
    return {
      connectionId: id,
      access: p.access,
      personName: "Alex Apprentice",
      workspaceName: WORKSPACE,
      createdAt: "2026-11-14T00:00:00Z",
    };
  }
  async pairBlocked(ipHash: string) {
    return this.failures.filter((f) => f === ipHash).length >= this.blockAfter;
  }
  async pairFailed(ipHash: string) {
    this.failures.push(ipHash);
  }
  async callTool(conn: Connection, sql: string, params: unknown[]) {
    this.toolCalls.push({ conn, sql, params });
    const r =
      typeof this.toolResult === "function"
        ? (this.toolResult as () => unknown)()
        : this.toolResult;
    return r;
  }
  async recordRefusal(connectionId: string, tool: string, args: unknown, result: string) {
    this.refusals.push({ connectionId, tool, args, result });
  }
}

export const throwing = (code: string, message: string) => () => {
  throw new DbError(code, message);
};

export const CODE = "ABCD-EFGH-JKLM-NPQR";
export const KEY_RE = /^crmak_[A-Za-z0-9_-]{43}$/;
export const BASE = "https://example-ref.supabase.co/functions/v1/agent";

export const req = (
  path: string,
  init: Omit<RequestInit, "body"> & { key?: string; body?: unknown } = {},
) => {
  const { key, body, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (key) headers.set("authorization", `Bearer ${key}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${BASE}${path}`, {
    ...rest,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
};
