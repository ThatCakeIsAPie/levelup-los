/**
 * Feedback in the browser-storage demo (there is no server): the reports are
 * one JSON list under `<prefix>.feedback` in localStorage (so "Reset demo data",
 * which wipes every `<prefix>.*` key, clears them), and the snapshots are blobs
 * in IndexedDB `<prefix>-feedback` (deleted by `forgetLocalFeedback`, which the
 * reset calls). Nothing here runs with real accounts.
 */
import { dbName, storageKey } from "@/lib/brand";
import { newestFirst } from "./rules";
import { type FeedbackReport, type FeedbackStatus } from "./types";

const KEY = storageKey("feedback");
const DB_NAME = dbName("feedback");
const STORE = "images";
/** `screenshotPath` of a report whose snapshot is in IndexedDB under its id. */
export const LOCAL_IMAGE = "idb";

function readReports(): FeedbackReport[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as FeedbackReport[]) : [];
  } catch {
    return [];
  }
}

function writeReports(reports: FeedbackReport[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(reports));
  } catch {
    throw new Error("This browser has no room left to save the report.");
  }
}

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

/** Save a report (and its snapshot, when it has one) in this browser. */
export async function saveLocalReport(report: FeedbackReport, image: Blob | null): Promise<void> {
  if (image) {
    try {
      await tx("readwrite", (s) => s.put(image, report.id));
    } catch {
      throw new Error("This browser could not store the screenshot. Remove it and try again.");
    }
  }
  writeReports([{ ...report, screenshotPath: image ? LOCAL_IMAGE : null }, ...readReports()]);
}

export function listLocalReports(limit: number): FeedbackReport[] {
  return newestFirst(readReports()).slice(0, limit);
}

export function setLocalStatus(id: string, status: FeedbackStatus): void {
  writeReports(readReports().map((r) => (r.id === id ? { ...r, status } : r)));
}

export async function loadLocalImage(id: string): Promise<Blob | null> {
  try {
    const v = await tx<unknown>("readonly", (s) => s.get(id));
    return v instanceof Blob ? v : null;
  } catch {
    return null;
  }
}

/** Delete the saved snapshots (the demo reset; the reports go with the localStorage keys). */
export function forgetLocalFeedback(): void {
  if (typeof indexedDB === "undefined") return;
  try {
    indexedDB.deleteDatabase(DB_NAME);
  } catch {
    // Nothing to forget.
  }
}
