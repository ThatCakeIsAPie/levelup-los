import { describe, expect, it } from "vitest";
import { DEFAULT_FEEDBACK_REPO, buildIssueUrl, resolveFeedbackRepo } from "./github";
import type { FeedbackContext } from "./types";

const context: FeedbackContext = {
  path: "/pipeline",
  search: "?tab=board",
  title: "Pipeline",
  viewport: { width: 1440, height: 900 },
  theme: "dark",
  userAgent: "UA",
  brand: "slug",
  appVersion: "abc1234",
  clientTime: "2026-11-12T10:00:00.000Z",
  senderName: "Maria Santos",
};

describe("resolveFeedbackRepo", () => {
  it("defaults to the upstream repo when unset or blank", () => {
    expect(DEFAULT_FEEDBACK_REPO).toBe("ThatCakeIsAPie/levelup-los");
    expect(resolveFeedbackRepo(undefined)).toBe("ThatCakeIsAPie/levelup-los");
    expect(resolveFeedbackRepo("  ")).toBe("ThatCakeIsAPie/levelup-los");
  });
  it("can be overridden, also with a github.com URL", () => {
    expect(resolveFeedbackRepo("me/my-fork")).toBe("me/my-fork");
    expect(resolveFeedbackRepo("https://github.com/me/my-fork/")).toBe("me/my-fork");
  });
  it("can be turned off", () => {
    expect(resolveFeedbackRepo("off")).toBeNull();
    expect(resolveFeedbackRepo("None")).toBeNull();
  });
  it("falls back to the default for a value that is not owner/repo", () => {
    expect(resolveFeedbackRepo("not a repo")).toBe(DEFAULT_FEEDBACK_REPO);
    expect(resolveFeedbackRepo("evil.com/x/y")).toBe(DEFAULT_FEEDBACK_REPO);
  });
});

describe("buildIssueUrl", () => {
  it("points at the repo's new issue form", () => {
    const url = new URL(buildIssueUrl(DEFAULT_FEEDBACK_REPO, { message: "Hi", context }) as string);
    expect(url.origin + url.pathname).toBe(
      "https://github.com/ThatCakeIsAPie/levelup-los/issues/new",
    );
  });
  it("uses the override repo", () => {
    const url = buildIssueUrl("me/my-fork", { message: "Hi", context }) as string;
    expect(url.startsWith("https://github.com/me/my-fork/issues/new?")).toBe(true);
  });
  it("returns null when turned off", () => {
    expect(buildIssueUrl(null, { message: "Hi", context })).toBeNull();
  });
  it("encodes the title and body", () => {
    const message = "Add a & b = c?\nSecond line #1 100%";
    const url = new URL(buildIssueUrl("o/r", { message, context }) as string);
    expect(url.searchParams.get("title")).toBe("Feedback: Add a & b = c?");
    const body = url.searchParams.get("body") as string;
    expect(body).toContain(message);
    expect(body).toContain("Page: /pipeline?tab=board");
    expect(body).toContain("in-app Feedback button");
    expect(body).toContain("Paste or attach it here");
    expect(url.search).not.toContain("\n");
  });
  it("keeps the sender's name out of the public issue", () => {
    const url = buildIssueUrl("o/r", { message: "Hi", context }) as string;
    expect(decodeURIComponent(url.replace(/\+/g, " "))).not.toContain("Maria");
  });
  it("shortens a long title and cuts a very long message to fit", () => {
    const url = buildIssueUrl("o/r", { message: "é".repeat(2000), context }) as string;
    expect(url.length).toBeLessThanOrEqual(7000);
    const title = new URL(url).searchParams.get("title") as string;
    expect(title.length).toBeLessThanOrEqual("Feedback: ".length + 70);
  });
  it("carries no token or credentials", () => {
    const url = buildIssueUrl("o/r", { message: "Hi", context }) as string;
    expect(url).not.toMatch(/token|access_token|ghp_|authorization/i);
    expect(new URL(url).username).toBe("");
  });
});
