/**
 * Light / dark / auto theme.
 *
 * - The preference is stored in localStorage under "levelup.theme".
 * - The `dark` class on <html> switches every token in src/styles.css.
 * - "auto" follows `prefers-color-scheme` live.
 * - index.html runs an inline copy of `resolve()` before first paint so the
 *   page never flashes the wrong theme; keep the two in sync.
 *
 * Usage in components: `const { preference, resolved, setPreference } = useTheme();`
 */
import { useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "levelup.theme";
export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
];

/** Browser chrome color per theme (matches --app-bg). */
const THEME_COLOR: Record<ResolvedTheme, string> = { light: "#F6F4EF", dark: "#0E1B2E" };

const isPref = (v: unknown): v is ThemePreference => v === "light" || v === "dark" || v === "auto";

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isPref(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

function systemDark(): boolean {
  return (
    typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === "auto") return systemDark() ? "dark" : "light";
  return pref;
}

type Snapshot = { preference: ThemePreference; resolved: ResolvedTheme };

let snapshot: Snapshot = { preference: "auto", resolved: "light" };
const listeners = new Set<() => void>();
let started = false;

function apply(next: Snapshot) {
  snapshot = next;
  const root = document.documentElement;
  root.classList.toggle("dark", next.resolved === "dark");
  root.style.colorScheme = next.resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[next.resolved]);
  listeners.forEach((l) => l());
}

/** Read the saved preference, apply it, and start following the OS setting. Idempotent. */
export function initTheme(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const preference = readStored();
  apply({ preference, resolved: resolve(preference) });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (snapshot.preference === "auto") apply({ preference: "auto", resolved: resolve("auto") });
  });
}

/** Current saved preference ("auto" when nothing is saved). */
export function getThemePreference(): ThemePreference {
  return snapshot.preference;
}

/** Theme actually shown right now. */
export function getResolvedTheme(): ResolvedTheme {
  return snapshot.resolved;
}

/** Save and apply a preference. */
export function setThemePreference(preference: ThemePreference): void {
  initTheme();
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this session.
  }
  apply({ preference, resolved: resolve(preference) });
}

function subscribe(cb: () => void) {
  initTheme();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook: current preference, resolved theme, and a setter. */
export function useTheme(): Snapshot & { setPreference: (p: ThemePreference) => void } {
  const s = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
  return { ...s, setPreference: setThemePreference };
}
