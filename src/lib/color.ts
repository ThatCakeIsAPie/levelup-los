/**
 * Colour maths for the team colours (no dependencies): hex <-> sRGB <-> OKLab /
 * OKLCH, WCAG contrast, and a gamut fit that keeps hue and lightness and gives
 * up as little chroma as it must. Pure functions; every result that leaves this
 * file is a lower-case `#rrggbb` string, so the contrast checks done on the
 * result are done on the exact colour that gets painted.
 */

export type Rgb = [number, number, number];
export interface Oklch {
  /** Lightness 0..1. */
  l: number;
  /** Chroma, about 0..0.37 inside sRGB. */
  c: number;
  /** Hue in degrees, 0..360. */
  h: number;
}

const HEX = /^#[0-9a-f]{6}$/;

/** A strict `#rrggbb` (lower case), the only colour form the app stores. */
export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX.test(v);
}

/** Lower-case `#rrggbb` from `#RRGGBB`, `#rgb` or the same without the `#`; null when it is none of those. */
export function normalizeHex(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(s)) return "#" + [...s].map((c) => c + c).join("");
  if (/^[0-9a-f]{6}$/.test(s)) return "#" + s;
  return null;
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const q = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return "#" + [q(r), q(g), q(b)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (l: number) => {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.max(l, 0) ** (1 / 2.4) - 0.055;
  return c * 255;
};

/** WCAG relative luminance, 0..1. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colours, 1..21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `top` painted at `alpha` over `under` (both opaque hex). */
export function over(top: string, alpha: number, under: string): string {
  const t = hexToRgb(top);
  const u = hexToRgb(under);
  return rgbToHex([0, 1, 2].map((i) => t[i] * alpha + u[i] * (1 - alpha)) as Rgb);
}

export type Lab = [number, number, number];

/** OKLab (Björn Ottosson's matrices). */
export function hexToOklab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToOklch(hex: string): Oklch {
  const [L, a, b] = hexToOklab(hex);
  const c = Math.hypot(a, b);
  const h = c < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

const EPS = 1e-6;
const inGamut = ([r, g, b]: Rgb) =>
  r >= -EPS && r <= 1 + EPS && g >= -EPS && g <= 1 + EPS && b >= -EPS && b <= 1 + EPS;

function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  return oklabToLinear([l, c * Math.cos(rad), c * Math.sin(rad)]);
}

/**
 * The colour with this lightness and hue and the most chroma up to `c` that
 * still fits in sRGB (chroma is reduced, never hue or lightness).
 */
export function oklchToHex({ l, c, h }: Oklch): string {
  if (l <= 0) return "#000000";
  if (l >= 1) return "#ffffff";
  let use = Math.max(0, c);
  if (!inGamut(oklchToLinear({ l, c: use, h }))) {
    let lo = 0;
    let hi = use;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ l, c: mid, h }))) lo = mid;
      else hi = mid;
    }
    use = lo;
  }
  const [r, g, b] = oklchToLinear({ l, c: use, h });
  return rgbToHex([fromLinear(r), fromLinear(g), fromLinear(b)]);
}

/** Straight-line distance in OKLab (about 0.02 is a just-noticeable difference, 0.1 is clearly another colour). */
export function oklabDistance(a: string, b: string): number {
  const x = hexToOklab(a);
  const y = hexToOklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** `#rrggbb` plus an alpha as the CSS `rgba(r, g, b, a)` the tokens use. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
}
