/**
 * THE WHITELIST: everything an agent can do. One entry per `public.agent_<name>` SQL function
 * (supabase/migrations/20261025000200_agent_tools.sql); nothing else is reachable. To add a tool:
 *   1. a SECURITY INVOKER `agent_<name>` function that starts with `agent_private.ctx()` and
 *      writes one audit row (a new migration),
 *   2. one entry below (arguments, description, whether it changes data),
 *   3. tests: pgTAP for the function (and the catalog list in 043), vitest for the entry.
 * tools.test.ts fails when the registry and the migrations disagree.
 *
 * Arguments are validated here (clear 400s) and again in SQL (the function is the real gate).
 * The SQL text lives here as constants; nothing a caller sends ever becomes SQL.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

interface FieldSpec {
  type: "string" | "integer";
  description: string;
  /** string: length in characters; integer: value */
  min?: number;
  max?: number;
  default?: number;
  enum?: readonly string[];
  nullable?: boolean;
  required?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  /** Changes data: needs a connection with write access. */
  write: boolean;
  properties: Record<string, FieldSpec>;
  /** `select public.agent_<name>($1…) as r`, with explicit casts. */
  sql: string;
  /** The SQL parameters, from validated arguments. */
  params: (args: Record<string, Json>) => unknown[];
}

const PATCH_FIELDS = ["name", "phone", "email", "location", "notes"] as const;

export const TOOLS: readonly ToolDef[] = [
  {
    name: "whoami",
    description:
      "Who the connected person is: their name, stage and role, their team, today's date for the team, and what this connection may do (read or write). Call it first.",
    write: false,
    properties: {},
    sql: "select public.agent_whoami() as r",
    params: () => [],
  },
  {
    name: "list_prospects",
    description:
      "List the prospects the connected person can see: their own and their downline's. Each has id, name, phone, email, location, notes and sponsor_id.",
    write: false,
    properties: {
      limit: {
        type: "integer",
        description: "How many to return, 1 to 200 (default 50).",
        min: 1,
        max: 200,
        default: 50,
      },
    },
    sql: "select public.agent_list_prospects($1::int) as r",
    params: (a) => [a.limit ?? 50],
  },
  {
    name: "add_prospect",
    description:
      "Add a prospect under the connected person. Only a name and an optional phone number; use update_prospect to add more details afterwards.",
    write: true,
    properties: {
      name: {
        type: "string",
        description: "The prospect's name.",
        min: 1,
        max: 120,
        required: true,
      },
      phone: { type: "string", description: "Phone number (optional).", max: 40 },
    },
    sql: "select public.agent_add_prospect($1::text, $2::text) as r",
    params: (a) => [a.name, a.phone ?? null],
  },
  {
    name: "update_prospect",
    description:
      "Change a prospect's name, phone, email, location or notes. Send the id and only the fields to change; null clears a field (not the name). Nothing else about a person can be changed through this connector, and a field outside that list is refused.",
    write: true,
    properties: {
      id: {
        type: "string",
        description: "The prospect's id (from list_prospects).",
        min: 1,
        max: 100,
        required: true,
      },
      name: { type: "string", description: "New name.", min: 1, max: 120 },
      phone: {
        type: "string",
        description: "New phone number, or null to clear.",
        max: 40,
        nullable: true,
      },
      email: {
        type: "string",
        description: "New e-mail address, or null to clear.",
        max: 200,
        nullable: true,
      },
      location: {
        type: "string",
        description: "New location, or null to clear.",
        max: 200,
        nullable: true,
      },
      notes: {
        type: "string",
        description: "New notes (replaces the old text), or null to clear.",
        max: 4000,
        nullable: true,
      },
    },
    sql: "select public.agent_update_prospect($1::text, $2::text::jsonb) as r", // ::text::jsonb: postgres.js double-encodes a string bound as jsonb
    params: (a) => {
      const patch: Record<string, Json> = {};
      for (const k of PATCH_FIELDS) if (k in a) patch[k] = a[k];
      return [a.id, JSON.stringify(patch)];
    },
  },
  {
    name: "list_upcoming_events",
    description:
      "Team events that have not ended yet, soonest first: id, name, date, end_date, category, location and my_answer (the connected person's own answer: yes, no, maybe, or null if none yet). Dates only: an event's start and end times of day are not included.",
    write: false,
    properties: {},
    sql: "select public.agent_list_upcoming_events() as r",
    params: () => [],
  },
  {
    name: "set_event_answer",
    description:
      "Set the connected person's own answer to an event: yes, no or maybe. It only ever sets their own answer, never anyone else's.",
    write: true,
    properties: {
      event_id: {
        type: "string",
        description: "The event's id (from list_upcoming_events).",
        min: 1,
        max: 100,
        required: true,
      },
      answer: {
        type: "string",
        description: "yes, no or maybe.",
        enum: ["yes", "no", "maybe"],
        required: true,
      },
    },
    sql: "select public.agent_set_event_answer($1::text, $2::text) as r",
    params: (a) => [a.event_id, a.answer],
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export function findTool(name: string): ToolDef | undefined {
  return BY_NAME.get(name);
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
}

export function inputSchema(t: ToolDef): JsonSchema {
  const properties: JsonSchema["properties"] = {};
  const required: string[] = [];
  for (const [k, f] of Object.entries(t.properties)) {
    const p: Record<string, unknown> = {
      type: f.nullable ? [f.type, "null"] : f.type,
      description: f.description,
    };
    if (f.type === "string") {
      if (f.min !== undefined) p.minLength = f.min;
      if (f.max !== undefined) p.maxLength = f.max;
    } else {
      if (f.min !== undefined) p.minimum = f.min;
      if (f.max !== undefined) p.maximum = f.max;
    }
    if (f.default !== undefined) p.default = f.default;
    if (f.enum) p.enum = [...f.enum];
    properties[k] = p;
    if (f.required) required.push(k);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/** The tool list as the plain HTTP surface and the pairing reply show it. */
export function toolList() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    changes_data: t.write,
    input_schema: inputSchema(t),
  }));
}

const chars = (s: string) => Array.from(s).length;

export type Validated = { ok: true; args: Record<string, Json> } | { ok: false; error: string };

/** Check a call's arguments against the entry; unknown fields are refused, never ignored. */
export function validateArgs(t: ToolDef, raw: unknown): Validated {
  const input = raw === undefined || raw === null ? {} : raw;
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid arguments: send a JSON object." };
  }
  const given = input as Record<string, unknown>;
  const names = Object.keys(t.properties);
  const problems: string[] = [];
  for (const k of Object.keys(given)) {
    if (!Object.hasOwn(t.properties, k)) {
      problems.push(
        `${k}: not a field of ${t.name}` +
          (names.length ? ` (allowed: ${names.join(", ")})` : " (it takes no arguments)"),
      );
    }
  }
  const args: Record<string, Json> = {};
  for (const [k, f] of Object.entries(t.properties)) {
    if (!Object.hasOwn(given, k) || given[k] === undefined) {
      if (f.required) problems.push(`${k}: required`);
      else if (f.default !== undefined) args[k] = f.default;
      continue;
    }
    const v = given[k];
    if (v === null) {
      if (f.nullable) args[k] = null;
      else problems.push(`${k}: cannot be null`);
      continue;
    }
    if (f.type === "string") {
      if (typeof v !== "string") problems.push(`${k}: must be text`);
      else if (f.enum && !f.enum.includes(v))
        problems.push(`${k}: must be one of ${f.enum.join(", ")}`);
      else if (f.min !== undefined && chars(v.trim()) < f.min)
        problems.push(`${k}: must not be empty`);
      else if (f.max !== undefined && chars(v) > f.max)
        problems.push(`${k}: at most ${f.max} characters`);
      else args[k] = v;
    } else if (typeof v !== "number" || !Number.isInteger(v)) {
      problems.push(`${k}: must be a whole number`);
    } else if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) {
      problems.push(`${k}: must be between ${f.min} and ${f.max}`);
    } else args[k] = v;
  }
  if (
    t.name === "update_prospect" &&
    problems.length === 0 &&
    !PATCH_FIELDS.some((k) => k in args)
  ) {
    problems.push("nothing to change: give at least one of " + PATCH_FIELDS.join(", "));
  }
  if (problems.length) return { ok: false, error: "Invalid arguments: " + problems.join("; ") };
  return { ok: true, args };
}
