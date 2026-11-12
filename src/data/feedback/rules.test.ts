import { describe, expect, it } from "vitest";
import {
  ENCODE_STEPS,
  buildFeedbackContext,
  feedbackMessageError,
  fitImage,
  newestFirst,
  nextStatus,
  reportFromRow,
} from "./rules";
import { FEEDBACK_MAX_LENGTH, type FeedbackReport } from "./types";

describe("feedbackMessageError", () => {
  it("needs some text", () => {
    expect(feedbackMessageError("")).toMatch(/Write what/);
    expect(feedbackMessageError("  \n ")).toMatch(/Write what/);
  });
  it("accepts up to the limit and refuses more", () => {
    expect(feedbackMessageError("x")).toBeNull();
    expect(feedbackMessageError("x".repeat(FEEDBACK_MAX_LENGTH))).toBeNull();
    expect(feedbackMessageError("x".repeat(FEEDBACK_MAX_LENGTH + 1))).toMatch(/2000/);
  });
  it("ignores surrounding whitespace, like the database check", () => {
    expect(feedbackMessageError(`  ${"x".repeat(FEEDBACK_MAX_LENGTH)}  `)).toBeNull();
  });
});

describe("buildFeedbackContext", () => {
  const env = {
    path: "/pipeline",
    search: "?tab=board",
    title: "Pipeline",
    width: 1439.6,
    height: 900,
    dark: true,
    userAgent: "UA",
    brandSlug: "slug",
    appVersion: "abc1234",
    now: new Date("2026-11-11T10:00:00Z"),
    senderName: "Jamal Brown",
  };
  it("keeps what an admin needs to reproduce the view", () => {
    expect(buildFeedbackContext(env)).toEqual({
      path: "/pipeline",
      search: "?tab=board",
      title: "Pipeline",
      viewport: { width: 1440, height: 900 },
      theme: "dark",
      userAgent: "UA",
      brand: "slug",
      appVersion: "abc1234",
      clientTime: "2026-11-11T10:00:00.000Z",
      senderName: "Jamal Brown",
    });
  });
  it("reports light when the page isn't dark", () => {
    expect(buildFeedbackContext({ ...env, dark: false }).theme).toBe("light");
  });
});

describe("reportFromRow", () => {
  const row = {
    id: "r1",
    message: "Wider columns",
    person_id: "4",
    context: { senderName: "Jamal Brown", path: "/pipeline" },
    screenshot_path: "w1/r1.jpg",
    status: "done",
    created_at: "2026-11-11T10:00:00Z",
  };
  it("maps the row", () => {
    expect(reportFromRow(row)).toMatchObject({
      id: "r1",
      senderId: "4",
      senderName: "Jamal Brown",
      screenshotPath: "w1/r1.jpg",
      status: "done",
      createdAt: "2026-11-11T10:00:00Z",
    });
  });
  it("copes with a missing or odd context and status", () => {
    const r = reportFromRow({ ...row, context: null, status: "weird", person_id: null });
    expect(r.senderName).toBe("Unknown");
    expect(r.context).toEqual({});
    expect(r.status).toBe("new");
    expect(r.senderId).toBeNull();
    expect(reportFromRow({ ...row, context: [1] }).context).toEqual({});
  });
});

describe("status and order", () => {
  it("toggles between new and done", () => {
    expect(nextStatus("new")).toBe("done");
    expect(nextStatus("done")).toBe("new");
  });
  it("lists the newest first", () => {
    const at = (id: string, createdAt: string) => ({ id, createdAt }) as FeedbackReport;
    const sorted = newestFirst([at("a", "2026-01-01T00:00:00Z"), at("b", "2026-03-01T00:00:00Z")]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("fitImage", () => {
  const blob = (size: number) => new Blob([new Uint8Array(size)]);
  it("takes the first encoding that fits", async () => {
    const tried: [number, number][] = [];
    const out = await fitImage(async (scale, quality) => {
      tried.push([scale, quality]);
      return blob(quality > 0.7 ? 500 : 100);
    }, 200);
    expect(out?.size).toBe(100);
    expect(tried).toEqual([
      [1, ENCODE_STEPS[0].quality],
      [1, ENCODE_STEPS[1].quality],
    ]);
  });
  it("shrinks the scale when quality alone isn't enough", async () => {
    const out = await fitImage(async (scale) => blob(scale < 0.6 ? 100 : 500), 200);
    expect(out?.size).toBe(100);
  });
  it("gives up (null) when nothing fits or the browser can't encode", async () => {
    expect(await fitImage(async () => blob(500), 200)).toBeNull();
    expect(await fitImage(async () => null, 200)).toBeNull();
  });
});
