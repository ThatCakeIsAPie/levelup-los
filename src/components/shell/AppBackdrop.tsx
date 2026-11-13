import { useAppearance } from "@/lib/appearance";

/**
 * The fixed background picture: a viewport-sized layer behind the whole app
 * (never animated, never scrolls, ignores the pointer). Renders nothing when
 * there is no picture, so a plain brand is exactly as without it. The picture,
 * its portrait variant and the scrim over it come from CSS variables
 * (`--backdrop-image`, `--backdrop-image-portrait`, `--scrim`); see
 * `.app-backdrop` in src/styles.css and src/lib/appearance.ts.
 */
export function AppBackdrop() {
  const { backgroundImage } = useAppearance();
  if (!backgroundImage) return null;
  return <div className="app-backdrop" aria-hidden="true" />;
}
