import { describe, expect, it } from "vitest";
import {
  contrast,
  hexToOklch,
  hexToRgb,
  isHexColor,
  luminance,
  normalizeHex,
  oklabDistance,
  oklchToHex,
  over,
  rgbToHex,
} from "./color";
import {
  GENERIC_BASE,
  MIN_SEPARATION,
  SIDEBAR_MAX_LUMINANCE,
  deriveTeamColors,
  teamColorsCss,
  type BrandBase,
  type DerivedColors,
  type TeamColorsInput,
} from "./teamColors";

/** The Heroes brand's surfaces: a second, very different base the guarantees must also hold on. */
const PARCHMENT_BASE: BrandBase = {
  light: {
    appBg: "#f4efe3",
    surface: "#fbf8f1",
    surface2: "#ece6d6",
    track: "#ddd5c0",
    semantic: ["#256f40", "#b84f0a", "#b3122e"],
    side: "#142423",
    sideAlpha: 0.8,
  },
  dark: {
    appBg: "#0e1c1a",
    surface: "#142423",
    surface2: "#1e3531",
    track: "#2c4a44",
    semantic: ["#6fd49b", "#f07850", "#ff7f97"],
    side: "#091211",
    sideAlpha: 0.62,
  },
};

/** Small seeded generator so the "random" colours are the same on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomColor(r: () => number): string {
  const kind = r();
  if (kind < 0.5) return rgbToHex([r() * 255, r() * 255, r() * 255]);
  // Vivid and extreme ones: full chroma at any lightness, near black, near white, greys.
  if (kind < 0.8) return oklchToHex({ l: r(), c: 0.4, h: r() * 360 });
  if (kind < 0.9)
    return oklchToHex({
      l: r() < 0.5 ? r() * 0.12 : 0.88 + r() * 0.12,
      c: r() * 0.3,
      h: r() * 360,
    });
  const g = Math.round(r() * 255);
  return rgbToHex([g, g, g]);
}

const VALUE = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [01](\.\d+)?\))$/;

/** Every rule, for one derived result on one brand base. Returns the broken ones. */
function violations(d: DerivedColors, base: BrandBase, label: string): string[] {
  const out: string[] = [];
  const need = (ok: boolean, what: string) => {
    if (!ok) out.push(`${label}: ${what}`);
  };
  for (const theme of ["light", "dark"] as const) {
    const t = d[theme];
    const B = base[theme];
    const c = (a: string, b: string) => contrast(t[a] ?? a, t[b] ?? b);
    for (const [k, v] of Object.entries(t))
      need(VALUE.test(v), `${theme} ${k} is a plain colour (${v})`);
    if (t["--primary-base"]) {
      need(c("--on-primary", "--primary-base") >= 4.5, `${theme} text on primary`);
      for (const s of [B.surface, B.surface2, B.appBg])
        need(contrast(t["--primary-base"], s) >= 4.5, `${theme} primary on ${s}`);
      need(c("--primary-ink", "--primary-soft") >= 4.5, `${theme} ink on soft`);
      need(t["--stage-apprentice"] === t["--primary-base"], `${theme} apprentice is the primary`);
      need(
        contrast("#ffffff", t["--brand-teal"]) >= 4.5,
        `${theme} white on brand-teal / sidebar-primary`,
      );
      need(t["--sidebar-primary"] === t["--brand-teal"], `${theme} sidebar-primary`);
      need(/^rgba\(/.test(t["--shadow-tint-primary"]), `${theme} primary shadow`);
    }
    if (t["--brand-sky"]) {
      need(c("--brand-on-sky", "--brand-sky") >= 4.5, `${theme} text on sky`);
      const ring = t["--focus-ring"];
      need(ring === t["--progress-fill"] && ring === t["--ring"], `${theme} ring tokens agree`);
      for (const s of [B.surface, B.surface2, B.track, B.appBg])
        need(contrast(ring, s) >= 3, `${theme} focus/progress on ${s}`);
      need(contrast(ring, t["--side"] ?? B.side) >= 3, `${theme} focus ring on the sidebar`);
    }
    if (t["--brand-navy"]) {
      need(luminance(t["--brand-navy"]) <= SIDEBAR_MAX_LUMINANCE + 1e-9, `${theme} navy is dark`);
      need(luminance(t["--side"]) <= SIDEBAR_MAX_LUMINANCE + 1e-9, `${theme} sidebar is dark`);
      need(contrast("#ffffff", t["--side"]) >= 4.5, `${theme} white on sidebar`);
      need(c("--side-fg", "--side") >= 4.5, `${theme} sidebar text`);
      need(
        contrast(t["--side-fg"], over("#ffffff", theme === "light" ? 0.1 : 0.08, t["--side"])) >=
          4.5,
        `${theme} sidebar text on the active item`,
      );
      need(contrast("#ffffff", t["--event-bg"]) >= 4.5, `${theme} white on event card`);
      need(c("--event-muted", "--event-bg") >= 4.5, `${theme} muted on event card`);
      need(contrast("#ffffff", t["--stage-ibo"]) >= 4.5, `${theme} white on IBO chip`);
      need(/^rgba\(/.test(t["--glass-tint-side"]), `${theme} side glass`);
    }
  }
  for (const [role, r] of Object.entries(d.roles)) {
    need(
      r.separated,
      `${role} stays apart from good, warn and danger (${r.separation?.toFixed(3)})`,
    );
  }
  return out;
}

const sepOf = (d: DerivedColors, base: BrandBase) => {
  const hexes: Array<[string, "light" | "dark"]> = [];
  for (const theme of ["light", "dark"] as const) {
    for (const k of ["--primary-base", "--brand-sky", "--focus-ring"]) {
      const v = d[theme][k];
      if (v) hexes.push([v, theme]);
    }
  }
  return Math.min(
    Infinity,
    ...hexes.flatMap(([h, theme]) => base[theme].semantic.map((s) => oklabDistance(h, s))),
  );
};

describe("color maths", () => {
  it("parses and normalises hex", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex(" 1B2230 ")).toBe("#1b2230");
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
    expect(isHexColor("#a1b2c3")).toBe(true);
    expect(isHexColor("#A1B2C3")).toBe(false);
    expect(isHexColor("#a1b2c")).toBe(false);
  });
  it("matches WCAG contrast for known pairs", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(luminance("#ffffff")).toBeCloseTo(1, 6);
  });
  it("round-trips through OKLCH", () => {
    for (const hex of ["#4f46e5", "#8f98f7", "#1b2230", "#f2a93b", "#808080", "#ff0000"]) {
      const l = hexToOklch(hex);
      expect(oklabDistance(oklchToHex(l), hex)).toBeLessThan(0.004);
    }
    expect(hexToRgb(oklchToHex({ l: 0.5, c: 0.5, h: 30 }))).toHaveLength(3);
  });
  it("keeps hue and lightness when the chroma has to shrink to fit", () => {
    const hex = oklchToHex({ l: 0.9, c: 0.4, h: 150 });
    const l = hexToOklch(hex);
    expect(l.l).toBeCloseTo(0.9, 1);
    expect(Math.abs(l.h - 150)).toBeLessThan(6);
    expect(l.c).toBeLessThan(0.4);
  });
});

describe("deriveTeamColors: rules on random colours", () => {
  const N = 2500;
  it.each([
    ["the generic brand", GENERIC_BASE],
    ["a parchment brand", PARCHMENT_BASE],
  ])(
    `holds for %s on ${N} random choices of all three colours`,
    (_name, base) => {
      const r = rng(base === GENERIC_BASE ? 1 : 2);
      const broken: string[] = [];
      let minSep = Infinity;
      for (let i = 0; i < N; i++) {
        const input: TeamColorsInput = {
          main: randomColor(r),
          highlight: randomColor(r),
          sidebar: randomColor(r),
        };
        const d = deriveTeamColors(input, base);
        broken.push(...violations(d, base, JSON.stringify(input)));
        minSep = Math.min(minSep, sepOf(d, base));
      }
      expect(broken.slice(0, 5)).toEqual([]);
      expect(minSep).toBeGreaterThanOrEqual(MIN_SEPARATION);
    },
    120_000,
  );

  it("holds when one role is chosen alone, and then only that role's tokens exist", () => {
    const r = rng(3);
    for (let i = 0; i < 400; i++) {
      for (const role of ["main", "highlight", "sidebar"] as const) {
        const d = deriveTeamColors({ [role]: randomColor(r) });
        expect(violations(d, GENERIC_BASE, role)).toEqual([]);
        expect(Object.keys(d.roles)).toEqual([role]);
        const hasMain = "--primary-base" in d.light;
        const hasSky = "--brand-sky" in d.light;
        const hasNavy = "--brand-navy" in d.light;
        expect([hasMain, hasSky, hasNavy]).toEqual([
          role === "main",
          role === "highlight",
          role === "sidebar",
        ]);
      }
    }
  });

  it("is deterministic and ignores roles that are missing or malformed", () => {
    const a = deriveTeamColors({ main: "#336699" });
    expect(deriveTeamColors({ main: "#336699" })).toEqual(a);
    const none = deriveTeamColors({ main: "red", highlight: "#12345", sidebar: null });
    expect(none.light).toEqual({});
    expect(none.dark).toEqual({});
    expect(teamColorsCss(none)).toBe("");
    expect(
      deriveTeamColors({ main: "#336699", highlight: undefined }).roles.highlight,
    ).toBeUndefined();
  });
});

describe("deriveTeamColors: edge cases", () => {
  const EDGE: Array<[string, string]> = [
    ["white", "#ffffff"],
    ["black", "#000000"],
    ["pure yellow", "#ffff00"],
    ["neon green", "#39ff14"],
    ["mid grey", "#808080"],
    ["pure red", "#ff0000"],
    ["pure blue", "#0000ff"],
    ["pure green", "#00ff00"],
    ["cyan", "#00ffff"],
    ["magenta", "#ff00ff"],
    ["the danger red", "#b42318"],
    ["the good green", "#2f7a3e"],
    ["the warning amber", "#c77a0a"],
    ["a near-white", "#fefefe"],
    ["a near-black", "#010101"],
  ];
  for (const base of [GENERIC_BASE, PARCHMENT_BASE]) {
    const name = base === GENERIC_BASE ? "generic" : "parchment";
    it.each(EDGE)(`${name}: %s as every role`, (_n, hex) => {
      for (const input of [
        { main: hex, highlight: hex, sidebar: hex },
        { main: hex },
        { highlight: hex },
        { sidebar: hex },
      ]) {
        expect(violations(deriveTeamColors(input, base), base, JSON.stringify(input))).toEqual([]);
      }
    });
  }
  it("every pair of edge colours across the three roles", () => {
    for (const [, m] of EDGE)
      for (const [, h] of EDGE)
        for (const [, s] of EDGE) {
          const d = deriveTeamColors({ main: m, highlight: h, sidebar: s });
          expect(violations(d, GENERIC_BASE, `${m} ${h} ${s}`)).toEqual([]);
        }
  }, 120_000);
  it("reports what was adjusted", () => {
    const d = deriveTeamColors({ main: "#ffff00", highlight: "#ffffff", sidebar: "#ffffff" });
    expect(d.roles.main?.adjusted.light).toBe(true);
    expect(d.roles.main?.used.light).not.toBe("#ffff00");
    expect(contrast("#ffffff", d.roles.main!.used.light)).toBeGreaterThanOrEqual(4.5);
    expect(d.roles.sidebar?.adjusted.light).toBe(true);
    expect(luminance(d.roles.sidebar!.used.light)).toBeLessThanOrEqual(SIDEBAR_MAX_LUMINANCE);
    expect(d.roles.highlight?.adjusted.light).toBe(true);
    const ok = deriveTeamColors({ main: "#4f46e5", sidebar: "#1b2230" });
    expect(ok.roles.main?.adjusted.light).toBe(false);
    expect(ok.roles.main?.used.light).toBe("#4f46e5");
    expect(ok.roles.sidebar?.adjusted.light).toBe(false);
    expect(ok.light["--brand-navy"]).toBe("#1b2230");
  });
  it("keeps the hue of a colour that only needed to get darker or lighter", () => {
    const d = deriveTeamColors({ main: "#4f46e5" });
    const light = hexToOklch(d.light["--primary-base"]);
    const dark = hexToOklch(d.dark["--primary-base"]);
    const chosen = hexToOklch("#4f46e5");
    expect(Math.abs(light.h - chosen.h)).toBeLessThan(1);
    expect(Math.abs(dark.h - chosen.h)).toBeLessThan(1);
    expect(dark.l).toBeGreaterThan(light.l);
  });
  it("turns a hue that sits on a semantic colour, and only by as much as needed", () => {
    const red = deriveTeamColors({ main: "#b42318" });
    expect(red.roles.main?.turned).not.toBe(0);
    expect(Math.abs(red.roles.main!.turned)).toBeLessThanOrEqual(60);
    const blue = deriveTeamColors({ main: "#4f46e5" });
    expect(blue.roles.main?.turned).toBe(0);
  });
});

describe("deriveTeamColors: exact outputs for known inputs", () => {
  it("brand colours of the generic brand change only where a rule needs it", () => {
    const d = deriveTeamColors({ main: "#4f46e5", highlight: "#8f98f7", sidebar: "#1b2230" });
    expect(d.light["--brand-teal"]).toBe("#4f46e5");
    expect(d.light["--primary-base"]).toBe("#4f46e5");
    expect(d.light["--on-primary"]).toBe("#ffffff");
    expect(d.light["--brand-sky"]).toBe("#8f98f7");
    expect(d.light["--brand-navy"]).toBe("#1b2230");
    expect(d.roles.main?.adjusted).toEqual({ light: false, dark: true });
    expect(d.roles.highlight?.adjusted).toEqual({ light: true, dark: false });
  });
  it("pure yellow as Main, white as Sidebar", () => {
    const d = deriveTeamColors({ main: "#ffff00", sidebar: "#ffffff" });
    expect(d).toMatchInlineSnapshot(`
      {
        "dark": {
          "--brand-navy": "#262626",
          "--brand-teal": "#717100",
          "--event-bg": "#2d2d2d",
          "--event-muted": "#bebebe",
          "--glass-tint-side": "rgba(15, 15, 15, 0.62)",
          "--on-primary": "#2f300f",
          "--primary-base": "#ffff00",
          "--primary-ink": "#d5d789",
          "--primary-soft": "#303000",
          "--shadow-tint-primary": "rgba(113, 113, 0, 0.35)",
          "--shadow-tint-soft": "rgba(38, 38, 38, 0.06)",
          "--shadow-tint-strong": "rgba(19, 19, 19, 0.18)",
          "--side": "#0f0f0f",
          "--side-fg": "#9e9e9e",
          "--sidebar-primary": "#717100",
          "--stage-apprentice": "#ffff00",
          "--stage-ibo": "#484848",
          "--win-line": "#d5d789",
        },
        "light": {
          "--brand-navy": "#262626",
          "--brand-teal": "#717100",
          "--event-bg": "#262626",
          "--event-muted": "#bebebe",
          "--glass-tint-side": "rgba(33, 33, 33, 0.66)",
          "--on-primary": "#ffffff",
          "--primary-base": "#717100",
          "--primary-ink": "#515100",
          "--primary-soft": "#eff1d6",
          "--shadow-tint-primary": "rgba(113, 113, 0, 0.35)",
          "--shadow-tint-soft": "rgba(38, 38, 38, 0.06)",
          "--shadow-tint-strong": "rgba(19, 19, 19, 0.18)",
          "--side": "#212121",
          "--side-fg": "#b7b7b7",
          "--sidebar-primary": "#717100",
          "--stage-apprentice": "#717100",
          "--stage-ibo": "#262626",
          "--win-line": "#262626",
        },
        "roles": {
          "main": {
            "adjusted": {
              "dark": false,
              "light": true,
            },
            "chosen": "#ffff00",
            "separated": true,
            "separation": 0.077254,
            "turned": 0,
            "used": {
              "dark": "#ffff00",
              "light": "#717100",
            },
          },
          "sidebar": {
            "adjusted": {
              "dark": true,
              "light": true,
            },
            "chosen": "#ffffff",
            "separated": true,
            "separation": null,
            "turned": 0,
            "used": {
              "dark": "#262626",
              "light": "#262626",
            },
          },
        },
      }
    `);
  });
  it("a teal Main, a gold Highlight and a deep green Sidebar", () => {
    const d = deriveTeamColors({ main: "#0f766e", highlight: "#e3c271", sidebar: "#0b2b26" });
    expect(d).toMatchInlineSnapshot(`
      {
        "dark": {
          "--brand-navy": "#0b2b26",
          "--brand-on-sky": "#382c0c",
          "--brand-sky": "#e3c271",
          "--brand-teal": "#0f766e",
          "--event-bg": "#13332d",
          "--event-muted": "#b1c2be",
          "--focus-ring": "#e3c271",
          "--glass-tint-side": "rgba(0, 18, 15, 0.62)",
          "--on-primary": "#002825",
          "--primary-base": "#3d978e",
          "--primary-ink": "#8ce4da",
          "--primary-soft": "#083531",
          "--progress-fill": "#e3c271",
          "--ring": "#e3c271",
          "--shadow-tint-primary": "rgba(15, 118, 110, 0.35)",
          "--shadow-tint-soft": "rgba(11, 43, 38, 0.06)",
          "--shadow-tint-strong": "rgba(0, 23, 19, 0.18)",
          "--side": "#00120f",
          "--side-fg": "#8ea49f",
          "--sidebar-primary": "#0f766e",
          "--sidebar-ring": "#e3c271",
          "--stage-apprentice": "#3d978e",
          "--stage-ibo": "#2f4f49",
          "--win-line": "#8ce4da",
        },
        "light": {
          "--brand-navy": "#0b2b26",
          "--brand-on-sky": "#382c0c",
          "--brand-sky": "#e3c271",
          "--brand-teal": "#0f766e",
          "--event-bg": "#0b2b26",
          "--event-muted": "#b1c2be",
          "--focus-ring": "#9e7f2a",
          "--glass-tint-side": "rgba(6, 38, 33, 0.66)",
          "--on-primary": "#ffffff",
          "--primary-base": "#0f766e",
          "--primary-ink": "#005a53",
          "--primary-soft": "#d5f7f2",
          "--progress-fill": "#9e7f2a",
          "--ring": "#9e7f2a",
          "--shadow-tint-primary": "rgba(15, 118, 110, 0.35)",
          "--shadow-tint-soft": "rgba(11, 43, 38, 0.06)",
          "--shadow-tint-strong": "rgba(0, 23, 19, 0.18)",
          "--side": "#062621",
          "--side-fg": "#a7bdb8",
          "--sidebar-primary": "#0f766e",
          "--sidebar-ring": "#9e7f2a",
          "--stage-apprentice": "#0f766e",
          "--stage-ibo": "#0b2b26",
          "--win-line": "#0b2b26",
        },
        "roles": {
          "highlight": {
            "adjusted": {
              "dark": false,
              "light": true,
            },
            "chosen": "#e3c271",
            "separated": true,
            "separation": 0.06412,
            "turned": 0,
            "used": {
              "dark": "#e3c271",
              "light": "#9e7f2a",
            },
          },
          "main": {
            "adjusted": {
              "dark": true,
              "light": false,
            },
            "chosen": "#0f766e",
            "separated": true,
            "separation": 0.074714,
            "turned": 0,
            "used": {
              "dark": "#3d978e",
              "light": "#0f766e",
            },
          },
          "sidebar": {
            "adjusted": {
              "dark": false,
              "light": false,
            },
            "chosen": "#0b2b26",
            "separated": true,
            "separation": null,
            "turned": 0,
            "used": {
              "dark": "#0b2b26",
              "light": "#0b2b26",
            },
          },
        },
      }
    `);
  });
  it("neon green Main on the parchment brand", () => {
    const d = deriveTeamColors({ main: "#39ff14" }, PARCHMENT_BASE);
    expect(d).toMatchInlineSnapshot(`
      {
        "dark": {
          "--brand-teal": "#127800",
          "--on-primary": "#1f341c",
          "--primary-base": "#39ff14",
          "--primary-ink": "#ace2a5",
          "--primary-soft": "#0c3807",
          "--shadow-tint-primary": "rgba(18, 120, 0, 0.35)",
          "--sidebar-primary": "#127800",
          "--stage-apprentice": "#39ff14",
          "--win-line": "#ace2a5",
        },
        "light": {
          "--brand-teal": "#127800",
          "--on-primary": "#ffffff",
          "--primary-base": "#127800",
          "--primary-ink": "#0c5e00",
          "--primary-soft": "#e2f5df",
          "--shadow-tint-primary": "rgba(18, 120, 0, 0.35)",
          "--sidebar-primary": "#127800",
          "--stage-apprentice": "#127800",
        },
        "roles": {
          "main": {
            "adjusted": {
              "dark": false,
              "light": true,
            },
            "chosen": "#39ff14",
            "separated": true,
            "separation": 0.067611,
            "turned": 0,
            "used": {
              "dark": "#39ff14",
              "light": "#127800",
            },
          },
        },
      }
    `);
  });
  it("writes a stylesheet for the two themes", () => {
    const css = teamColorsCss(deriveTeamColors({ main: "#336699" }));
    expect(css).toMatch(/^:root\{--brand-teal:#[0-9a-f]{6};/);
    expect(css).toContain(".dark{--brand-teal:");
    expect(css).not.toMatch(/[<>"'`\\]|url\(|;;/);
  });
});
