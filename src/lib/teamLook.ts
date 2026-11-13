/**
 * The team's look at runtime: the ONE place that turns a team's choices
 * (background, glass, logo, colours) into what the page shows.
 *
 *   applyTeamLook(resolved)   colours -> one <style id="team-look"> holding the
 *                             derived tokens for `:root` and `.dark`;
 *                             background and glass -> `applyAppearance()`;
 *                             logo -> `useTeamLogoUrl()`
 *   cacheTeamLook / restoreTeamLook / clearTeamLookCache
 *                             the last applied look in localStorage, keyed to the
 *                             signed-in person, so the next load paints it before data arrives
 *
 * Nothing user-controlled reaches the DOM unchecked: colours are `#rrggbb`
 * (`deriveTeamColors` writes the stylesheet from them), a picture's URL is built
 * from the storage URL and a validated path, or is a `blob:` URL this page made
 * itself (`safeImageUrl`), and every stored value is re-validated on the way in
 * (`parseLook`). Components never read the three chosen colours: they use the
 * tokens, which this file overrides.
 */
import { useSyncExternalStore } from "react";
import { brand } from "@/brand/brand";
import { IS_SUPABASE, SUPABASE_URL } from "@/lib/config";
import { storageKey } from "@/lib/brand";
import { applyAppearance } from "./appearance";
import { rgbToHex } from "./color";
import {
  GENERIC_BASE,
  deriveTeamColors,
  teamColorsCss,
  type BrandBase,
  type DerivedColors,
  type TeamColorsInput,
  type ThemeBase,
} from "./teamColors";
import { LOOK_BUCKET, isDefaultLook, isWorkspaceId, parseLook } from "@/data/teamLook/rules";
import { defaultLook, type TeamLook } from "@/data/teamLook/types";

// ---------------------------------------------------------------------------
// Picture URLs
// ---------------------------------------------------------------------------

/** A stored picture path: one folder (the workspace), then a generated file name. */
const SAFE_PATH = /^[A-Za-z0-9_-]{1,64}\/(bg|logo)-[0-9a-f]{32}\.(webp|jpg|png)$/;
const BLOB_URL = /^blob:(https?:\/\/[A-Za-z0-9.:[\]-]{1,100})\/[0-9a-f-]{36}$/;

export interface UrlContext {
  /** The Supabase project URL ("" in the demo). */
  supabaseUrl: string;
  /** `location.origin`, for `blob:` URLs. */
  origin: string;
}

const defaultContext = (): UrlContext => ({
  supabaseUrl: SUPABASE_URL,
  origin: typeof location === "undefined" ? "" : location.origin,
});

function storagePrefix(supabaseUrl: string): string | null {
  try {
    const u = new URL(supabaseUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}/storage/v1/object/public/${LOOK_BUCKET}/`;
  } catch {
    return null;
  }
}

/** The public URL of a stored picture, built only from the storage URL and a validated path; null for anything else. */
export function teamImageUrl(path: unknown, ctx: UrlContext = defaultContext()): string | null {
  if (typeof path !== "string" || !SAFE_PATH.test(path)) return null;
  const prefix = ctx.supabaseUrl ? storagePrefix(ctx.supabaseUrl) : null;
  return prefix ? prefix + path : null;
}

/** `url` when it is one of the two shapes that may be put into CSS (a team picture in storage, or a `blob:` of this page); else null. */
export function safeImageUrl(url: unknown, ctx: UrlContext = defaultContext()): string | null {
  if (typeof url !== "string" || url.length > 500) return null;
  const blob = BLOB_URL.exec(url);
  if (blob) return ctx.origin && blob[1] === ctx.origin ? url : null;
  const prefix = ctx.supabaseUrl ? storagePrefix(ctx.supabaseUrl) : null;
  if (prefix && url.startsWith(prefix) && SAFE_PATH.test(url.slice(prefix.length))) return url;
  return null;
}

// ---------------------------------------------------------------------------
// The brand's own tokens (read once, with the team's colours switched off)
// ---------------------------------------------------------------------------

const STYLE_ID = "team-look";
const TOKENS = [
  "--app-bg",
  "--surface",
  "--surface-2",
  "--track",
  "--ok",
  "--amber-strong",
  "--danger",
  "--side",
  "--glass-tint-side",
  "--brand-teal",
  "--brand-sky",
  "--brand-navy",
] as const;

/** `#rrggbb` from `#rgb`, `#rrggbb`, `#rrggbbaa` or `rgb()` / `rgba()`; null when it is none of those. */
export function cssToHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return "#" + [...m[1]].map((c) => c + c).join("");
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) return "#" + m[1];
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(v);
  return m ? rgbToHex([Number(m[1]), Number(m[2]), Number(m[3])]) : null;
}

/** The alpha of `rgba(...)` or `#rrggbbaa`; 1 for an opaque colour, null when unreadable. */
export function cssAlpha(value: string): number | null {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/.test(v)) return 1;
  const h = /^#[0-9a-f]{6}([0-9a-f]{2})$/.exec(v);
  if (h) return Math.round((parseInt(h[1], 16) / 255) * 1000) / 1000;
  const m = /^rgba\(.*[\s,/]+([0-9.]+%?)\s*\)$/.exec(v);
  if (m) return m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  return /^rgb\(/.test(v) ? 1 : null;
}

export interface BrandColors {
  main: string;
  highlight: string;
  sidebar: string;
}
interface BrandInfo {
  base: BrandBase;
  colors: BrandColors;
}
let brandInfo: BrandInfo | null = null;

function themeBase(raw: Record<string, string>, fallback: ThemeBase): ThemeBase {
  const hex = (k: string, d: string) => cssToHex(raw[k] ?? "") ?? d;
  const alpha = cssAlpha(raw["--glass-tint-side"] ?? "");
  return {
    appBg: hex("--app-bg", fallback.appBg),
    surface: hex("--surface", fallback.surface),
    surface2: hex("--surface-2", fallback.surface2),
    track: hex("--track", fallback.track),
    semantic: [
      hex("--ok", fallback.semantic[0]),
      hex("--amber-strong", fallback.semantic[1]),
      hex("--danger", fallback.semantic[2]),
    ],
    side: hex("--side", fallback.side),
    sideAlpha: alpha !== null && alpha > 0 && alpha <= 1 ? alpha : fallback.sideAlpha,
  };
}

/** The brand's surfaces and colours in both themes, read from its own tokens (the team's stylesheet is switched off while reading). */
function readBrand(): BrandInfo {
  if (brandInfo) return brandInfo;
  if (typeof document === "undefined") return { base: GENERIC_BASE, colors: genericColors() };
  const root = document.documentElement;
  const style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  const wasDark = root.classList.contains("dark");
  if (style) style.disabled = true;
  const read = () => {
    const cs = getComputedStyle(root);
    return Object.fromEntries(TOKENS.map((t) => [t, cs.getPropertyValue(t)])) as Record<
      string,
      string
    >;
  };
  root.classList.remove("dark");
  const light = read();
  root.classList.add("dark");
  const dark = read();
  root.classList.toggle("dark", wasDark);
  if (style) style.disabled = false;
  brandInfo = {
    base: {
      light: themeBase(light, GENERIC_BASE.light),
      dark: themeBase(dark, GENERIC_BASE.dark),
    },
    colors: {
      main: cssToHex(light["--brand-teal"]) ?? "#4f46e5",
      highlight: cssToHex(light["--brand-sky"]) ?? "#8f98f7",
      sidebar: cssToHex(light["--brand-navy"]) ?? "#1b2230",
    },
  };
  return brandInfo;
}
const genericColors = (): BrandColors => ({
  main: "#4f46e5",
  highlight: "#8f98f7",
  sidebar: "#1b2230",
});

/** The brand's surfaces and semantic colours, for `deriveTeamColors`. */
export const getBrandBase = (): BrandBase => readBrand().base;
/** The brand's own Main, Highlight and Sidebar colours (what a picker shows for "default"). */
export const getBrandColors = (): BrandColors => readBrand().colors;

/** The derivation for the colours as they would be applied (for the pickers' "adjusted" notes). */
export function previewColors(colors: TeamColorsInput): DerivedColors {
  return deriveTeamColors(colors, getBrandBase());
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/** A look with its pictures turned into URLs that are safe to put into CSS and `<img>` (null = none / unavailable). */
export interface ResolvedLook {
  look: TeamLook;
  backgroundUrl: string | null;
  logoUrl: string | null;
}

let logoUrl: string | null = null;
const logoListeners = new Set<() => void>();
const subscribeLogo = (cb: () => void) => {
  logoListeners.add(cb);
  return () => void logoListeners.delete(cb);
};
const setLogo = (url: string | null) => {
  if (url === logoUrl) return;
  logoUrl = url;
  logoListeners.forEach((l) => l());
};

/** The team's logo (a safe URL) while a signed-in team has one; null shows the brand mark. */
export const getTeamLogoUrl = (): string | null => logoUrl;
export function useTeamLogoUrl(): string | null {
  return useSyncExternalStore(subscribeLogo, getTeamLogoUrl, () => null);
}

function writeColors(colors: TeamColorsInput): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  const css = teamColorsCss(deriveTeamColors(colors, getBrandBase()));
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

let previewing = false;
/** True while the Settings editor shows a look that is not saved; the saved look is not applied meanwhile. */
export const isPreviewing = (): boolean => previewing;
export const setPreviewing = (on: boolean): void => void (previewing = on);

/**
 * Show a look now (no reload). `null` or an all-default look shows the brand's
 * own colours, picture, glass and mark exactly as if nothing had been chosen.
 */
export function applyTeamLook(resolved: ResolvedLook | null): void {
  if (typeof document === "undefined") return;
  const look = resolved?.look ?? defaultLook();
  const isDefault = !resolved || isDefaultLook(look);
  readBrand(); // before the stylesheet changes, so the brand's values are read untouched
  writeColors(isDefault ? {} : look.colors);

  const bgUrl = isDefault ? null : safeImageUrl(resolved.backgroundUrl);
  if (isDefault) {
    applyAppearance({
      glass: brand.glass,
      backgroundImage: brand.backgroundImage,
      backgroundImagePortrait: brand.backgroundImagePortrait,
      teamPicture: false,
    });
  } else if (look.background === "picture" && bgUrl) {
    // The team's own picture, one file for every screen size; glass follows the choice.
    applyAppearance({
      glass: look.glass ?? brand.glass,
      backgroundImage: bgUrl,
      backgroundImagePortrait: null,
      teamPicture: true,
    });
  } else if (look.background === "none") {
    applyAppearance({
      glass: false,
      backgroundImage: null,
      backgroundImagePortrait: null,
      teamPicture: false,
    });
  } else {
    // "default" (or a picture that is not available): the brand's own picture, if it has one. Glass needs a picture.
    const has = brand.backgroundImage !== null;
    applyAppearance({
      glass: has && (look.glass ?? brand.glass),
      backgroundImage: brand.backgroundImage,
      backgroundImagePortrait: brand.backgroundImagePortrait,
      teamPicture: false,
    });
  }
  setLogo(isDefault ? null : safeImageUrl(resolved.logoUrl));
}

// ---------------------------------------------------------------------------
// The cache: the last applied look, per signed-in person
// ---------------------------------------------------------------------------

const CACHE_KEY = storageKey("look");

interface Cached {
  v: 1;
  owner: string;
  workspaceId: string;
  look: TeamLook;
}

/** Remember the look for this person (the next page load applies it before any data arrives). */
export function cacheTeamLook(owner: string, workspaceId: string, look: TeamLook): void {
  try {
    if (isDefaultLook(look)) localStorage.removeItem(CACHE_KEY);
    else
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ v: 1, owner, workspaceId, look } satisfies Cached),
      );
  } catch {
    // No room or no storage: the look just loads with the data next time.
  }
}

export function clearTeamLookCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Who the browser has a saved session for (an auth user id, or the demo person's id), without waiting for the app to start. */
export function persistedOwner(): string | null {
  try {
    if (IS_SUPABASE) {
      const s: unknown = JSON.parse(localStorage.getItem(storageKey("auth")) ?? "null");
      const id = (s as { user?: { id?: unknown } } | null)?.user?.id;
      return typeof id === "string" ? id : null;
    }
    const s: unknown = JSON.parse(localStorage.getItem(storageKey("session")) ?? "null");
    const id = (s as { state?: { user?: { personId?: unknown } } } | null)?.state?.user?.personId;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/**
 * Apply the cached look before the first render, when it belongs to the person
 * whose session this browser holds (never on the sign-in page, never for
 * someone else). Returns a promise only when a picture has to be read from the
 * browser's own storage first (the demo); with real accounts it is synchronous.
 */
export function restoreTeamLook(
  resolveLocal?: (look: TeamLook) => Promise<ResolvedLook>,
): Promise<void> | void {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
  } catch {
    return;
  }
  const c = raw as Partial<Cached> | null;
  if (!c || c.v !== 1 || typeof c.owner !== "string" || !isWorkspaceId(c.workspaceId)) return;
  if (c.owner !== persistedOwner()) return;
  const look = parseLook(c.look, c.workspaceId);
  if (isDefaultLook(look)) return;
  if (IS_SUPABASE) {
    applyTeamLook({
      look,
      backgroundUrl: look.backgroundPath ? teamImageUrl(look.backgroundPath) : null,
      logoUrl: look.logoPath ? teamImageUrl(look.logoPath) : null,
    });
    return;
  }
  if (!resolveLocal) return;
  return resolveLocal(look).then(applyTeamLook, () =>
    applyTeamLook({ look, backgroundUrl: null, logoUrl: null }),
  );
}
