/**
 * Build-time app configuration.
 *
 * The data source is chosen when the app is built, so page code is identical
 * in both modes:
 *  - "local": browser storage + the demo-user picker (GitHub Pages demo, and
 *    any build without Supabase settings).
 *  - "supabase": real accounts through Supabase Auth.
 *
 * `VITE_DATA_SOURCE` picks one explicitly; otherwise the app uses Supabase
 * when both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set.
 */

export type DataSource = "local" | "supabase";

export interface DataSourceEnv {
  VITE_DATA_SOURCE?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

/**
 * Pure resolution of the data source from env values. An explicit
 * "supabase" without both connection values falls back to "local" (with a
 * warning) rather than shipping a build that can't sign anyone in.
 */
export function resolveDataSource(env: DataSourceEnv): {
  source: DataSource;
  warning?: string;
} {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  const configured = Boolean(url && key);
  const explicit = env.VITE_DATA_SOURCE?.trim().toLowerCase();

  if (explicit === "local") return { source: "local" };
  if (explicit === "supabase") {
    return configured
      ? { source: "supabase" }
      : {
          source: "local",
          warning:
            "VITE_DATA_SOURCE=supabase but VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing; using local browser storage.",
        };
  }
  const warning = explicit
    ? `Unknown VITE_DATA_SOURCE "${env.VITE_DATA_SOURCE}"; expected "local" or "supabase".`
    : undefined;
  return { source: configured ? "supabase" : "local", warning };
}

const resolved = resolveDataSource(import.meta.env);
if (resolved.warning) console.warn(`[config] ${resolved.warning}`);

/** Where data and sign-in come from (fixed at build time). */
export const DATA_SOURCE: DataSource = resolved.source;
export const IS_SUPABASE = DATA_SOURCE === "supabase";
/** Browser-storage demo with the demo-user picker and "Reset demo data". */
export const IS_LOCAL_DEMO = DATA_SOURCE === "local";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

/**
 * Pure: the browser-storage namespace from env. Every localStorage key is
 * `<namespace>.<name>` and every IndexedDB database `<namespace>-<name>`.
 * Defaults to "levelup"; a second copy of the app on the same origin (the
 * develop preview under /levelup-los/develop/ on GitHub Pages) sets
 * `VITE_STORAGE_NAMESPACE` so its demo data stays apart from the main site's.
 */
export function resolveStorageNamespace(env: { VITE_STORAGE_NAMESPACE?: string }): string {
  return env.VITE_STORAGE_NAMESPACE?.trim() || "levelup";
}

export const STORAGE_NAMESPACE = resolveStorageNamespace(import.meta.env);

/** localStorage key for `name` in this build's namespace, e.g. "levelup.crm". */
export function storageKey(name: string): string {
  return `${STORAGE_NAMESPACE}.${name}`;
}

/**
 * Pure: absolute URL of an in-app path, respecting the deploy base
 * (e.g. "/levelup-los/" on GitHub Pages). `path` is relative to the app root;
 * a leading "/" is ignored.
 */
export function absoluteAppUrl(origin: string, base: string, path: string): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  return new URL(`${root}${path.replace(/^\/+/, "")}`, origin).toString();
}

/** Absolute URL of an in-app path for this deployment (for emails and shareable links). */
export function appUrl(path: string): string {
  return absoluteAppUrl(window.location.origin, import.meta.env.BASE_URL, path);
}
