/**
 * Snapshots are always plain. modern-screenshot cannot draw `backdrop-filter`,
 * and the fixed background picture would only make the JPEG bigger and the
 * text harder to read (and the blurred base that full-screen overlays paint on a
 * pseudo-element goes too), so when the glass look or the picture is on, the CLONE
 * it renders is made plain: no picture, no blur, no text shadow, and every glass
 * surface painted with the solid colour of the plain look.
 *
 * The solid colours are the raw tokens (`--surface`, `--surface-2`, ...): the
 * glass look only changes what the surface utilities read (`--surface-fill`,
 * ...), never these. The rules are added to the clone as !important
 * declarations, because the library copies the page's computed styles into the
 * clone as inline styles. Inline !important (redaction's black boxes) still wins.
 * The live page is not touched.
 */

/** The solid values of the plain look, read from the live page's tokens. */
export interface PlainTokens {
  appBg: string;
  surface: string;
  surface2: string;
  track: string;
  side: string;
  event: string;
}

/** CSS that makes a clone of the page plain. Empty tokens leave their rule out. */
export function plainSnapshotCss(t: PlainTokens): string {
  const paint = (selectors: string, color: string) =>
    color
      ? `${selectors}{background-color:${color}!important;background-image:none!important;box-shadow:none!important}`
      : "";
  return [
    "*,*::before,*::after{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;text-shadow:none!important}",
    // The blurred base a full-screen overlay paints through its ::before (src/styles.css).
    ".bg-app::before{display:none!important}",
    paint(".bg-app", t.appBg),
    paint(".glass,.bg-surface,.bg-card,.bg-popover", t.surface),
    paint(".bg-surface-2", t.surface2),
    paint(".bg-track", t.track),
    paint(".bg-sidebar", t.side),
    paint(".bg-event", t.event),
  ]
    .filter(Boolean)
    .join("");
}

/** True while the glass look or the background picture is showing (so a snapshot needs the plain treatment). */
export function needsPlainSnapshot(root: HTMLElement): boolean {
  return root.dataset.glass === "on" || root.dataset.backdrop === "on";
}

/** Read the plain tokens from the live page. */
export function readPlainTokens(root: HTMLElement): PlainTokens {
  const style = getComputedStyle(root);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    appBg: token("--app-bg"),
    surface: token("--surface"),
    surface2: token("--surface-2"),
    track: token("--track"),
    side: token("--side"),
    event: token("--event-bg"),
  };
}

/** Make the clone plain: add the rules as a <style> in its head. */
export function makeClonePlain(clone: Element, tokens: PlainTokens): void {
  const style = clone.ownerDocument.createElement("style");
  style.textContent = plainSnapshotCss(tokens);
  (clone.querySelector("head") ?? clone).appendChild(style);
}
