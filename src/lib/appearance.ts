/**
 * Glass look and background picture: the runtime switch.
 *
 * Everything is driven by the <html> element, so CSS and components never
 * branch on brand or build:
 *   - `data-glass="on" | "off"`     the shared surfaces are translucent blurred glass (src/styles.css)
 *   - `data-backdrop="on" | "off"`  a fixed picture sits behind the app and the page background is transparent
 *   - `--backdrop-image`, `--backdrop-image-portrait`   the picture(s), as CSS `url()` values
 * The defaults come from `brand` (src/brand/brand.ts). `applyAppearance` changes
 * any of them at any time without a reload: a later settings screen where a
 * team's leader picks the picture or turns glass off just calls it.
 *
 * index.html sets the two attributes from the brand before first paint (the
 * plugin in vite.config.ts fills the placeholders); `initAppearance` then sets
 * the picture variables and keeps the preload hint in step.
 */
import { useSyncExternalStore } from "react";
import { brand } from "@/brand/brand";

export interface Appearance {
  /** Glass surfaces on. */
  glass: boolean;
  /** Landscape picture: a file name in the brand's public folder, or a full URL. null = no picture. */
  backgroundImage: string | null;
  /** Phone / portrait picture, same rules. null = reuse `backgroundImage`. */
  backgroundImagePortrait: string | null;
}

/** Phones and portrait windows get the portrait picture. Keep in step with `.app-backdrop` in src/styles.css. */
export const PORTRAIT_QUERY = "(max-aspect-ratio: 1 / 1), (max-width: 760px)";
const PRELOAD_ATTR = "data-appearance-preload";

let snapshot: Appearance = {
  glass: brand.glass,
  backgroundImage: brand.backgroundImage,
  backgroundImagePortrait: brand.backgroundImagePortrait,
};
const listeners = new Set<() => void>();

/** A file name in the brand's public folder becomes a URL under the site's base path; full URLs stay as they are. */
export function imageUrl(file: string): string {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(file)) return file;
  return import.meta.env.BASE_URL + file.replace(/^\.?\//, "");
}

const cssUrl = (url: string) => `url("${url.replace(/["\\\n]/g, encodeURIComponent)}")`;

function preload(landscape: string | null, portrait: string | null): void {
  document.head.querySelectorAll(`link[${PRELOAD_ATTR}]`).forEach((l) => l.remove());
  if (!landscape) return;
  const add = (href: string, media?: string) => {
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = href;
    if (media) link.media = media;
    link.setAttribute(PRELOAD_ATTR, "");
    document.head.appendChild(link);
  };
  if (portrait && portrait !== landscape) {
    add(landscape, `not all and ${PORTRAIT_QUERY}`);
    add(portrait, PORTRAIT_QUERY);
  } else {
    add(landscape);
  }
}

function write(a: Appearance): void {
  const root = document.documentElement;
  const landscape = a.backgroundImage ? imageUrl(a.backgroundImage) : null;
  const portrait = a.backgroundImagePortrait ? imageUrl(a.backgroundImagePortrait) : landscape;
  root.dataset.glass = a.glass ? "on" : "off";
  root.dataset.backdrop = landscape ? "on" : "off";
  if (landscape && portrait) {
    root.style.setProperty("--backdrop-image", cssUrl(landscape));
    root.style.setProperty("--backdrop-image-portrait", cssUrl(portrait));
  } else {
    root.style.removeProperty("--backdrop-image");
    root.style.removeProperty("--backdrop-image-portrait");
  }
  preload(landscape, portrait);
}

/**
 * Change the look now. Pass only what changes: `applyAppearance({ glass: false })`
 * turns glass off and keeps the picture; `{ backgroundImage: null }` removes the picture.
 */
export function applyAppearance(next: Partial<Appearance>): void {
  snapshot = { ...snapshot, ...next };
  if (typeof document === "undefined") return;
  write(snapshot);
  listeners.forEach((l) => l());
}

/** Apply the brand's defaults. Called once before the first render. */
export function initAppearance(): void {
  applyAppearance({});
}

/** What is applied right now. */
export function getAppearance(): Appearance {
  return snapshot;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook: the applied appearance (re-renders when `applyAppearance` changes it). */
export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, getAppearance, getAppearance);
}
