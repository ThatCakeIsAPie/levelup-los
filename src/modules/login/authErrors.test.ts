import { describe, expect, it } from "vitest";
import { friendlyAuthError } from "./authErrors";

describe("friendlyAuthError", () => {
  it("explains a wrong email or password", () => {
    expect(
      friendlyAuthError({ code: "invalid_credentials", message: "Invalid login credentials" }),
    ).toBe("That email or password doesn't match.");
    expect(friendlyAuthError({ message: "Invalid login credentials" })).toBe(
      "That email or password doesn't match.",
    );
  });
  it("points unknown emails at an invite", () => {
    expect(
      friendlyAuthError({ code: "otp_disabled", message: "Signups not allowed for otp" }),
    ).toMatch(/invite link/);
  });
  it("covers expired links, rate limits and the network", () => {
    expect(friendlyAuthError({ code: "otp_expired" })).toMatch(/expired/);
    expect(friendlyAuthError({ status: 429, message: "x" })).toMatch(/Too many/);
    expect(
      friendlyAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch" }),
    ).toMatch(/reach the server/);
  });
  it("falls back to the message, then a generic line", () => {
    expect(friendlyAuthError({ message: "Teapot" })).toBe("Teapot");
    expect(friendlyAuthError(undefined)).toMatch(/Something went wrong/);
  });
});
