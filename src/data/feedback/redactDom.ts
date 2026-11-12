/**
 * Paints the sensitive parts of a CLONED page as solid black bars. It is given
 * the clone that modern-screenshot is about to render (never the live
 * document), so the page on screen is not touched and nothing flashes.
 *
 * 1. Every `[data-sensitive]` element (src/lib/sensitive.ts) becomes a black box
 *    of the same size: black background, text transparent, everything inside it
 *    hidden, images and canvases drawn black, input values and placeholders gone.
 *    Only paint properties change, so layout stays as it was.
 * 2. The value safety net (./redact.ts): any text, input value or placeholder in
 *    the clone that holds a known name, phone, email, place or ID number is
 *    blacked out too, marked or not.
 */
import { ALWAYS_SENSITIVE_SELECTOR, SENSITIVE_SELECTOR } from "@/lib/sensitive";
import type { SensitiveMatcher } from "./redact";

/** Set on every element this file blacks out. */
export const REDACTED_ATTR = "data-redacted";

/** A black square that stretches to any size, drawn instead of a photo. */
const BLACK_PIXEL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1' preserveAspectRatio='none'%3E%3Crect width='1' height='1'/%3E%3C/svg%3E";

export interface RedactionStats {
  /** Elements painted black because they were marked. */
  marked: number;
  /** Text stretches, inputs and placeholders painted black by value matching alone. */
  byValue: number;
}

const SKIP_TEXT = new Set(["SCRIPT", "STYLE", "TITLE", "NOSCRIPT", "TEMPLATE"]);
const SVG_NS = "http://www.w3.org/2000/svg";

function isSvg(el: Element): boolean {
  return el.namespaceURI === SVG_NS;
}

/** Black out an element's own box (not its content: see `hideInside`). */
function paintBlack(el: HTMLElement | SVGElement): void {
  const s = el.style;
  const set = (name: string, value: string) => s.setProperty(name, value, "important");
  set("background-color", "black");
  set("background-image", "none");
  set("color", "transparent");
  set("text-shadow", "none");
  set("box-shadow", "none");
  set("border-color", "black");
  set("outline", "none");
  set("caret-color", "transparent");
  set("opacity", "1");
  set("filter", "none");
  set("-webkit-text-fill-color", "transparent");
  el.setAttribute(REDACTED_ATTR, "");
}

/** Everything inside is invisible, so only the parent's black shows. */
function hideInside(el: Element): void {
  for (const child of Array.from(el.querySelectorAll<HTMLElement | SVGElement>("*"))) {
    child.style.setProperty("visibility", "hidden", "important");
  }
}

function blankReplaced(el: Element): void {
  if (el instanceof HTMLImageElement) {
    el.removeAttribute("srcset");
    el.removeAttribute("sizes");
    el.removeAttribute("loading");
    el.setAttribute("src", BLACK_PIXEL);
    el.style.setProperty("object-fit", "fill", "important");
  } else if (el instanceof HTMLInputElement) {
    el.removeAttribute("value");
    el.removeAttribute("placeholder");
    el.removeAttribute("list");
    el.value = "";
  } else if (el instanceof HTMLTextAreaElement) {
    el.removeAttribute("value");
    el.removeAttribute("placeholder");
    el.textContent = "";
  } else if (el instanceof HTMLCanvasElement) {
    const ctx = el.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, el.width, el.height);
    }
  } else if (el instanceof HTMLVideoElement) {
    el.removeAttribute("src");
    el.removeAttribute("poster");
    el.replaceChildren();
  } else if (el instanceof HTMLIFrameElement) {
    el.removeAttribute("src");
    el.removeAttribute("srcdoc");
  }
}

/** Paint one element (and everything inside it) black. */
export function blackOut(el: Element): void {
  if (!(el instanceof HTMLElement || el instanceof SVGElement)) return;
  blankReplaced(el);
  hideInside(el);
  paintBlack(el);
}

/** Pseudo-elements (::before, ::after) of a black box must not paint over it. */
function addPseudoRule(root: Element): void {
  const style = root.ownerDocument.createElement("style");
  style.textContent = `[${REDACTED_ATTR}]::before,[${REDACTED_ATTR}]::after{content:none!important;display:none!important}[${REDACTED_ATTR}]::placeholder{color:transparent!important}`;
  (root.querySelector("head") ?? root).appendChild(style);
}

/** Black out the stretches of one text node that the matcher finds. Returns how many. */
function redactTextNode(node: Text, matcher: SensitiveMatcher): number {
  const parent = node.parentElement;
  if (!parent || SKIP_TEXT.has(parent.tagName) || parent.hasAttribute(REDACTED_ATTR)) return 0;
  const text = node.data;
  const ranges = matcher.find(text);
  if (!ranges.length) return 0;

  // A select shows its chosen option's text, a textarea its value: black the control.
  const control = parent.closest("select, textarea");
  if (control) {
    blackOut(control);
    return 1;
  }
  // SVG text (charts) can't hold a span: take its colour away.
  if (isSvg(parent)) {
    parent.style.setProperty("fill", "transparent", "important");
    parent.style.setProperty("stroke", "none", "important");
    parent.setAttribute(REDACTED_ATTR, "");
    return 1;
  }

  const doc = node.ownerDocument;
  const layout = parent.style.display;
  // Splitting a text node inside a flex or grid box would make extra items: black all of it.
  const whole =
    /flex|grid/.test(layout) ||
    (ranges.length === 1 && ranges[0][1] - ranges[0][0] >= text.trim().length);
  const pieces: Node[] = [];
  const bar = (value: string) => {
    const span = doc.createElement("span");
    span.textContent = value;
    paintBlack(span);
    return span;
  };
  if (whole) {
    pieces.push(bar(text));
  } else {
    let at = 0;
    for (const [start, end] of ranges) {
      if (start > at) pieces.push(doc.createTextNode(text.slice(at, start)));
      pieces.push(bar(text.slice(start, end)));
      at = end;
    }
    if (at < text.length) pieces.push(doc.createTextNode(text.slice(at)));
  }
  node.replaceWith(...pieces);
  return ranges.length;
}

/**
 * Redact `root` (the clone) in place.
 * `matcher` is optional only so the marked part can be run alone in tests.
 */
export function redactClone(root: Element, matcher: SensitiveMatcher | null): RedactionStats {
  const stats: RedactionStats = { marked: 0, byValue: 0 };

  // 1. Marked elements.
  for (const el of Array.from(
    root.querySelectorAll(`${SENSITIVE_SELECTOR}, ${ALWAYS_SENSITIVE_SELECTOR}`),
  )) {
    if (el.hasAttribute(REDACTED_ATTR)) continue;
    blackOut(el);
    stats.marked++;
  }

  if (matcher) {
    // 2. Form values and placeholders that hold a known value.
    for (const el of Array.from(root.querySelectorAll("input, textarea"))) {
      if (el.hasAttribute(REDACTED_ATTR)) continue;
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      const type = input instanceof HTMLInputElement ? input.type : "text";
      if (/^(checkbox|radio|range|file|color|button|submit|reset|image)$/.test(type)) continue;
      const shown = [
        input.getAttribute("value"),
        input.getAttribute("placeholder"),
        input instanceof HTMLTextAreaElement ? input.textContent : null,
      ];
      if (shown.some((v) => v && matcher.find(v).length)) {
        blackOut(input);
        stats.byValue++;
      }
    }

    // 3. Text anywhere in the clone: one pass, one combined matcher.
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
    for (const t of texts) stats.byValue += redactTextNode(t, matcher);
  }

  if (stats.marked || stats.byValue) addPseudoRule(root);
  return stats;
}
