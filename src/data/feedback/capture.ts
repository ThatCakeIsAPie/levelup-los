/**
 * A snapshot of what the person is looking at, taken in the page itself (no
 * screen-sharing prompt): the visible viewport only, at device pixel ratio 1,
 * encoded as JPEG and kept under SNAPSHOT_MAX_BYTES. The capture library
 * (modern-screenshot) is loaded on demand, so it isn't in the main bundle.
 *
 * Never throws: a failure, or taking longer than SNAPSHOT_TIMEOUT_MS, gives null
 * and the feedback dialog simply opens without a picture.
 */
import { fitImage } from "./rules";
import { SNAPSHOT_MAX_BYTES, SNAPSHOT_TIMEOUT_MS } from "./types";

/** The page's own background, so the JPEG (which has no transparency) isn't black. */
function pageBackground(): string {
  for (const el of [document.body, document.documentElement]) {
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(c)) return c;
  }
  return "Canvas";
}

/**
 * Part of a long page that starts below the visible area: the capture can leave
 * it out, which roughly halves the time on a busy page. Children of flex
 * containers stay (dropping a sibling could resize the ones that are visible).
 */
function startsBelowViewport(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  if (node.getBoundingClientRect().top < window.innerHeight) return false;
  const parent = node.parentElement;
  if (!parent || /flex/.test(getComputedStyle(parent).display)) return false;
  return !/fixed|sticky/.test(getComputedStyle(node).position);
}

async function capture(): Promise<Blob | null> {
  const { domToCanvas } = await import("modern-screenshot");
  const width = window.innerWidth;
  const height = window.innerHeight;
  const canvas = await domToCanvas(document.documentElement, {
    width,
    height,
    scale: 1,
    backgroundColor: pageBackground(),
    timeout: SNAPSHOT_TIMEOUT_MS - 500,
    // The library player's idle <video> has no source and would make the capture wait forever.
    filter: (node) =>
      !(node instanceof HTMLMediaElement && !node.currentSrc) && !startsBelowViewport(node),
    // The shell scrolls inside <main>, not the page: draw it where it is scrolled to.
    features: { restoreScrollPosition: true },
  });
  return fitImage((scale, quality) => {
    let source = canvas;
    if (scale !== 1) {
      source = document.createElement("canvas");
      source.width = Math.max(1, Math.round(canvas.width * scale));
      source.height = Math.max(1, Math.round(canvas.height * scale));
      source.getContext("2d")?.drawImage(canvas, 0, 0, source.width, source.height);
    }
    return new Promise<Blob | null>((resolve) => source.toBlob(resolve, "image/jpeg", quality));
  }, SNAPSHOT_MAX_BYTES);
}

/** The current viewport as a JPEG under 400 KB, or null (failed, empty or too slow). */
export async function captureSnapshot(
  timeoutMs: number = SNAPSHOT_TIMEOUT_MS,
): Promise<Blob | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    return await Promise.race([
      capture().catch((e) => {
        console.warn("[feedback] snapshot failed", e);
        return null;
      }),
      timeout,
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
