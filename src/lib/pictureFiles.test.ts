import { describe, expect, it } from "vitest";
import {
  PICTURE_LIMITS,
  PictureError,
  encodeUnderLimit,
  fitWithin,
  sniffImageType,
  type Encode,
  type PictureMime,
} from "./pictureFiles";

const bytes = (...v: number[]) => Uint8Array.from(v);
const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

describe("sniffImageType", () => {
  it("recognises PNG, JPEG and WebP by their first bytes", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe(
      "image/png",
    );
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
    expect(
      sniffImageType(Uint8Array.from([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBPVP8 ")])),
    ).toBe("image/webp");
  });
  it("refuses SVG, GIF, HTML, a WAV in RIFF clothing, and nothing", () => {
    expect(sniffImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageType(ascii("<?xml version"))).toBeNull();
    expect(sniffImageType(ascii("GIF89a......"))).toBeNull();
    expect(sniffImageType(ascii("<html><body>"))).toBeNull();
    expect(
      sniffImageType(Uint8Array.from([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVEfmt ")])),
    ).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
    expect(sniffImageType(bytes(0x89, 0x50))).toBeNull();
  });
});

describe("fitWithin", () => {
  it("scales the longest side down, never up", () => {
    expect(fitWithin(5120, 2880, 2560)).toEqual({ width: 2560, height: 1440 });
    expect(fitWithin(1000, 3000, 2560)).toEqual({ width: 853, height: 2560 });
    expect(fitWithin(800, 600, 2560)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1, 4000, 512)).toEqual({ width: 1, height: 512 });
  });
});

/** A pretend encoder: the size grows with the pixels and the quality; it can lack WebP. */
const fake =
  (opts: { webp?: boolean; bytesPerPixel: number }): Encode =>
  async (w, h, mime: PictureMime, q) => {
    const type = mime === "image/webp" && opts.webp === false ? "image/png" : mime;
    const size = Math.round(w * h * opts.bytesPerPixel * (type === "image/png" ? 1 : q));
    return new Blob([new Uint8Array(size)], { type });
  };

describe("encodeUnderLimit", () => {
  it("keeps a small picture as it is, at the best quality", async () => {
    const r = await encodeUnderLimit(
      "bg",
      { width: 1600, height: 900 },
      fake({ bytesPerPixel: 0.05 }),
    );
    expect(r).toMatchObject({ mime: "image/webp", width: 1600, height: 900 });
    expect(r.blob.size).toBeLessThanOrEqual(PICTURE_LIMITS.bg.maxBytes);
  });
  it("caps the size of a background at 2560 and its weight at 600 KB", async () => {
    const r = await encodeUnderLimit(
      "bg",
      { width: 6000, height: 4000 },
      fake({ bytesPerPixel: 0.4 }),
    );
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(2560);
    expect(r.blob.size).toBeLessThanOrEqual(PICTURE_LIMITS.bg.maxBytes);
  });
  it("shrinks the picture when quality alone cannot do it", async () => {
    const r = await encodeUnderLimit(
      "bg",
      { width: 2560, height: 1600 },
      fake({ bytesPerPixel: 1 }),
    );
    expect(r.width).toBeLessThan(2560);
    expect(r.blob.size).toBeLessThanOrEqual(PICTURE_LIMITS.bg.maxBytes);
  });
  it("caps a logo at 512 px and 200 KB", async () => {
    const r = await encodeUnderLimit(
      "logo",
      { width: 3000, height: 1500 },
      fake({ bytesPerPixel: 0.5 }),
    );
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(512);
    expect(r.blob.size).toBeLessThanOrEqual(PICTURE_LIMITS.logo.maxBytes);
    expect(r.mime).toBe("image/webp");
  });
  it("falls back to JPEG for a background and PNG for a logo where WebP cannot be written", async () => {
    const enc = fake({ webp: false, bytesPerPixel: 0.2 });
    // The fake labels a refused WebP as PNG; a real browser does the same.
    expect((await encodeUnderLimit("logo", { width: 400, height: 400 }, enc)).mime).toBe(
      "image/png",
    );
    const jpegOnly: Encode = async (w, h, mime, q) => {
      const type = mime === "image/webp" ? "image/png" : mime;
      return new Blob([new Uint8Array(Math.round(w * h * 0.2 * q))], { type });
    };
    expect((await encodeUnderLimit("bg", { width: 2000, height: 1000 }, jpegOnly)).mime).toBe(
      "image/jpeg",
    );
  });
  it("gives up with a readable error when no size works", async () => {
    await expect(
      encodeUnderLimit(
        "logo",
        { width: 512, height: 512 },
        async (w, h, mime) => new Blob([new Uint8Array(w * h * 80)], { type: mime }),
      ),
    ).rejects.toBeInstanceOf(PictureError);
  });
});
