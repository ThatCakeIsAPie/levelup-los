import { describe, expect, it } from "vitest";
import {
  isBackgroundMode,
  isDefaultLook,
  isLookPath,
  lookProblem,
  newLookPath,
  parseLook,
  pictureExtension,
  sameLook,
} from "./rules";
import { defaultLook, type TeamLook } from "./types";

const WS = "w1";
const HEX = "0123456789abcdef0123456789abcdef";
const BG = `${WS}/bg-${HEX}.webp`;
const LOGO = `${WS}/logo-${HEX}.png`;

const look = (over: Partial<TeamLook> = {}): TeamLook => ({ ...defaultLook(), ...over });

describe("isLookPath (mirrors the database's path rule)", () => {
  it("accepts a generated file name in the workspace's own folder", () => {
    expect(isLookPath(BG, WS, "bg")).toBe(true);
    expect(isLookPath(`${WS}/bg-${HEX}.jpg`, WS, "bg")).toBe(true);
    expect(isLookPath(LOGO, WS, "logo")).toBe(true);
    expect(isLookPath(`${WS}/logo-${HEX}.webp`, WS, "logo")).toBe(true);
  });
  it("refuses another workspace's folder, traversal and odd shapes", () => {
    const bad = [
      `w2/bg-${HEX}.webp`,
      `../w1/bg-${HEX}.webp`,
      `${WS}/../bg-${HEX}.webp`,
      `${WS}/sub/bg-${HEX}.webp`,
      `/${WS}/bg-${HEX}.webp`,
      `${WS}//bg-${HEX}.webp`,
      `${WS}/bg-${HEX}.webp/`,
      `${WS}/bg-${HEX}.webp\n`,
      `${WS}/bg-${HEX.toUpperCase()}.webp`,
      `${WS}/bg-${HEX.slice(1)}.webp`,
      `${WS}/bg-${HEX}0.webp`,
      `${WS}/bg-${HEX}.svg`,
      `${WS}/bg-${HEX}.png`, // a background is webp or jpg
      `${WS}/bg-${HEX}.gif`,
      `${WS}/bg-${HEX}.webp.svg`,
      `${WS}/photo.webp`,
      `${WS}/bg-${HEX}.webp") ; background:url(x`,
      `${WS}/bg-${HEX}.webp?x=1`,
      `${WS}%2f..%2fbg-${HEX}.webp`,
      `${WS}/bg-${HEX}.webp#`,
      "",
    ];
    for (const p of bad) expect(isLookPath(p, WS, "bg"), p).toBe(false);
    expect(isLookPath(`${WS}/logo-${HEX}.jpg`, WS, "logo")).toBe(false);
    expect(isLookPath(BG, WS, "logo")).toBe(false);
    expect(isLookPath(LOGO, WS, "bg")).toBe(false);
  });
  it("refuses non-strings and workspace ids that are not plain", () => {
    for (const v of [null, undefined, 5, {}, ["w1/bg"]])
      expect(isLookPath(v, WS, "bg")).toBe(false);
    for (const ws of ["", "a/b", "a b", 'a"b', "..", "a;b", "x".repeat(65)]) {
      expect(isLookPath(`${ws}/bg-${HEX}.webp`, ws, "bg"), ws).toBe(false);
    }
  });
});

describe("lookProblem (mirrors set_workspace_appearance)", () => {
  it("accepts the default and every kind of valid choice", () => {
    expect(lookProblem(defaultLook(), WS)).toBeNull();
    expect(lookProblem(look({ background: "none", glass: false }), WS)).toBeNull();
    expect(
      lookProblem(
        look({ background: "picture", backgroundPath: BG, glass: true, logoPath: LOGO }),
        WS,
      ),
    ).toBeNull();
    expect(
      lookProblem(
        look({ colors: { main: "#336699", highlight: "#ffcc00", sidebar: "#101820" } }),
        WS,
      ),
    ).toBeNull();
  });
  it("refuses bad modes, picture and path combinations", () => {
    expect(lookProblem(look({ background: "wallpaper" as never }), WS)).toBe("background");
    expect(lookProblem(look({ background: "picture", backgroundPath: null }), WS)).toBe(
      "background picture",
    );
    expect(lookProblem(look({ background: "none", backgroundPath: BG }), WS)).toBe(
      "background picture",
    );
    expect(
      lookProblem(look({ background: "picture", backgroundPath: `w2/bg-${HEX}.webp` }), WS),
    ).toBe("background picture");
    expect(lookProblem(look({ logoPath: `${WS}/logo-${HEX}.svg` }), WS)).toBe("logo");
    expect(lookProblem(look({ glass: "yes" as never }), WS)).toBe("glass");
  });
  it("refuses anything but #rrggbb in lower case", () => {
    for (const c of [
      "red",
      "#FFF",
      "#FFFFFF",
      "#12345g",
      "#1234567",
      "rgb(0,0,0)",
      "#336699;",
      "red;background:url(x)",
      "",
    ]) {
      expect(
        lookProblem(look({ colors: { main: c, highlight: null, sidebar: null } }), WS),
        c,
      ).toBe("main colour");
    }
  });
  it("knows the modes and the default", () => {
    expect(["default", "none", "picture"].every(isBackgroundMode)).toBe(true);
    expect(isBackgroundMode("Picture")).toBe(false);
    expect(isDefaultLook(defaultLook())).toBe(true);
    expect(isDefaultLook(look({ glass: false }))).toBe(false);
    expect(sameLook(defaultLook(), defaultLook())).toBe(true);
    expect(sameLook(defaultLook(), look({ logoPath: LOGO }))).toBe(false);
  });
});

describe("parseLook (untrusted input never gets past here)", () => {
  it("keeps valid parts and drops the rest", () => {
    const parsed = parseLook(
      {
        background: "picture",
        backgroundPath: BG,
        glass: true,
        logoPath: LOGO,
        colors: { main: "#336699", highlight: "nope", sidebar: "#101820", extra: "#000000" },
      },
      WS,
    );
    expect(parsed).toEqual({
      background: "picture",
      backgroundPath: BG,
      glass: true,
      logoPath: LOGO,
      colors: { main: "#336699", highlight: null, sidebar: "#101820" },
    });
  });
  it("turns a malicious stored value into the default for that part", () => {
    const nasty = parseLook(
      {
        background: "picture",
        backgroundPath: `${WS}/bg-${HEX}.webp")}body{background:url(//evil/x)`,
        glass: "true",
        logoPath: `${WS}/logo-${HEX}.png"); url(javascript:alert(1)`,
        colors: {
          main: "red;background:url(x)",
          highlight: "#fff;}</style><script>x</script>",
          sidebar: "url(x)",
        },
      },
      WS,
    );
    expect(nasty).toEqual(defaultLook());
    expect(parseLook("string", WS)).toEqual(defaultLook());
    expect(parseLook(null, WS)).toEqual(defaultLook());
    expect(parseLook({ background: "picture", backgroundPath: BG }, "bad id")).toEqual(
      defaultLook(),
    );
    // A picture whose path is for another team is not kept.
    expect(
      parseLook({ background: "picture", backgroundPath: `w2/bg-${HEX}.webp` }, WS).background,
    ).toBe("default");
  });
});

describe("new paths", () => {
  it("are unguessable, in the workspace's folder, and pass the rule", () => {
    const a = newLookPath(WS, "bg", "image/webp");
    const b = newLookPath(WS, "bg", "image/webp");
    expect(a).not.toBe(b);
    expect(isLookPath(a, WS, "bg")).toBe(true);
    expect(isLookPath(newLookPath(WS, "bg", "image/jpeg"), WS, "bg")).toBe(true);
    expect(isLookPath(newLookPath(WS, "logo", "image/png"), WS, "logo")).toBe(true);
    expect(isLookPath(newLookPath(WS, "logo", "image/webp"), WS, "logo")).toBe(true);
  });
  it("refuse SVG, GIF and anything else", () => {
    for (const mime of ["image/svg+xml", "image/gif", "text/html", ""]) {
      expect(pictureExtension("bg", mime)).toBeNull();
      expect(pictureExtension("logo", mime)).toBeNull();
      expect(() => newLookPath(WS, "bg", mime)).toThrow();
    }
    expect(pictureExtension("bg", "image/png")).toBeNull();
    expect(pictureExtension("logo", "image/jpeg")).toBeNull();
  });
});
