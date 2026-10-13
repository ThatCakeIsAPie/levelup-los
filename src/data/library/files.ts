/**
 * Library files. The storage abstraction is two calls:
 *
 *   saveLibraryFile(blob, itemId) -> Promise<storagePath>
 *   useLibraryFileUrl(path)       -> a URL the browser can play/show
 *                                    (undefined while loading, null when missing)
 *
 * Two implementations behind the same calls:
 *  - Browser-storage demo: blobs live in IndexedDB (database
 *    "levelup-library-media", store "files"; paths look like "idb:<uuid>"),
 *    separate from chat media.
 *  - Real accounts ("supabase" mode): files are uploaded to the private
 *    `library` bucket as "<workspace_id>/<item_id>/<uuid>.<ext>" (before the
 *    item row is written) and read through signed URLs (one hour, renewed a
 *    minute early). The uploader's copy shows from memory at once.
 * Seed media is generated on demand from its path in both modes, so the repo
 * holds no binary files:
 *   seed:audio:<seconds>:<n>                 hummed, speech-like WAV of that length
 *   seed:video:<seconds>:<n>                 the same audio (played in a <video>)
 *   seed:pdf:<pages>:<p|l>:<encoded title>   a small PDF (portrait doc / landscape slides)
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { IS_SUPABASE } from "@/lib/config";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/sessionStore";
import { WORKSPACE_ID } from "@/data/chat/types";
import {
  SIGNED_URL_TTL,
  librarySignedUrl,
  removeLibraryMedia,
  uploadLibraryMedia,
} from "@/data/remote/storage";

/** The workspace new library rows and files belong to. */
export const libraryWorkspaceId = () =>
  (IS_SUPABASE ? useSessionStore.getState().account?.workspaceId : undefined) ?? WORKSPACE_ID;

/** A path in the `library` bucket (real accounts), not seed / IndexedDB. */
const isStoragePath = (path: string) => IS_SUPABASE && !!path && !/^(seed|idb):/.test(path);
/** Files uploaded in this tab (shown from memory, no download). */
const localBlobs = new Map<string, Blob>();

const DB_NAME = "levelup-library-media";
const STORE = "files";

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

/**
 * Store an uploaded file for an item and return the path to keep in
 * `CatalogItem.storagePath` (real accounts: uploads it to the `library` bucket).
 */
export async function saveLibraryFile(blob: Blob, itemId: string): Promise<string> {
  if (IS_SUPABASE) {
    if (!supabase) throw new Error("Not connected.");
    const path = await uploadLibraryMedia(supabase, libraryWorkspaceId(), itemId, blob);
    localBlobs.set(path, blob);
    urlCache.set(path, { status: "ready", url: URL.createObjectURL(blob) });
    emit();
    return path;
  }
  const key = crypto.randomUUID();
  await tx("readwrite", (s) => s.put(blob, key));
  return `idb:${key}`;
}

/** Read a stored file (null when missing). Seed paths are generated. */
export async function loadLibraryFile(path: string): Promise<Blob | null> {
  if (path.startsWith("seed:")) return synthSeedFile(path);
  const local = localBlobs.get(path);
  if (local) return local;
  if (isStoragePath(path)) {
    if (!supabase) return null;
    const { data, error } = await supabase.storage.from("library").download(path);
    return error ? null : data;
  }
  if (!path.startsWith("idb:")) return null;
  const v = await tx<unknown>("readonly", (s) => s.get(path.slice(4)));
  return v instanceof Blob ? v : null;
}

/** Remove a stored file (no-op for seed paths). */
export async function deleteLibraryFile(path: string | null | undefined): Promise<void> {
  if (!path) return;
  forget(path);
  localBlobs.delete(path);
  if (isStoragePath(path)) {
    if (supabase) await removeLibraryMedia(supabase, path);
    return;
  }
  if (!path.startsWith("idb:")) return;
  await tx("readwrite", (s) => s.delete(path.slice(4))).catch(() => undefined);
}

/** Wipe every stored file (when the demo data is re-seeded). */
export async function clearLibraryFiles(): Promise<void> {
  for (const p of [...urlCache.keys()]) forget(p);
  await tx("readwrite", (s) => s.clear()).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/** `expiresAt` (ms): signed URLs are renewed shortly before it. */
type UrlEntry = { status: "loading" | "ready" | "missing"; url?: string; expiresAt?: number };
const urlCache = new Map<string, UrlEntry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
/** Generated media can be big (a 45 min talk is ~20 MB): keep only a few. */
const MAX_GENERATED = 3;
const generatedOrder: string[] = [];

function forget(path: string) {
  const hit = urlCache.get(path);
  if (hit?.url?.startsWith("blob:")) URL.revokeObjectURL(hit.url);
  urlCache.delete(path);
}

function requestUrl(path: string) {
  urlCache.set(path, { status: "loading" });
  if (isStoragePath(path) && !localBlobs.has(path)) {
    const signed = supabase ? librarySignedUrl(supabase, path) : Promise.resolve(null);
    signed
      .then((url) =>
        urlCache.set(
          path,
          url
            ? { status: "ready", url, expiresAt: Date.now() + SIGNED_URL_TTL * 1000 }
            : { status: "missing" },
        ),
      )
      .catch(() => urlCache.set(path, { status: "missing" }))
      .finally(emit);
    return;
  }
  // Let the "loading" state render before a long synthesis blocks the thread.
  setTimeout(() => {
    loadLibraryFile(path)
      .then((blob) => {
        urlCache.set(
          path,
          blob ? { status: "ready", url: URL.createObjectURL(blob) } : { status: "missing" },
        );
        if (blob && path.startsWith("seed:") && !path.startsWith("seed:pdf:")) {
          generatedOrder.push(path);
          while (generatedOrder.length > MAX_GENERATED) {
            const old = generatedOrder.shift()!;
            if (old !== path) forget(old);
          }
        }
      })
      .catch(() => urlCache.set(path, { status: "missing" }))
      .finally(emit);
  }, 0);
}

/**
 * A playable/displayable URL for a library file path: undefined while
 * loading, null when the file is gone (e.g. browser storage was cleared).
 */
export function useLibraryFileUrl(path: string | null | undefined): string | null | undefined {
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
    if (!path) return;
    const hit = urlCache.get(path);
    // Signed URLs are renewed a minute before they expire.
    if (hit?.expiresAt && hit.expiresAt - Date.now() < 60_000) urlCache.delete(path);
    if (!urlCache.has(path)) {
      requestUrl(path);
      emit();
    }
  }, [path, entry]);
  if (!path) return null;
  if (!entry || entry.status === "loading") return undefined;
  return entry.status === "ready" ? entry.url : null;
}

// ---------------------------------------------------------------------------
// Seed media (generated)
// ---------------------------------------------------------------------------

function synthSeedFile(path: string): Blob | null {
  const [, kind, a, b, ...rest] = path.split(":");
  if (kind === "audio" || kind === "video") return synthTalkWav(Number(a) || 60, Number(b) || 1);
  if (kind === "pdf") {
    const title = decodeURIComponent(rest.join(":") || "Document");
    return makePdf(title, Math.max(1, Number(a) || 1), b === "l");
  }
  return null;
}

/**
 * A hummed, speech-like talk as 8 kHz 8-bit mono WAV (8 KB per second), at the
 * item's real length so saved positions and "minutes left" line up. A 20 s
 * pattern is synthesised once and tiled, so even an hour takes a moment.
 */
export function synthTalkWav(durationSec: number, seed: number): Blob {
  const rate = 8000;
  const n = Math.max(rate, Math.floor(durationSec * rate));
  const patLen = Math.min(n, rate * 20);
  const pat = new Uint8Array(patLen).fill(128);
  let s = (seed * 7919) % 233280;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  let i = 0;
  while (i < patLen) {
    const syl = Math.floor(rate * (0.12 + rnd() * 0.22));
    const gap = rnd() < 0.18 ? Math.floor(rate * (0.25 + rnd() * 0.35)) : Math.floor(rate * 0.04);
    const f0 = 110 + rnd() * 90;
    const amp = 0.25 + rnd() * 0.35;
    for (let k = 0; k < syl && i < patLen; k++, i++) {
      const t = k / rate;
      const env = Math.sin((Math.PI * k) / syl) ** 1.5;
      const f = f0 * (1 + 0.08 * Math.sin(2 * Math.PI * 3 * t));
      const v =
        Math.sin(2 * Math.PI * f * t) +
        0.5 * Math.sin(4 * Math.PI * f * t) +
        0.25 * Math.sin(6 * Math.PI * f * t);
      pat[i] = 128 + Math.round(v * env * amp * 60);
    }
    i += gap;
  }
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o: number, x: string) =>
    [...x].forEach((c, j) => v.setUint8(o + j, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true); // byte rate
  v.setUint16(32, 1, true); // block align
  v.setUint16(34, 8, true); // bits
  str(36, "data");
  v.setUint32(40, n, true);
  const data = new Uint8Array(buf, 44);
  for (let o = 0; o < n; o += patLen) data.set(pat.subarray(0, Math.min(patLen, n - o)), o);
  return new Blob([buf], { type: "audio/wav" });
}

/** PDF text: ASCII only, with (, ) and \ escaped. */
const pdfText = (s: string) => s.replace(/[^\x20-\x7e]/g, "-").replace(/[\\()]/g, (c) => `\\${c}`);

/**
 * A small multi-page PDF: a title page, then numbered placeholder pages
 * (landscape 16:9 for slides, US Letter for documents).
 */
export function makePdf(title: string, pages: number, landscape: boolean): Blob {
  const [W, H] = landscape ? [960, 540] : [612, 792];
  const objs: string[] = [];
  // 1 catalog, 2 pages, 3 font regular, 4 font bold; then per page: page + content.
  const pageIds = Array.from({ length: pages }, (_, i) => 5 + i * 2);
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  const t = pdfText(title);
  for (let p = 0; p < pages; p++) {
    const lines: string[] = [];
    // Teal band along the top, navy footer text.
    lines.push("0.024 0.467 0.506 rg", `0 ${H - 18} ${W} 18 re f`);
    if (p === 0) {
      lines.push(
        "0.102 0.212 0.365 rg",
        `BT /F2 ${landscape ? 40 : 28} Tf 60 ${H / 2 + 30} Td (${t}) Tj ET`,
        "0.36 0.41 0.48 rg",
        `BT /F1 16 Tf 60 ${H / 2 - 10} Td (LevelUp LOS library - demo ${landscape ? "slides" : "document"}) Tj ET`,
      );
    } else {
      lines.push(
        "0.102 0.212 0.365 rg",
        `BT /F2 ${landscape ? 30 : 20} Tf 60 ${H - 90} Td (${landscape ? "Slide" : "Page"} ${p + 1}) Tj ET`,
        "0.36 0.41 0.48 rg",
      );
      const rows = landscape ? 5 : 14;
      for (let r = 0; r < rows; r++) {
        const y = H - 150 - r * (landscape ? 56 : 40);
        const w = (W - 160) * (0.55 + 0.4 * Math.abs(Math.sin(p * 3 + r)));
        lines.push(`0.89 0.87 0.84 rg 60 ${y} ${Math.round(w)} ${landscape ? 18 : 12} re f`);
      }
    }
    lines.push("0.53 0.57 0.63 rg", `BT /F1 10 Tf 60 30 Td (${t} - ${p + 1} of ${pages}) Tj ET`);
    const stream = lines.join("\n");
    objs[pageIds[p]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[p] + 1} 0 R >>`;
    objs[pageIds[p] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++)
    out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([out], { type: "application/pdf" });
}

/**
 * Poster for generated demo videos (their media is audio only): a title card,
 * so the video box doesn't sit black. Real uploads show their own frames.
 */
export function demoVideoPoster(path: string | null, title: string): string | null {
  if (!path?.startsWith("seed:video:")) return null;
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1A365D"/><stop offset="1" stop-color="#067781"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="1080" cy="150" r="260" fill="#199BD7" opacity=".18"/><rect x="96" y="96" width="14" height="72" rx="4" fill="#F2A93B"/><rect x="122" y="120" width="14" height="48" rx="4" fill="#199BD7"/><rect x="148" y="140" width="14" height="28" rx="4" fill="#fff"/><text x="96" y="420" font-family="system-ui,sans-serif" font-size="64" font-weight="800" fill="#fff">${esc(title.slice(0, 34))}</text><text x="96" y="480" font-family="system-ui,sans-serif" font-size="30" fill="#BFCDE0">LevelUp LOS library · demo video</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
