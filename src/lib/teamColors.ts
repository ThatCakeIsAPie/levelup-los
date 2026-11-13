/**
 * Team colours: from the three colours a leader chooses (Main, Highlight,
 * Sidebar) derive every token that depends on them, for BOTH themes, so that
 * text stays readable whatever was chosen. Pure and deterministic; the runtime
 * glue (reading the brand's surfaces, writing the CSS) is in `teamLook.ts`.
 *
 * How: each role is a colour in OKLCH. A derived colour keeps the chosen hue and
 * as much chroma as fits, and only its LIGHTNESS moves, to the nearest value
 * that satisfies the contrast rules of `src/brand/tokens.css` (every check is
 * made on the exact `#rrggbb` that will be painted). The roles:
 *
 *   Main      --brand-teal --primary-base --on-primary --primary-soft
 *             --primary-ink --stage-apprentice --sidebar-primary
 *             --shadow-tint-primary (and --win-line in the dark theme)
 *   Highlight --brand-sky --brand-on-sky --focus-ring --progress-fill
 *             --ring --sidebar-ring
 *   Sidebar   --brand-navy --side --side-fg --event-bg --event-muted
 *             --stage-ibo --win-line (light) --glass-tint-side
 *             --shadow-tint-soft --shadow-tint-strong
 *
 * Guarantees, in both themes (`teamColors.test.ts` checks them on thousands of
 * random colours and on the edge cases):
 *   - text on the primary >= 4.5, and the primary itself >= 4.5 on the page
 *     and card surfaces (it is used as link text); ink on the soft tint >= 4.5
 *   - text on the highlight >= 4.5; focus ring and progress fill >= 3 against
 *     the surfaces, the progress track and the sidebar
 *   - the sidebar is dark enough for white text (luminance <= 0.02); the
 *     sidebar's text, the event card's text and muted text >= 4.5; white on
 *     the IBO chip and on the sidebar's primary >= 4.5
 *   - Main, Highlight and their derived solids differ from the brand's good /
 *     warn / danger colours by at least `MIN_SEPARATION` (OKLab distance); to
 *     get there the hue is turned by up to 60 degrees, the smallest turn that
 *     works. This is the only place the hue moves.
 */
import {
  contrast,
  hexToOklch,
  isHexColor,
  luminance,
  oklabDistance,
  oklchToHex,
  over,
  rgba,
  type Oklch,
} from "./color";

export type TeamColorRole = "main" | "highlight" | "sidebar";
export type TeamColorsInput = Partial<Record<TeamColorRole, string | null | undefined>>;
export type Tokens = Record<string, string>;

/** What a theme's surfaces and semantic colours are (read from the brand at runtime). */
export interface ThemeBase {
  appBg: string;
  surface: string;
  surface2: string;
  track: string;
  /** Solid good / warn / danger colours (`--ok`, `--amber-strong`, `--danger`). */
  semantic: string[];
  /** The brand's own sidebar colour (`--side`), for the focus ring when the sidebar is not chosen. */
  side: string;
  /** Alpha of the brand's `--glass-tint-side`. */
  sideAlpha: number;
}
export interface BrandBase {
  light: ThemeBase;
  dark: ThemeBase;
}

/** The generic brand's values (`src/brand/tokens.css`). */
export const GENERIC_BASE: BrandBase = {
  light: {
    appBg: "#f5f6fa",
    surface: "#ffffff",
    surface2: "#eef0f6",
    track: "#e2e5ee",
    semantic: ["#2f7a3e", "#c77a0a", "#b42318"],
    side: "#181e2b",
    sideAlpha: 0.66,
  },
  dark: {
    appBg: "#0e1118",
    surface: "#161a23",
    surface2: "#1e232f",
    track: "#2a303d",
    semantic: ["#7bcb88", "#f2a93b", "#f29185"],
    side: "#090b11",
    sideAlpha: 0.62,
  },
};

/** Smallest OKLab distance between a derived solid and a semantic colour in the same theme. */
export const MIN_SEPARATION = 0.06;

/**
 * A distance as it is reported. `**` and `Math.pow` differ in the last bit between JavaScript engine
 * versions, so the raw number differs by 1e-16 from one Node to the next; six decimals are the same
 * everywhere and far finer than the 0.06 rule they are compared with (the rule itself uses the raw value).
 */
const reported = (d: number): number => Math.round(d * 1e6) / 1e6;
/** The sidebar's luminance cap: white text on it is above 15:1 and a 3:1 focus ring still exists on both the sidebar and the light track. */
export const SIDEBAR_MAX_LUMINANCE = 0.02;

const WHITE = "#ffffff";
const STEP = 0.004;
const HUE_TURNS = [0, 8, -8, 16, -16, 24, -24, 32, -32, 40, -40, 50, -50, 60, -60];

/** A lightness search target: `score >= 1` means every rule holds; below 1 is how close. */
type Score = (hex: string) => number;

/** min over (contrast / needed) against fixed backgrounds. */
const contrastScore =
  (rules: Array<[against: string, need: number]>): Score =>
  (hex) =>
    Math.min(...rules.map(([bg, need]) => contrast(hex, bg) / need));

const luminanceCap =
  (cap: number): Score =>
  (hex) => {
    const l = luminance(hex);
    return l <= cap ? 1 : cap / l;
  };

const all =
  (...scores: Score[]): Score =>
  (hex) =>
    Math.min(...scores.map((s) => s(hex)));

/**
 * The colour with hue `h` and (up to) chroma `c` whose lightness is nearest to
 * `l0` and satisfies `score`. Searches both ways from `l0`, preferring `prefer`
 * on ties; when nothing satisfies it (an impossible brand surface), the best.
 */
function fit(h: number, c: number, l0: number, score: Score, prefer: 1 | -1 = -1): string {
  let best = "";
  let bestScore = -Infinity;
  const max = Math.ceil(1 / STEP);
  for (let k = 0; k <= max; k++) {
    for (const dir of k === 0 ? [prefer] : [prefer, -prefer]) {
      const l = l0 + dir * k * STEP;
      if (l < 0 || l > 1) continue;
      const hex = oklchToHex({ l, c, h });
      const s = score(hex);
      if (s >= 1) return hex;
      if (s > bestScore) {
        best = hex;
        bestScore = s;
      }
    }
  }
  return best;
}

const turn = (h: number, by: number) => (((h + by) % 360) + 360) % 360;

/** The first of the hue turns for which `build` is separated enough; else the best. */
function separate<T>(
  build: (turnBy: number) => T,
  distance: (t: T) => number,
): { value: T; separated: boolean; distance: number; turned: number } {
  let best: { value: T; d: number; turned: number } | null = null;
  for (const by of HUE_TURNS) {
    const value = build(by);
    const d = distance(value);
    if (d >= MIN_SEPARATION) return { value, separated: true, distance: d, turned: by };
    if (!best || d > best.d) best = { value, d, turned: by };
  }
  return { value: best!.value, separated: false, distance: best!.d, turned: best!.turned };
}

const minDistance = (hex: string, base: ThemeBase) =>
  Math.min(...base.semantic.map((s) => oklabDistance(hex, s)));

/** Text colour (a tint of `h`, dark) that reaches 4.5:1 on `bg`; black when no tint does. */
function darkTextOn(bg: string, h: number): string {
  for (let l = 0.3; l >= 0; l -= 0.01) {
    const hex = oklchToHex({ l, c: 0.05, h });
    if (contrast(hex, bg) >= 4.5) return hex;
  }
  return "#000000";
}
/** Light text on `bg` (a tint of `h`, else white). */
function lightTextOn(bg: string, h: number): string {
  for (let l = 0.96; l <= 1; l += 0.01) {
    const hex = oklchToHex({ l, c: 0.015, h });
    if (contrast(hex, bg) >= 4.5) return hex;
  }
  return WHITE;
}

interface Pair<T = string> {
  light: T;
  dark: T;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface MainOut {
  /** The primary per theme (`--primary-base`). */
  base: Pair;
  onPrimary: Pair;
  soft: Pair;
  ink: Pair;
}

function mainAt(chosen: string, turnBy: number, b: BrandBase): MainOut {
  const lch = hexToOklch(chosen);
  const h = turn(lch.h, lch.c < 0.01 ? 0 : turnBy);
  const keep = turnBy === 0;
  // Light: white text on it, and it is link text on the page and card surfaces.
  const lightScore = contrastScore([
    [WHITE, 4.5],
    [b.light.surface, 4.5],
    [b.light.surface2, 4.5],
    [b.light.appBg, 4.5],
  ]);
  const light = keep && lightScore(chosen) >= 1 ? chosen : fit(h, lch.c, lch.l, lightScore, -1);
  // Dark: lighter, with dark text on it (some tint of the hue reaches 4.5, so a black bound is enough).
  const darkScore = all(
    contrastScore([
      [b.dark.surface, 4.5],
      [b.dark.surface2, 4.5],
      [b.dark.appBg, 4.5],
    ]),
    luminanceBound(0.185),
  );
  const dark = keep && darkScore(chosen) >= 1 ? chosen : fit(h, lch.c, lch.l, darkScore, 1);

  const lightSoft = oklchToHex({ l: 0.95, c: Math.min(lch.c, 0.035), h });
  const darkSoft = oklchToHex({ l: 0.3, c: Math.min(lch.c * 0.55, 0.09), h });
  return {
    base: { light, dark },
    onPrimary: { light: WHITE, dark: darkTextOn(dark, h) },
    soft: { light: lightSoft, dark: darkSoft },
    ink: {
      light: fit(h, Math.min(lch.c, 0.2), 0.42, contrastScore([[lightSoft, 4.5]]), -1),
      dark: fit(h, Math.min(lch.c, 0.1), 0.86, contrastScore([[darkSoft, 4.5]]), 1),
    },
  };
}

/** score >= 1 when the luminance is at least `min`. */
const luminanceBound =
  (min: number): Score =>
  (hex) =>
    Math.min(1, luminance(hex) / min);

// ---------------------------------------------------------------------------
// Highlight
// ---------------------------------------------------------------------------

interface HighlightOut {
  /** Solid highlight (same in both themes) and the text on it. */
  sky: string;
  onSky: string;
  /** Focus ring and progress fill per theme. */
  accent: Pair;
}

function highlightAt(chosen: string, turnBy: number, b: BrandBase, side: Pair): HighlightOut {
  const lch = hexToOklch(chosen);
  const h = turn(lch.h, lch.c < 0.01 ? 0 : turnBy);
  const sky = turnBy === 0 ? chosen : oklchToHex({ ...lch, h });
  const rules = (t: ThemeBase, sideBg: string) =>
    contrastScore([
      [t.surface, 3],
      [t.surface2, 3],
      [t.track, 3],
      [t.appBg, 3],
      [sideBg, 3],
    ]);
  const lightScore = rules(b.light, side.light);
  const darkScore = rules(b.dark, side.dark);
  const accentL =
    lightScore(chosen) >= 1 && turnBy === 0 ? chosen : fit(h, lch.c, lch.l, lightScore, -1);
  const accentD =
    darkScore(chosen) >= 1 && turnBy === 0 ? chosen : fit(h, lch.c, lch.l, darkScore, 1);
  const onSky = darkTextOn(sky, h);
  return {
    sky,
    onSky: contrast(onSky, sky) >= 4.5 ? onSky : lightTextOn(sky, h),
    accent: { light: accentL, dark: accentD },
  };
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

interface SidebarOut {
  navy: string;
  side: Pair;
  sideFg: Pair;
  event: Pair;
  eventMuted: Pair;
  ibo: Pair;
  /** Shadows: the navy at low alpha, and a deeper navy. */
  shadowSoft: string;
  shadowStrong: string;
}

function sidebarOut(chosen: string): SidebarOut {
  const lch = hexToOklch(chosen);
  const cap = luminanceCap(SIDEBAR_MAX_LUMINANCE);
  const navy = cap(chosen) >= 1 ? chosen : fit(lch.h, lch.c, lch.l, cap, -1);
  const n = hexToOklch(navy);
  const sideLight = oklchToHex({ ...n, l: Math.max(0, n.l - 0.02) });
  const sideDark = oklchToHex({ ...n, l: n.l * 0.62 });
  const eventDark = oklchToHex({ ...n, l: Math.min(0.4, n.l + 0.03) });
  const textOn = (bgs: string[], l0: number, c: number): string =>
    fit(
      n.h,
      Math.min(n.c, c),
      l0,
      contrastScore(bgs.map((bg) => [bg, 4.5] as [string, number])),
      1,
    );
  // Text must also hold on the active item's white wash (10% light, 8% dark).
  const fgLight = textOn([sideLight, over(WHITE, 0.1, sideLight)], 0.78, 0.025);
  const fgDark = textOn([sideDark, over(WHITE, 0.08, sideDark)], 0.7, 0.025);
  return {
    navy,
    side: { light: sideLight, dark: sideDark },
    sideFg: { light: fgLight, dark: fgDark },
    event: { light: navy, dark: eventDark },
    eventMuted: {
      light: textOn([navy], 0.8, 0.02),
      dark: textOn([eventDark], 0.8, 0.02),
    },
    ibo: {
      light: navy,
      dark: oklchToHex({ l: 0.4, c: Math.min(n.c, 0.06), h: n.h }),
    },
    shadowSoft: rgba(navy, 0.06),
    shadowStrong: rgba(oklchToHex({ ...n, l: n.l * 0.7 }), 0.18),
  };
}

// ---------------------------------------------------------------------------
// Everything
// ---------------------------------------------------------------------------

/** What one role ended up as: the colour used in each theme and whether it differs from the choice. */
export interface RoleResult {
  chosen: string;
  used: Pair;
  adjusted: Pair<boolean>;
  /** Smallest distance to a semantic colour, to 6 decimals (null for the sidebar: dark and neutral). */
  separation: number | null;
  /** True when the rule above is met (always true for the sidebar). */
  separated: boolean;
  /** Degrees the hue was turned to get there. */
  turned: number;
}

export interface DerivedColors {
  /** CSS custom properties for the light theme (`:root`) and the dark theme (`.dark`); only the roles that were chosen. */
  light: Tokens;
  dark: Tokens;
  roles: Partial<Record<TeamColorRole, RoleResult>>;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Derive the tokens for the chosen colours. A missing, null or malformed role
 * is left alone (the brand's own tokens apply). `base` carries the brand's
 * surfaces and semantic colours; the default is the generic brand's.
 */
export function deriveTeamColors(
  input: TeamColorsInput,
  base: BrandBase = GENERIC_BASE,
): DerivedColors {
  const light: Tokens = {};
  const dark: Tokens = {};
  const roles: DerivedColors["roles"] = {};
  const pick = (r: TeamColorRole) => (isHexColor(input[r]) ? (input[r] as string) : null);
  const main = pick("main");
  const highlight = pick("highlight");
  const sidebar = pick("sidebar");

  // The sidebar first: the focus ring has to hold on it.
  const sb = sidebar ? sidebarOut(sidebar) : null;
  const sideForRing: Pair = sb ? sb.side : { light: base.light.side, dark: base.dark.side };

  if (main) {
    const r = separate(
      (by) => mainAt(main, by, base),
      (m) => Math.min(minDistance(m.base.light, base.light), minDistance(m.base.dark, base.dark)),
    );
    const m = r.value;
    for (const [theme, out] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      Object.assign(out, {
        "--brand-teal": m.base.light,
        "--primary-base": m.base[theme],
        "--on-primary": m.onPrimary[theme],
        "--primary-soft": m.soft[theme],
        "--primary-ink": m.ink[theme],
        "--stage-apprentice": m.base[theme],
        "--sidebar-primary": m.base.light,
        "--shadow-tint-primary": rgba(m.base.light, 0.35),
      });
    }
    dark["--win-line"] = m.ink.dark;
    roles.main = {
      chosen: main,
      used: m.base,
      adjusted: { light: !same(m.base.light, main), dark: !same(m.base.dark, main) },
      separation: reported(r.distance),
      separated: r.separated,
      turned: r.turned,
    };
  }

  if (highlight) {
    const r = separate(
      (by) => highlightAt(highlight, by, base, sideForRing),
      (h) =>
        Math.min(
          minDistance(h.sky, base.light),
          minDistance(h.sky, base.dark),
          minDistance(h.accent.light, base.light),
          minDistance(h.accent.dark, base.dark),
        ),
    );
    const h = r.value;
    for (const [theme, out] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      Object.assign(out, {
        "--brand-sky": h.sky,
        "--brand-on-sky": h.onSky,
        "--focus-ring": h.accent[theme],
        "--progress-fill": h.accent[theme],
        "--ring": h.accent[theme],
        "--sidebar-ring": h.accent[theme],
      });
    }
    roles.highlight = {
      chosen: highlight,
      used: h.accent,
      adjusted: {
        light: !same(h.accent.light, highlight),
        dark: !same(h.accent.dark, highlight),
      },
      separation: reported(r.distance),
      separated: r.separated,
      turned: r.turned,
    };
  }

  if (sb && sidebar) {
    for (const [theme, out] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      Object.assign(out, {
        "--brand-navy": sb.navy,
        "--side": sb.side[theme],
        "--side-fg": sb.sideFg[theme],
        "--event-bg": sb.event[theme],
        "--event-muted": sb.eventMuted[theme],
        "--stage-ibo": sb.ibo[theme],
        "--glass-tint-side": rgba(sb.side[theme], base[theme].sideAlpha),
        "--shadow-tint-soft": sb.shadowSoft,
        "--shadow-tint-strong": sb.shadowStrong,
      });
    }
    light["--win-line"] = sb.navy;
    roles.sidebar = {
      chosen: sidebar,
      used: { light: sb.navy, dark: sb.navy },
      adjusted: { light: !same(sb.navy, sidebar), dark: !same(sb.navy, sidebar) },
      separation: null,
      separated: true,
      turned: 0,
    };
  }
  return { light, dark, roles };
}

/** The stylesheet text for `deriveTeamColors`' output (`:root` for light, `.dark` for dark). Empty when nothing is derived. */
export function teamColorsCss(d: Pick<DerivedColors, "light" | "dark">): string {
  const block = (sel: string, t: Tokens) => {
    const body = Object.entries(t)
      .map(([k, v]) => `${k}:${v};`)
      .join("");
    return body ? `${sel}{${body}}` : "";
  };
  return block(":root", d.light) + block(".dark", d.dark);
}

/** A colour for an oklch (re-exported for the picker's previews). */
export const lch = (hex: string): Oklch => hexToOklch(hex);
