import { describe, expect, it } from "vitest";
import {
  acceptFailure,
  inviteExpiry,
  inviteState,
  looksLikeEmail,
  type InvitePreview,
} from "./rules";

const now = new Date("2026-10-12T12:00:00Z");
const preview: InvitePreview = {
  workspace_id: "w1",
  workspace_name: "Demo Team",
  sponsor_name: "Anita Patel",
  stage: "prospect",
  name: null,
  email: null,
  expires_at: "2026-10-20T12:00:00Z",
  is_valid: true,
  for_person: false,
};

describe("inviteState", () => {
  it("reads valid, used, expired and missing invites", () => {
    expect(inviteState(preview, now)).toBe("valid");
    expect(inviteState({ ...preview, is_valid: false }, now)).toBe("used");
    expect(
      inviteState({ ...preview, is_valid: false, expires_at: "2026-10-01T00:00:00Z" }, now),
    ).toBe("expired");
    expect(inviteState(null, now)).toBe("notFound");
  });
});

describe("inviteExpiry", () => {
  it("is 14 days out", () => {
    expect(inviteExpiry(now)).toBe("2026-10-26T12:00:00.000Z");
  });
});

describe("acceptFailure", () => {
  it("maps accept_invite errors", () => {
    expect(acceptFailure({ message: "This invite has already been used" })).toBe("used");
    expect(acceptFailure({ message: "This invite has expired" })).toBe("expired");
    expect(acceptFailure({ message: "You are already a member of this team", code: "23505" })).toBe(
      "alreadyMember",
    );
    expect(acceptFailure({ message: "Invite not found", code: "P0002" })).toBe("notFound");
    expect(acceptFailure({ message: "Sign in before accepting an invite", code: "28000" })).toBe(
      "signedOut",
    );
    expect(acceptFailure({ message: "This person already has a sign-in", code: "22023" })).toBe(
      "alreadyHasSignIn",
    );
    expect(
      acceptFailure({
        message: "This invite was sent to a different email address",
        code: "42501",
      }),
    ).toBe("wrongEmail");
    expect(acceptFailure({ message: "Confirm your email address first", code: "42501" })).toBe(
      "wrongEmail",
    );
    expect(acceptFailure({ message: "Person not found: they are no longer on the team" })).toBe(
      "notFound",
    );
    expect(acceptFailure({ message: "boom" })).toBe("other");
  });
});

describe("looksLikeEmail", () => {
  it("accepts emails and rejects junk", () => {
    expect(looksLikeEmail(" sam@example.com ")).toBe(true);
    expect(looksLikeEmail("sam@example")).toBe(false);
    expect(looksLikeEmail("sam")).toBe(false);
  });
});
