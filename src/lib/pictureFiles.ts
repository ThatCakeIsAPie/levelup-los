/**
 * Pictures a leader uploads (the team background and logo): checked, shrunk and
 * re-encoded in the browser BEFORE they are stored. Only PNG, JPEG and WebP are
 * accepted (decided by the file's first bytes, never its name or declared type,
 * so an SVG renamed to .png is refused); a file that does not decode is refused;
 * the result is always a fresh WebP, JPEG or PNG made by the canvas, never the
 * original bytes, so nothing hidden in the file is kept.
 *
 *   background: longest side at most 2560 px, WebP (JPEG where the browser cannot write WebP), under about 600 KB
 *   logo:       longest side at most 512 px, WebP or PNG with transparency kept, under about 200 KB
 */
import type { PictureKind } from "@/data/teamLook/rules";

export const PICTURE_LIMITS = {
  bg: { maxSide: 2560, maxBytes: 600 * 1024, minSide: 640 },
  logo: { maxSide: 512, maxBytes: 200 * 1024, minSide: 64 },
} as const;

/** The biggest file read at all (a phone photo is 2 to 12 MB). */
export const MAX_INPUT_BYTES = 40 * 1024 * 1024;
/** Pictures beyond this many pixels are refused instead of decoded. */
export const MAX_INPUT_PIXELS = 100_000_000;

export class PictureError extends Error {}

export type PictureMime = "image/png" | "image/jpeg" | "image/webp";

/** The type of an image by its first bytes: PNG, JPEG or WebP; null for anything else (SVG, GIF, HTML, empty...). */
export function sniffImageType(b: Uint8Array): PictureMime | null {
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const ascii = (from: number, s: string) =>
    [...s].every((c, i) => b[from + i] === c.charCodeAt(0));
  if (b.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

/** Scale (w, h) down so the longest side is at most `max` (never up), keeping the aspect ratio. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

export interface Encoded {
  blob: Blob;
  mime: PictureMime;
  width: number;
  height: number;
}

/** Writes the picture at a size and quality as one MIME type; `blob.type` says what the browser actually produced. */
export type Encode = (
  width: number,
  height: number,
  mime: PictureMime,
  quality: number,
) => Promise<Blob>;

const QUALITIES = [0.86, 0.78, 0.7, 0.62, 0.54, 0.46, 0.38, 0.3];

/**
 * Find the nicest encoding under the size limit: the highest quality at the
 * largest size that fits, shrinking the picture by a sixth each time quality
 * alone cannot get there, down to a floor.
 */
export async function encodeUnderLimit(
  kind: PictureKind,
  natural: { width: number; height: number },
  encode: Encode,
): Promise<Encoded> {
  const { maxSide, maxBytes, minSide } = PICTURE_LIMITS[kind];
  const preferred: PictureMime = "image/webp";
  let size = fitWithin(natural.width, natural.height, maxSide);
  for (;;) {
    // WebP first; where the browser cannot write it, JPEG for a background and PNG for a logo.
    let blob = await encode(size.width, size.height, preferred, QUALITIES[0]);
    const mime: PictureMime =
      blob.type === "image/webp" ? "image/webp" : kind === "bg" ? "image/jpeg" : "image/png";
    if (mime !== "image/webp") blob = await encode(size.width, size.height, mime, QUALITIES[0]);
    if (blob.type === mime && blob.size <= maxBytes) return { blob, mime, ...size };
    // PNG ignores quality, so only the lossy types step down through the list.
    if (mime !== "image/png") {
      for (const q of QUALITIES.slice(1)) {
        const b = await encode(size.width, size.height, mime, q);
        if (b.type === mime && b.size <= maxBytes) return { blob: b, mime, ...size };
      }
    }
    const next = fitWithin(
      size.width,
      size.height,
      Math.round(Math.max(size.width, size.height) * 0.84),
    );
    if (
      Math.max(next.width, next.height) < minSide ||
      (next.width === size.width && next.height === size.height)
    )
      throw new PictureError(
        "That picture is too detailed to make small enough. Try a simpler one.",
      );
    size = next;
  }
}

function toBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  mime: PictureMime,
  quality: number,
): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: mime, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new PictureError("This browser could not save the picture.")),
      mime,
      quality,
    ),
  );
}

/**
 * Check, decode, shrink and re-encode a picked file. Throws a `PictureError`
 * with a short message the leader can read when the file is not usable.
 */
export async function preparePicture(file: Blob, kind: PictureKind): Promise<Encoded> {
  if (file.size === 0) throw new PictureError("That file is empty.");
  if (file.size > MAX_INPUT_BYTES)
    throw new PictureError("That file is too big. Pick one under 40 MB.");
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!sniffImageType(head)) throw new PictureError("Use a PNG, JPEG or WebP picture.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PictureError("That picture could not be read. Try another file.");
  }
  try {
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width * bitmap.height > MAX_INPUT_PIXELS)
      throw new PictureError("That picture is too large to use.");
    const encode: Encode = async (width, height, mime, quality) => {
      const canvas: HTMLCanvasElement | OffscreenCanvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : Object.assign(document.createElement("canvas"), { width, height });
      const ctx = canvas.getContext("2d") as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) throw new PictureError("This browser could not process the picture.");
      // A JPEG has no transparency: paint white under it instead of black.
      if (mime === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, width, height);
      return toBlob(canvas, mime, quality);
    };
    return await encodeUnderLimit(kind, { width: bitmap.width, height: bitmap.height }, encode);
  } finally {
    bitmap.close();
  }
}
