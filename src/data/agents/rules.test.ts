import { describe, expect, it } from "vitest";
import {
  agentCardVisible,
  entryPersonName,
  isRefusal,
  parseAgentAccess,
  relativeTime,
  shortDate,
  toolLabel,
  type AgentAccessInfo,
  type AuditEntry,
} from "./rules";

const info = (over: Partial<AgentAccessInfo> = {}): AgentAccessInfo => ({
  allowed: true,
  reason: null,
  switchOn: true,
  preview: false,
  ...over,
});

describe("who sees the AI agents card", () => {
  it("needs the hosted data source", () => {
    expect(agentCardVisible("local", info())).toBe(false);
    expect(agentCardVisible("supabase", info())).toBe(true);
  });

  it("needs the database to allow it (team switch on, or an app admin's preview)", () => {
    expect(agentCardVisible("supabase", info({ switchOn: true, allowed: true }))).toBe(true);
    expect(
      agentCardVisible("supabase", info({ switchOn: false, preview: true, allowed: true })),
    ).toBe(true);
    for (const reason of ["switched_off", "not_registered", "no_person"]) {
      expect(agentCardVisible("supabase", info({ allowed: false, reason, switchOn: false }))).toBe(
        false,
      );
    }
  });

  it("shows nothing while the answer is unknown", () => {
    expect(agentCardVisible("supabase", null)).toBe(false);
  });

  it("reads my_agent_access() and treats anything unexpected as not allowed", () => {
    expect(
      parseAgentAccess({
        allowed: true,
        reason: null,
        message: null,
        switch_on: false,
        preview: true,
      }),
    ).toEqual({ allowed: true, reason: null, switchOn: false, preview: true });
    expect(
      parseAgentAccess({ allowed: false, reason: "not_registered", switch_on: true }).allowed,
    ).toBe(false);
    expect(parseAgentAccess(null).allowed).toBe(false);
    expect(parseAgentAccess({ allowed: "yes" }).allowed).toBe(false);
  });
});

describe("activity entries", () => {
  it("names the known tools in plain words and shows unknown ones as they are", () => {
    expect(toolLabel("add_prospect")).toBe("Added a prospect");
    expect(toolLabel("update_prospect")).toBe("Changed a prospect");
    expect(toolLabel("list_prospects")).toBe("Listed prospects");
    expect(toolLabel("whoami")).toBe("Checked who it is connected as");
    expect(toolLabel("list_upcoming_events")).toBe("Listed upcoming events");
    expect(toolLabel("export_events_ics")).toBe("Exported events");
    expect(toolLabel("set_event_answer")).toBe("Answered an event");
    expect(toolLabel("list_team")).toBe("Listed the team");
    expect(toolLabel("list_customers")).toBe("Listed customers");
    expect(toolLabel("get_person")).toBe("Looked up a person");
    expect(toolLabel("update_my_profile")).toBe("Changed own profile");
    expect(toolLabel("log_learning")).toBe("Logged learning");
    expect(toolLabel("list_learning")).toBe("Listed learning");
    expect(toolLabel("send_carrier_pigeon")).toBe("send_carrier_pigeon");
    // A name that is an Object.prototype key is not "known".
    expect(toolLabel("constructor")).toBe("constructor");
    expect(toolLabel("toString")).toBe("toString");
  });

  const entry = (over: Partial<AuditEntry>): AuditEntry => ({
    id: 1,
    tool: "add_prospect",
    result: "created x",
    at: "2026-11-14T12:00:00Z",
    argsName: null,
    newName: null,
    oldName: null,
    ...over,
  });

  it("shows a looked-up person's name from the audit row, and nothing for a refused lookup", () => {
    expect(entryPersonName(entry({ tool: "get_person", newName: "Bea Ibo" }))).toBe("Bea Ibo");
    expect(entryPersonName(entry({ tool: "get_person", newName: "  " }))).toBeNull();
    // a refused lookup carries no new values; the id it sent is not a name
    expect(entryPersonName(entry({ tool: "get_person", argsName: "agxx" }))).toBeNull();
    for (const tool of ["list_team", "list_customers", "update_my_profile", "log_learning"])
      expect(entryPersonName(entry({ tool, newName: "Not Shown" })), tool).toBeNull();
  });

  it("shows a prospect's name only for the prospect tools", () => {
    expect(entryPersonName(entry({ newName: "Zed Added", argsName: "zed" }))).toBe("Zed Added");
    expect(entryPersonName(entry({ argsName: "Sent Name" }))).toBe("Sent Name");
    expect(
      entryPersonName(entry({ tool: "update_prospect", oldName: "Old", newName: "New" })),
    ).toBe("New");
    expect(entryPersonName(entry({ tool: "update_prospect", oldName: "Old" }))).toBe("Old");
    // A refused change to someone outside the person's view has no name to show.
    expect(entryPersonName(entry({ tool: "update_prospect", argsName: "ignored" }))).toBeNull();
    expect(entryPersonName(entry({ tool: "list_prospects", newName: "No" }))).toBeNull();
    expect(entryPersonName(entry({ newName: "  ", argsName: null }))).toBeNull();
  });

  it("marks refused and failed calls", () => {
    expect(isRefusal("refused: no such prospect among the visible ones")).toBe(true);
    expect(isRefusal("failed: the request could not be completed")).toBe(true);
    expect(isRefusal("created 123")).toBe(false);
    expect(isRefusal("3 rows")).toBe(false);
    expect(isRefusal("")).toBe(false);
  });
});

describe("dates", () => {
  const now = Date.parse("2026-11-14T18:00:00Z");
  it("reads a time as 'just now', minutes, hours, days, then the date", () => {
    expect(relativeTime("2026-11-14T17:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-11-14T17:59:00Z", now)).toBe("1 minute ago");
    expect(relativeTime("2026-11-14T17:15:00Z", now)).toBe("45 minutes ago");
    expect(relativeTime("2026-11-14T16:00:00Z", now)).toBe("2 hours ago");
    expect(relativeTime("2026-11-12T17:00:00Z", now)).toBe("2 days ago");
    expect(relativeTime("2026-10-01T12:00:00Z", now)).toBe("Oct 1");
    expect(relativeTime("nonsense", now)).toBe("");
  });

  it("adds the year only when it is not this year", () => {
    expect(shortDate("2026-11-03T12:00:00Z", now)).toBe("Nov 3");
    expect(shortDate("2025-11-03T12:00:00Z", now)).toBe("Nov 3, 2025");
  });
});
