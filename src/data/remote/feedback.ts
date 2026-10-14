/**
 * What the person sees when a save fails ("supabase" mode): one toast (never
 * a pile of them), and a reconcile with the server shortly after so the
 * screen shows what was really saved.
 */
import { toast } from "sonner";

export const SAVE_FAILED = "Couldn't save — check your connection and try again";

let reconcile: () => void = () => undefined;

/** Registered by the sync layer (src/data/remote/index.ts). */
export function setReconcile(fn: () => void): void {
  reconcile = fn;
}

/** A write or RPC failed: tell the person and re-sync. */
export function saveFailed(error?: unknown): void {
  if (error) console.warn("[sync]", error);
  toast.error(SAVE_FAILED, { id: "levelup-save-failed" });
  reconcile();
}
