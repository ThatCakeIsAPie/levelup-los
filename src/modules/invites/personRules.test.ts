import { describe, expect, it } from "vitest";
import {
  canOfferInvite,
  inviteEmailProblem,
  inviteStatusLine,
  signInState,
  type PersonInvite,
} from "./personRules";

const now = new Date("2026-10-18T12:00:00Z");
const invite: PersonInvite = {
  token: "t",
  email: "sam@example.com",
  createdAt: "2026-10-17T12:00:00Z",
  expiresAt: "2026-10-31T12:00:00Z",
};

describe("signInState", () => {
  it("is none, open or expired", () => {
    expect(signInState(null, now)).toBe("none");
    expect(signInState(invite, now)).toBe("open");
    expect(signInState({ ...invite, expiresAt: "2026-10-18T11:59:59Z" }, now)).toBe("expired");
    expect(signInState({ ...invite, expiresAt: "2026-10-18T12:00:00Z" }, now)).toBe("expired");
  });
});

describe("inviteStatusLine", () => {
  it("says when it was sent and when the link expires or expired", () => {
    expect(inviteStatusLine(invite, now)).toMatch(/^Invited .+, link expires .+$/);
    expect(inviteStatusLine({ ...invite, expiresAt: "2026-10-18T00:00:00Z" }, now)).toMatch(
      /^Invited .+, link expired .+$/,
    );
  });
});

describe("canOfferInvite", () => {
  const base = {
    viewer: { personId: "1", role: "leader" as const },
    actsAsLeader: true,
    person: { id: "9", bizClass: "apprentice" },
    inDownline: true,
    hasLogin: false,
  };
  it("offers it for a registered person without a login in the viewer's reach", () => {
    expect(canOfferInvite(base)).toBe(true);
    expect(canOfferInvite({ ...base, person: { id: "9", bizClass: "ibo" } })).toBe(true);
  });
  it("is for registered people only", () => {
    expect(canOfferInvite({ ...base, person: { id: "9", bizClass: "prospect" } })).toBe(false);
    expect(canOfferInvite({ ...base, person: { id: "9", bizClass: "customer" } })).toBe(false);
  });
  it("hides it for people who sign in and for the viewer themselves", () => {
    expect(canOfferInvite({ ...base, hasLogin: true })).toBe(false);
    expect(canOfferInvite({ ...base, person: { id: "1", bizClass: "ibo" } })).toBe(false);
  });
  it("hides it from candidates", () => {
    expect(canOfferInvite({ ...base, viewer: { personId: "20", role: "candidate" } })).toBe(false);
  });
  it("needs the downline, or a leader (or deputy) acting as leader", () => {
    const ibo = { ...base, viewer: { personId: "2", role: "ibo" as const }, actsAsLeader: false };
    expect(canOfferInvite({ ...ibo, inDownline: true })).toBe(true);
    expect(canOfferInvite({ ...ibo, inDownline: false })).toBe(false);
    expect(canOfferInvite({ ...ibo, inDownline: false, actsAsLeader: true })).toBe(true);
  });
});

describe("inviteEmailProblem", () => {
  it("requires a plausible address", () => {
    expect(inviteEmailProblem("")).toMatch(/Add their email/);
    expect(inviteEmailProblem("   ")).toMatch(/Add their email/);
    expect(inviteEmailProblem("sam@")).toMatch(/doesn't look right/);
    expect(inviteEmailProblem(" sam@example.com ")).toBeNull();
  });
});
