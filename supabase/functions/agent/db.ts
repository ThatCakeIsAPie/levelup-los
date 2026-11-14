/**
 * What the agent function needs from the database, as a small interface so the logic
 * (routing, validation, pairing, the tool registry, MCP) can be tested with a fake and
 * never imports a database driver. `pg.ts` is the real implementation; `index.ts` is the
 * only Deno-specific file.
 *
 * Every method corresponds to one SQL function: the `agent_private.connector_*` functions
 * the connector role may execute, or one `public.agent_*` tool run as the person.
 */

export type Access = "read" | "write";

/** A live connection, found by the hash of its key. */
export interface Connection {
  id: string;
  /** The login (auth user) the tools run as. */
  userId: string;
  personId: string;
  workspaceId: string;
  workspaceName: string;
  label: string;
  access: Access;
}

/** A pairing code that was redeemed: the connection it created. */
export interface Redeemed {
  connectionId: string;
  access: Access;
  personName: string | null;
  workspaceName: string | null;
  createdAt: string;
}

/** What went wrong inside a tool call (a Postgres error, reduced to what the router needs). */
export class DbError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DbError";
  }
}

export interface AgentDb {
  /** The unrevoked connection for a key hash, touching last_used_at at most once a minute. */
  lookupConnection(keyHash: string): Promise<Connection | null>;
  /** Redeem a pairing code and create the connection; null when the code cannot be redeemed. */
  redeemPairing(codeHash: string, keyHash: string, label: string): Promise<Redeemed | null>;
  /** Too many failed attempts from this (hashed) address? */
  pairBlocked(ipHash: string): Promise<boolean>;
  pairFailed(ipHash: string): Promise<void>;
  /**
   * Run one tool as the person, in one transaction: the login's claims and the connection id
   * as settings, `set local role authenticated`, then the SQL. Returns the first column of the
   * first row (the tool's jsonb). Throws DbError.
   */
  callTool(conn: Connection, sql: string, params: unknown[]): Promise<unknown>;
  /** Audit row for a call that never produced one (the tool raised, or was not reached). */
  recordRefusal(connectionId: string, tool: string, args: unknown, result: string): Promise<void>;
}
