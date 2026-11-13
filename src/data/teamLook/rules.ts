/**
 * Rules for the team's look. They mirror `set_workspace_appearance()` and the
 * check constraints of migration `20261019000100_team_appearance.sql`, so the
 * browser refuses what the database would, and so a value that reaches the DOM
 * (a colour in a stylesheet, a path in a `url()`) is always one of these shapes.
 */
import { isHexColor } from "@/lib/color";
import { defaultLook, type BackgroundMode, type TeamLook, type TeamLookColors } from "./types";

export const LOOK_BUCKET = "team-appearance";

/** Biggest files the bucket takes (mirrors the bucket's `file_size_limit`). */
export const MAX_LOOK_FILE_BYTES = 1024 * 1024;

export type PictureKind = "bg" | "logo";

const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** `bg-<32 hex>.webp|jpg` and `logo-<32 hex>.png|webp`: one folder deep, nothing else. */
const FILE: Record<PictureKind, RegExp> = {
  bg: /^bg-[0-9a-f]{32}\.(webp|jpg)$/,
  logo: /^logo-[0-9a-f]{32}\.(png|webp)$/,
};
const MODES: readonly BackgroundMode[] = ["default", "none", "picture"];

export const isBackgroundMode = (v: unknown): v is BackgroundMode =>
  typeof v === "string" && (MODES as readonly string[]).includes(v);

export const isWorkspaceId = (v: unknown): v is string =>
  typeof v === "string" && WORKSPACE_ID.test(v);

/** True when `path` is `<workspaceId>/<a well-formed file name of this kind>`. */
export function isLookPath(path: unknown, workspaceId: string, kind: PictureKind): path is string {
  if (typeof path !== "string" || !isWorkspaceId(workspaceId)) return false;
  const slash = path.indexOf("/");
  if (slash < 1) return false;
  return path.slice(0, slash) === workspaceId && FILE[kind].test(path.slice(slash + 1));
}

/** The extension a picture of this MIME type gets, or null when the type is not allowed for the kind. */
export function pictureExtension(kind: PictureKind, mime: string): "webp" | "jpg" | "png" | null {
  if (kind === "bg") return mime === "image/webp" ? "webp" : mime === "image/jpeg" ? "jpg" : null;
  return mime === "image/webp" ? "webp" : mime === "image/png" ? "png" : null;
}

const hex32 = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

/** A new, unguessable object path for a picture of this kind and MIME type. */
export function newLookPath(workspaceId: string, kind: PictureKind, mime: string): string {
  const ext = pictureExtension(kind, mime);
  if (!ext || !isWorkspaceId(workspaceId)) throw new Error("That picture type is not allowed.");
  return `${workspaceId}/${kind}-${hex32()}.${ext}`;
}

export const isDefaultLook = (l: TeamLook): boolean =>
  l.background === "default" &&
  l.glass === null &&
  l.logoPath === null &&
  l.colors.main === null &&
  l.colors.highlight === null &&
  l.colors.sidebar === null;

export function sameLook(a: TeamLook, b: TeamLook): boolean {
  return (
    a.background === b.background &&
    a.backgroundPath === b.backgroundPath &&
    a.glass === b.glass &&
    a.logoPath === b.logoPath &&
    a.colors.main === b.colors.main &&
    a.colors.highlight === b.colors.highlight &&
    a.colors.sidebar === b.colors.sidebar
  );
}

/** Why a look would be refused (the database's rules), or null when it is fine. */
export function lookProblem(look: TeamLook, workspaceId: string): string | null {
  if (!isWorkspaceId(workspaceId)) return "workspace";
  if (!isBackgroundMode(look.background)) return "background";
  if (look.background === "picture") {
    if (!isLookPath(look.backgroundPath, workspaceId, "bg")) return "background picture";
  } else if (look.backgroundPath !== null) return "background picture";
  if (look.glass !== null && typeof look.glass !== "boolean") return "glass";
  if (look.logoPath !== null && !isLookPath(look.logoPath, workspaceId, "logo")) return "logo";
  for (const k of ["main", "highlight", "sidebar"] as const) {
    const c = look.colors[k];
    if (c !== null && !isHexColor(c)) return `${k} colour`;
  }
  return null;
}

/**
 * A look from untrusted data (a database row, the localStorage cache, a saved
 * demo store): every part that does not pass its rule falls back to the
 * default, so a tampered value never gets further than this function.
 */
export function parseLook(raw: unknown, workspaceId: string): TeamLook {
  const out = defaultLook();
  if (!raw || typeof raw !== "object" || !isWorkspaceId(workspaceId)) return out;
  const r = raw as Record<string, unknown>;
  if (r.background === "none") out.background = "none";
  if (r.background === "picture" && isLookPath(r.backgroundPath, workspaceId, "bg")) {
    out.background = "picture";
    out.backgroundPath = r.backgroundPath as string;
  }
  if (typeof r.glass === "boolean") out.glass = r.glass;
  if (isLookPath(r.logoPath, workspaceId, "logo")) out.logoPath = r.logoPath as string;
  const c = r.colors;
  if (c && typeof c === "object") {
    for (const k of ["main", "highlight", "sidebar"] as const) {
      const v = (c as Record<string, unknown>)[k];
      if (isHexColor(v)) (out.colors as TeamLookColors)[k] = v;
    }
  }
  return out;
}
