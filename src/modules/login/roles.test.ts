import { describe, expect, it } from "vitest";
import { canInvite, deriveRole, effectiveStage, sessionUserFrom, toWorkspaceRole } from "./roles";

const today = new Date(2026, 9, 12); // 2026-10-12, local

describe("toWorkspaceRole", () => {
  it("keeps known roles and falls back to member", () => {
    expect(toWorkspaceRole("leader")).toBe("leader");
    expect(toWorkspaceRole("moderator")).toBe("moderator");
    expect(toWorkspaceRole("member")).toBe("member");
    expect(toWorkspaceRole("admin")).toBe("member");
    expect(toWorkspaceRole(null)).toBe("member");
  });
});

describe("effectiveStage", () => {
  it("promotes an apprentice after one contract year", () => {
    expect(effectiveStage("apprentice", "2025-10-12", today)).toBe("ibo");
    expect(effectiveStage("apprentice", "2025-10-13", today)).toBe("apprentice");
    expect(effectiveStage("apprentice", null, today)).toBe("apprentice");
  });
  it("leaves other stages alone and flags unknown ones", () => {
    expect(effectiveStage("prospect", "2020-01-01", today)).toBe("prospect");
    expect(effectiveStage("ibo", null, today)).toBe("ibo");
    expect(effectiveStage("customer", null, today)).toBe("customer");
    expect(effectiveStage("boss", null, today)).toBe("unknown");
  });
});

describe("deriveRole", () => {
  it("makes workspace leaders leaders whatever their stage", () => {
    expect(deriveRole("leader", "prospect", null, today)).toBe("leader");
    expect(deriveRole("leader", "ibo", null, today)).toBe("leader");
  });
  it("maps everyone else by effective stage", () => {
    expect(deriveRole("member", "ibo", null, today)).toBe("ibo");
    expect(deriveRole("moderator", "ibo", null, today)).toBe("ibo");
    expect(deriveRole("member", "apprentice", "2026-03-01", today)).toBe("apprentice");
    expect(deriveRole("member", "apprentice", "2024-03-01", today)).toBe("ibo");
    expect(deriveRole("member", "prospect", null, today)).toBe("candidate");
    expect(deriveRole("member", "customer", null, today)).toBe("candidate");
    expect(deriveRole("member", "weird", null, today)).toBe("candidate");
  });
});

describe("sessionUserFrom", () => {
  const row = {
    person_id: "4",
    workspace_id: "w1",
    name: "Jamal Brown",
    member_role: "member",
    biz_class: "apprentice",
    effective_stage: "apprentice",
  };
  it("builds the DemoUser-shaped session user", () => {
    expect(sessionUserFrom(row)).toEqual({
      personId: "4",
      name: "Jamal Brown",
      role: "apprentice",
    });
  });
  it("uses the effective stage and the team role", () => {
    expect(sessionUserFrom({ ...row, effective_stage: "ibo" }).role).toBe("ibo");
    expect(
      sessionUserFrom({ ...row, biz_class: "prospect", effective_stage: "prospect" }).role,
    ).toBe("candidate");
    expect(
      sessionUserFrom({ ...row, member_role: "leader", effective_stage: "prospect" }).role,
    ).toBe("leader");
  });
});

describe("canInvite", () => {
  it("lets people with a team invite", () => {
    expect(canInvite("leader")).toBe(true);
    expect(canInvite("ibo")).toBe(true);
    expect(canInvite("apprentice")).toBe(true);
    expect(canInvite("candidate")).toBe(false);
    expect(canInvite(undefined)).toBe(false);
  });
});
