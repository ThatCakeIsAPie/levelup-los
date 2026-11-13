/**
 * The team's pictures in the browser-storage demo (there is no server): blobs in
 * IndexedDB `<prefix>-team-look`, keyed by the same path a real bucket would use.
 * `forgetLocalLook()` deletes the database ("Reset demo data"). Nothing here runs
 * with real accounts.
 */
import { dbName } from "@/lib/brand";
import { isLookPath } from "./rules";

const DB_NAME = dbName("team-look");
const STORE = "files";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const db = req.result;
      // Let a delete (the demo reset) go through instead of waiting on this tab.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
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
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error ?? new Error("IndexedDB request failed"));
        t.onabort = () => reject(t.error ?? new Error("IndexedDB request aborted"));
      }),
  );
}

export async function saveLocalFile(path: string, blob: Blob): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put(blob, path));
  } catch {
    throw new Error("This browser has no room left to save the picture.");
  }
}

export async function readLocalFile(path: string): Promise<Blob | null> {
  try {
    const v = await tx<unknown>("readonly", (s) => s.get(path));
    return v instanceof Blob ? v : null;
  } catch {
    return null;
  }
}

export async function deleteLocalFiles(paths: string[]): Promise<void> {
  for (const p of paths) await tx("readwrite", (s) => s.delete(p)).catch(() => undefined);
}

const urls = new Map<string, Promise<string | null>>();

/** A `blob:` URL for a stored picture of this page (null when it is gone). Cached per path. */
export function localObjectUrl(path: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{1,64}\/(bg|logo)-[0-9a-f]{32}\.(webp|jpg|png)$/.test(path)) {
    return Promise.resolve(null);
  }
  let url = urls.get(path);
  if (!url) {
    url = readLocalFile(path).then((b) => (b ? URL.createObjectURL(b) : null));
    urls.set(path, url);
  }
  return url;
}

/** Forget a path's cached URL (after its file was removed). */
export function releaseLocalUrl(path: string): void {
  void urls.get(path)?.then((u) => (u ? URL.revokeObjectURL(u) : undefined));
  urls.delete(path);
}

/** Delete the demo's pictures (the demo reset calls this). */
export function forgetLocalLook(): void {
  urls.clear();
  try {
    dbPromise?.then((db) => db.close()).catch(() => undefined);
    dbPromise = null;
    indexedDB.deleteDatabase(DB_NAME);
  } catch {
    // Nothing to forget.
  }
}

/** True when `path` is a file this demo may hold (used before reading). */
export const isLocalLookPath = (path: string, workspaceId: string) =>
  isLookPath(path, workspaceId, "bg") || isLookPath(path, workspaceId, "logo");
