/**
 * Chat attachments. The storage abstraction is two calls:
 *
 *   saveAttachment(blob)     -> Promise<{ storagePath }>
 *   useAttachmentUrl(path)   -> a URL the browser can display/play (or undefined while loading)
 *
 * This implementation keeps blobs in IndexedDB (database "levelup-chat-media",
 * store "blobs"; paths look like "idb:<uuid>"). The Supabase implementation
 * uploads to a Storage bucket and returns a signed URL for the same path.
 * Demo seed media uses "seed:" paths and is synthesised on demand (a short
 * hummed voice note, a route map image), so the seed needs no binary files.
 *
 * Also here: client-side image compression (canvas, max 1600px, JPEG ~0.8),
 * voice recording (MediaRecorder with iOS/Safari-compatible MIME types) and
 * waveform peaks decoded from the audio itself.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const DB_NAME = "levelup-chat-media";
const STORE = "blobs";

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("Could not open IndexedDB"));
    };
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

/** Store a blob and return the path to put in `Attachment.storagePath`. */
export async function saveAttachment(blob: Blob): Promise<{ storagePath: string }> {
  const key = crypto.randomUUID();
  await tx("readwrite", (s) => s.put(blob, key));
  return { storagePath: `idb:${key}` };
}

/** Read a stored blob (null when missing). Seed paths are synthesised. */
export async function loadAttachment(path: string): Promise<Blob | null> {
  if (path.startsWith("seed:")) return synthSeedMedia(path);
  if (!path.startsWith("idb:")) return null;
  const v = await tx<unknown>("readonly", (s) => s.get(path.slice(4)));
  return v instanceof Blob ? v : null;
}

/** Remove a stored blob (no-op for seed paths). */
export async function deleteAttachment(path: string): Promise<void> {
  urlCache.delete(path);
  if (!path.startsWith("idb:")) return;
  await tx("readwrite", (s) => s.delete(path.slice(4))).catch(() => undefined);
}

/** Wipe every stored blob (called when the chat demo data is re-seeded). */
export async function clearAttachments(): Promise<void> {
  urlCache.clear();
  await tx("readwrite", (s) => s.clear()).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

type UrlEntry = { status: "loading" | "ready" | "missing"; url?: string };
const urlCache = new Map<string, UrlEntry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function requestUrl(path: string): UrlEntry {
  const hit = urlCache.get(path);
  if (hit) return hit;
  const entry: UrlEntry = { status: "loading" };
  urlCache.set(path, entry);
  loadAttachment(path)
    .then((blob) => {
      urlCache.set(
        path,
        blob ? { status: "ready", url: URL.createObjectURL(blob) } : { status: "missing" },
      );
    })
    .catch(() => urlCache.set(path, { status: "missing" }))
    .finally(emit);
  return entry;
}

/**
 * A displayable URL for an attachment path: undefined while loading, null when
 * the file is gone (e.g. storage was cleared). Object URLs are cached for the
 * session.
 */
export function useAttachmentUrl(path: string | null | undefined): string | null | undefined {
  const subscribe = useCallback((cb: () => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, []);
  const entry = useSyncExternalStore(
    subscribe,
    () => (path ? (urlCache.get(path) ?? null) : null),
    () => null,
  );
  useEffect(() => {
    if (path && !urlCache.has(path)) {
      requestUrl(path);
      emit();
    }
  }, [path]);
  if (!path) return null;
  if (!entry || entry.status === "loading") return undefined;
  return entry.status === "ready" ? entry.url : null;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const IMAGE_MAX_SIDE = 1600;
export const IMAGE_QUALITY = 0.8;

/** Fit (w, h) inside a max side, never upscaling. */
export function fitWithin(w: number, h: number, max = IMAGE_MAX_SIDE): [number, number] {
  const scale = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}

async function loadBitmap(
  file: Blob,
): Promise<{ source: CanvasImageSource; w: number; h: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, w: bmp.width, h: bmp.height };
    } catch {
      // Fall back to <img> (older Safari, HEIC via the browser decoder).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Compress a picked photo in the browser: longest side at most 1600px, JPEG
 * at quality 0.8 (EXIF orientation applied). Throws a friendly Error if the
 * file can't be read as an image.
 */
export async function compressImage(
  file: Blob,
): Promise<{ blob: Blob; width: number; height: number; mime: string }> {
  let bitmap: Awaited<ReturnType<typeof loadBitmap>>;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    throw new Error("That file couldn't be opened as a photo.");
  }
  const [width, height] = fitWithin(bitmap.w, bitmap.h);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't process photos.");
  ctx.fillStyle = "#fff"; // JPEG has no alpha: transparent PNGs get a white background.
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap.source, 0, 0, width, height);
  if ("close" in bitmap.source && typeof bitmap.source.close === "function") bitmap.source.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", IMAGE_QUALITY));
  if (!blob) throw new Error("The photo couldn't be compressed.");
  return { blob, width, height, mime: "image/jpeg" };
}

// ---------------------------------------------------------------------------
// Voice notes
// ---------------------------------------------------------------------------

/** Preferred recording formats: Opus in WebM/Ogg (Chrome, Firefox), AAC in MP4 (Safari/iOS). */
const RECORDER_MIMES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
  "audio/ogg;codecs=opus",
];

/** The first MIME type this browser can record, or "" to let it choose. */
export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  return RECORDER_MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export type RecorderStatus =
  "idle" | "requesting" | "recording" | "denied" | "unsupported" | "error";

export interface VoiceRecording {
  blob: Blob;
  mime: string;
  durationMs: number;
}

/** Longest voice note (recording stops on its own after this). */
export const MAX_VOICE_MS = 5 * 60 * 1000;

/**
 * Record a voice note with MediaRecorder. `start()` asks for the microphone
 * (status "denied" if refused, "unsupported" without MediaRecorder), `stop()`
 * resolves with the recording, `cancel()` discards it. Always releases the
 * microphone. Recording stops by itself at MAX_VOICE_MS and calls `onLimit`.
 */
export function useVoiceRecorder(opts: { onLimit?: (r: VoiceRecording | null) => void } = {}) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const rec = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    chunks: Blob[];
    startedAt: number;
    timer: number;
    mime: string;
  } | null>(null);
  const onLimit = useRef(opts.onLimit);
  onLimit.current = opts.onLimit;

  const release = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    window.clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
  }, []);

  const finish = useCallback(
    (keep: boolean): Promise<VoiceRecording | null> => {
      const r = rec.current;
      if (!r) return Promise.resolve(null);
      const durationMs = Date.now() - r.startedAt;
      return new Promise((resolve) => {
        const done = () => {
          const mime = (r.recorder.mimeType || r.mime || "audio/mp4").split(";")[0];
          const blob = new Blob(r.chunks, { type: mime });
          release();
          setStatus("idle");
          setElapsedMs(0);
          resolve(keep && blob.size > 0 ? { blob, mime, durationMs } : null);
        };
        if (r.recorder.state === "inactive") done();
        else {
          r.recorder.addEventListener("stop", done, { once: true });
          try {
            r.recorder.stop();
          } catch {
            done();
          }
        }
      });
    },
    [release],
  );

  const start = useCallback(async () => {
    if (rec.current) return;
    if (
      typeof MediaRecorder === "undefined" ||
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setStatus("unsupported");
      return;
    }
    setStatus("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      return;
    }
    const mime = pickRecorderMime();
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setStatus("unsupported");
      return;
    }
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    });
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsedMs(ms);
      if (ms >= MAX_VOICE_MS) void finish(true).then((r) => onLimit.current?.(r));
    }, 200);
    rec.current = { recorder, stream, chunks, startedAt, timer, mime };
    // A timeslice makes Safari deliver data reliably.
    recorder.start(250);
    setElapsedMs(0);
    setStatus("recording");
  }, [finish]);

  const stop = useCallback(() => finish(true), [finish]);
  const cancel = useCallback(() => void finish(false), [finish]);
  const reset = useCallback(() => setStatus("idle"), []);

  // Release the microphone if the component goes away mid-recording.
  useEffect(() => () => release(), [release]);

  return { status, elapsedMs, start, stop, cancel, reset };
}

// ---------------------------------------------------------------------------
// Waveforms
// ---------------------------------------------------------------------------

const peaksCache = new Map<string, number[]>();

type AudioCtor = typeof AudioContext;

/** Normalised peak per bar (0..1) from decoded audio data. */
export function peaksFromSamples(samples: Float32Array, bars: number): number[] {
  const out: number[] = [];
  const size = Math.max(1, Math.floor(samples.length / bars));
  let max = 0;
  for (let b = 0; b < bars; b++) {
    let peak = 0;
    const end = Math.min(samples.length, (b + 1) * size);
    for (let i = b * size; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    out.push(peak);
    if (peak > max) max = peak;
  }
  return max > 0 ? out.map((v) => v / max) : out;
}

async function decodePeaks(path: string, bars: number): Promise<number[] | null> {
  const blob = await loadAttachment(path);
  if (!blob) return null;
  const Ctor: AudioCtor | undefined =
    typeof window !== "undefined"
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext)
      : undefined;
  if (!Ctor) return null;
  const ctx = new Ctor();
  try {
    const buf = await new Promise<AudioBuffer>((resolve, reject) => {
      blob.arrayBuffer().then((ab) => {
        // Old Safari only supports the callback form.
        const p = ctx.decodeAudioData(ab, resolve, reject);
        if (p && typeof p.then === "function") p.then(resolve, reject);
      }, reject);
    });
    return peaksFromSamples(buf.getChannelData(0), bars);
  } catch {
    return null;
  } finally {
    void ctx.close?.();
  }
}

/**
 * Waveform bars drawn from the audio itself (decoded with Web Audio). Falls
 * back to a gentle placeholder when the browser can't decode the format.
 */
export function useWaveform(path: string | null | undefined, bars = 34): number[] {
  const key = `${path}|${bars}`;
  const [peaks, setPeaks] = useState<number[] | undefined>(() => peaksCache.get(key));
  useEffect(() => {
    if (!path) return;
    const hit = peaksCache.get(key);
    if (hit) {
      setPeaks(hit);
      return;
    }
    let alive = true;
    decodePeaks(path, bars).then((p) => {
      const value = p ?? placeholderPeaks(bars);
      peaksCache.set(key, value);
      if (alive) setPeaks(value);
    });
    return () => {
      alive = false;
    };
  }, [key, path, bars]);
  return peaks ?? placeholderPeaks(bars, 0.25);
}

function placeholderPeaks(bars: number, scale = 1): number[] {
  return Array.from({ length: bars }, (_, i) => scale * (0.35 + 0.3 * Math.abs(Math.sin(i / 2.3))));
}

// ---------------------------------------------------------------------------
// Seed media (synthesised; no binary files in the repo)
// ---------------------------------------------------------------------------

const seedCache = new Map<string, Blob>();

function synthSeedMedia(path: string): Blob | null {
  const hit = seedCache.get(path);
  if (hit) return hit;
  const [, kind, a, b] = path.split(":");
  let blob: Blob | null = null;
  if (kind === "voice") blob = synthVoiceWav(Number(a) || 5000, Number(b) || 1);
  if (kind === "image" && a === "route") {
    blob = new Blob([ROUTE_SVG], { type: "image/svg+xml" });
  }
  if (blob) seedCache.set(path, blob);
  return blob;
}

/** A hummed, speech-like voice note as 8 kHz 16-bit mono WAV. */
function synthVoiceWav(durationMs: number, seed: number): Blob {
  const rate = 8000;
  const n = Math.floor((durationMs / 1000) * rate);
  const data = new Int16Array(n);
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  let i = 0;
  while (i < n) {
    const syl = Math.floor(rate * (0.12 + rnd() * 0.22));
    const gap = rnd() < 0.18 ? Math.floor(rate * (0.25 + rnd() * 0.35)) : Math.floor(rate * 0.04);
    const f0 = 120 + rnd() * 90;
    const amp = 0.35 + rnd() * 0.5;
    for (let k = 0; k < syl && i < n; k++, i++) {
      const t = k / rate;
      const env = Math.sin((Math.PI * k) / syl) ** 1.5;
      const f = f0 * (1 + 0.08 * Math.sin(2 * Math.PI * 3 * t));
      const v =
        Math.sin(2 * Math.PI * f * t) +
        0.5 * Math.sin(4 * Math.PI * f * t) +
        0.25 * Math.sin(6 * Math.PI * f * t);
      data[i] = Math.round(v * env * amp * 9000);
    }
    i += gap;
  }
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, x: string) =>
    [...x].forEach((c, j) => v.setUint8(o + j, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  new Int16Array(buf, 44).set(data);
  return new Blob([buf], { type: "audio/wav" });
}

const ROUTE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800">
<rect width="1200" height="800" fill="#EAF3EE"/>
<g stroke="#FFFFFF" stroke-width="26" fill="none" stroke-linecap="round">
<path d="M-20 210 H1220"/><path d="M-20 560 H1220"/><path d="M300 -20 V820"/><path d="M860 -20 V820"/>
<path d="M-20 760 L1220 60"/></g>
<rect x="420" y="300" width="280" height="160" rx="18" fill="#D6EBDD"/>
<path d="M220 140 C 420 160, 520 330, 640 420 S 900 640, 980 690" stroke="#067781" stroke-width="14" fill="none" stroke-linecap="round" stroke-dasharray="2 26"/>
<circle cx="220" cy="140" r="26" fill="#1A365D"/><circle cx="980" cy="690" r="26" fill="#F2A93B"/>
<g font-family="system-ui, sans-serif" font-weight="700" font-size="44" fill="#13243D">
<text x="262" y="126">Plano</text><text x="690" y="740">Dallas · Fall Weekend</text></g>
</svg>`;
