import { describe, expect, it } from "vitest";
import { plainSnapshotCss, type PlainTokens } from "./plain";

const tokens: PlainTokens = {
  appBg: "#f4efe3",
  surface: "#fbf8f1",
  surface2: "#ece6d6",
  track: "#ddd5c0",
  side: "#142423",
  event: "#142423",
};

describe("plainSnapshotCss", () => {
  const css = plainSnapshotCss(tokens);

  it("switches every blur and text halo off", () => {
    expect(css).toContain("backdrop-filter:none!important");
    expect(css).toContain("text-shadow:none!important");
    expect(css).toContain(".bg-app::before{display:none!important}");
  });

  it("paints glass surfaces with the solid surface colour and drops the sheen and shadow", () => {
    expect(css).toMatch(
      /\.glass,[^{]*\{background-color:#fbf8f1!important;background-image:none!important;box-shadow:none!important\}/,
    );
  });

  it("gives the page, tiles, tracks, sidebar and event card their solid colours", () => {
    expect(css).toContain(".bg-app{background-color:#f4efe3!important");
    expect(css).toContain(".bg-surface-2{background-color:#ece6d6!important");
    expect(css).toContain(".bg-track{background-color:#ddd5c0!important");
    expect(css).toContain(".bg-sidebar{background-color:#142423!important");
    expect(css).toContain(".bg-event{background-color:#142423!important");
  });

  it("paints specific surfaces after the general glass rule so they win", () => {
    expect(css.indexOf(".bg-surface-2{")).toBeGreaterThan(css.indexOf(".glass,"));
    expect(css.indexOf(".bg-event{")).toBeGreaterThan(css.indexOf(".glass,"));
  });

  it("leaves out a rule whose token is empty", () => {
    expect(plainSnapshotCss({ ...tokens, event: "" })).not.toContain(".bg-event");
  });
});
