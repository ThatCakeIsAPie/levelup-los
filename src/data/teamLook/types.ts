/**
 * The team's look (what the leader chooses in Settings > Team > Appearance),
 * the same shape in both data sources. With real accounts it is the
 * `workspaces` columns `background_mode`, `background_path`, `glass`,
 * `logo_path` and `colors` (written only by `set_workspace_appearance()`);
 * in the browser demo it is the `<prefix>.teamLook` store plus the pictures in
 * IndexedDB.
 */
export type BackgroundMode = "default" | "none" | "picture";

export interface TeamLookColors {
  /** Buttons, links, the selected state. null = the brand's own. */
  main: string | null;
  /** Progress, focus ring, accents. */
  highlight: string | null;
  /** The dark navigation and dark cards. */
  sidebar: string | null;
}

export interface TeamLook {
  /** `default` = the brand's own picture (none for a brand without one). */
  background: BackgroundMode;
  /** The picture, `<workspace id>/bg-<32 hex>.<webp|jpg>`; set exactly when `background` is `picture`. */
  backgroundPath: string | null;
  /** Glass on or off; null = the brand's own. Only meaningful over a picture. */
  glass: boolean | null;
  /** The logo that replaces the brand mark, `<workspace id>/logo-<32 hex>.<png|webp>`. */
  logoPath: string | null;
  colors: TeamLookColors;
}

export const DEFAULT_LOOK: TeamLook = {
  background: "default",
  backgroundPath: null,
  glass: null,
  logoPath: null,
  colors: { main: null, highlight: null, sidebar: null },
};

/** The look with every choice cleared. */
export function defaultLook(): TeamLook {
  return { ...DEFAULT_LOOK, colors: { ...DEFAULT_LOOK.colors } };
}
