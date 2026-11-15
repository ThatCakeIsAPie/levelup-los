/**
 * Pure rules for the AI agents card: who sees it, how an audit row reads, how a connection's
 * dates read. Nothing here touches the network or the stores (`./api.ts` and the card do).
 */
import type { DataSource } from "@/lib/config";
import type { AgentAccess } from "./text";

/** What `my_agent_access()` answers (migration 20261105000100_agent_connector). */
export interface AgentAccessInfo {
  allowed: boolean;
  /** `no_person`, `not_registered` or `switched_off` when `allowed` is false. */
  reason: string | null;
  /** True when the team's switch is on. */
  switchOn: boolean;
  /** True when only the app-admin preview allows it (the team's switch is still off). */
  preview: boolean;
}

/**
 * Does the Settings page show the AI agents card? Only with the hosted data source (the browser
 * demo has no connector) and only when the database says this person may use it: the team's
 * switch is on, or an app admin previews it, and the person is registered. While the answer is
 * unknown (loading, or the call failed) nothing shows, not even a placeholder.
 */
export function agentCardVisible(source: DataSource, access: AgentAccessInfo | null): boolean {
  return source === "supabase" && access?.allowed === true;
}

/** The `my_agent_access()` jsonb as the app reads it; anything unexpected means "not allowed". */
export function parseAgentAccess(raw: unknown): AgentAccessInfo {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    allowed: o.allowed === true,
    reason: typeof o.reason === "string" ? o.reason : null,
    switchOn: o.switch_on === true,
    preview: o.preview === true,
  };
}

export const ACCESS_LABEL: Record<AgentAccess, string> = {
  write: "Can change",
  read: "Read only",
};

/** The tool names an agent can call (supabase/functions/agent/tools.ts), in plain words. */
const TOOL_LABEL: Record<string, string> = {
  whoami: "Checked who it is connected as",
  list_prospects: "Listed prospects",
  add_prospect: "Added a prospect",
  update_prospect: "Changed a prospect",
  list_upcoming_events: "Listed upcoming events",
  export_events_ics: "Exported events",
  set_event_answer: "Answered an event",
  list_team: "Listed the team",
  list_customers: "Listed customers",
  get_person: "Looked up a person",
  update_my_profile: "Changed own profile",
  log_learning: "Logged learning",
  list_learning: "Listed learning",
  list_cards: "Listed cards",
  get_card: "Looked up a card",
  list_card_tasks: "Listed card tasks",
  add_card_task: "Added a card task",
  update_card_task: "Changed a card task",
  complete_card_task: "Ticked a card task",
  add_card_note: "Added a card note",
};

/** A short label for a tool; a name that is not known is shown as it is. */
export function toolLabel(tool: string): string {
  return Object.prototype.hasOwnProperty.call(TOOL_LABEL, tool) ? TOOL_LABEL[tool] : tool;
}

/** One `agent_audit` row, reduced to what the card shows (see `AUDIT_COLUMNS` in ./api.ts). */
export interface AuditEntry {
  id: number;
  tool: string;
  result: string;
  at: string;
  /** `arguments ->> name`, `new_values ->> name`, `old_values ->> name`: the name of the person the call was about. */
  argsName: string | null;
  newName: string | null;
  oldName: string | null;
}

/**
 * The person's name for the tools that are about one person, nothing for any other tool: an added
 * prospect by the name that was sent (or stored), a changed one by its stored name (the new one, else
 * the one it had), a looked-up person by the name the tool recorded, a card tool by its card's person.
 * A refused call about a person the caller cannot see has no name to show.
 */
export function entryPersonName(e: AuditEntry): string | null {
  const clean = (s: string | null) => (s && s.trim() ? s : null);
  if (e.tool === "add_prospect") return clean(e.newName) ?? clean(e.argsName);
  if (e.tool === "update_prospect") return clean(e.newName) ?? clean(e.oldName);
  if (e.tool === "get_person") return clean(e.newName);
  // The card tools record the card's person (new_values, and old_values for a changed task); the
  // listing tools are about many cards and record none.
  if (CARD_PERSON_TOOLS.includes(e.tool)) return clean(e.newName) ?? clean(e.oldName);
  return null;
}

/** The card tools that are about one card: the audit row carries its person's name. */
const CARD_PERSON_TOOLS = [
  "get_card",
  "add_card_task",
  "update_card_task",
  "complete_card_task",
  "add_card_note",
];

/** A call the connector or a tool turned down, or one that failed (the connector writes these prefixes). */
export function isRefusal(result: string): boolean {
  return /^(refused|failed)\b/i.test(result.trim());
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", then the date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 1) return "just now";
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (mins < 60) return unit(mins, "minute");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return unit(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return unit(days, "day");
  return shortDate(iso, now);
}

/** "Nov 14", with the year when it is not this year's. */
export function shortDate(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "Nov 14, 3:42 PM" (an activity entry). */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
