/**
 * In-app feedback: a signed-in person describes a change they want and the app
 * sends it with a snapshot of the page they were looking at. Reports live in
 * the `feedback` table and bucket (migration 20261016002500_feedback) with real
 * accounts, and in this browser in the demo (./localStore).
 */

/** Longest message, in characters (also a database check). */
export const FEEDBACK_MAX_LENGTH = 2000;
/** The snapshot image is kept under this many bytes. */
export const SNAPSHOT_MAX_BYTES = 400 * 1024;
/** Past this long the dialog opens without a snapshot. */
export const SNAPSHOT_TIMEOUT_MS = 4000;
/** The admin page lists this many of the newest reports. */
export const FEEDBACK_LIST_LIMIT = 100;

export type FeedbackStatus = "new" | "done";

/** Saved with every report (a JSON object in `feedback.context`). */
export interface FeedbackContext {
  /** Path inside the app (no deploy base), and the query string. */
  path: string;
  search: string;
  title: string;
  viewport: { width: number; height: number };
  theme: "light" | "dark";
  userAgent: string;
  /** `brand.slug`. */
  brand: string;
  /** Short git commit of the build, or "dev". */
  appVersion: string;
  /** When the sender pressed Feedback (client clock, ISO). */
  clientTime: string;
  /** The sender's name, so admins who can't see that person still know who wrote it. */
  senderName: string;
}

export interface FeedbackReport {
  id: string;
  message: string;
  /** The sender's person id (null once that person is deleted). */
  senderId: string | null;
  senderName: string;
  context: Partial<FeedbackContext>;
  /** The snapshot's storage path (real accounts) or "idb" (demo); null when there is none. */
  screenshotPath: string | null;
  status: FeedbackStatus;
  /** ISO timestamp. */
  createdAt: string;
}
