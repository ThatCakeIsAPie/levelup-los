/** Pure rules for feedback: message checks, the saved context, row mapping, image fitting. */
import {
  FEEDBACK_MAX_LENGTH,
  SNAPSHOT_MAX_BYTES,
  type FeedbackContext,
  type FeedbackReport,
  type FeedbackStatus,
} from "./types";

/** Why a message can't be sent yet (null when it can). */
export function feedbackMessageError(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "Write what you would like changed.";
  if (trimmed.length > FEEDBACK_MAX_LENGTH)
    return `Keep it to ${FEEDBACK_MAX_LENGTH} characters or fewer.`;
  return null;
}

export interface ContextEnv {
  /** `location.pathname` with the deploy base already removed, and `location.search`. */
  path: string;
  search: string;
  title: string;
  width: number;
  height: number;
  dark: boolean;
  userAgent: string;
  brandSlug: string;
  appVersion: string;
  now: Date;
  senderName: string;
}

export function buildFeedbackContext(env: ContextEnv): FeedbackContext {
  return {
    path: env.path,
    search: env.search,
    title: env.title,
    viewport: { width: Math.round(env.width), height: Math.round(env.height) },
    theme: env.dark ? "dark" : "light",
    userAgent: env.userAgent,
    brand: env.brandSlug,
    appVersion: env.appVersion,
    clientTime: env.now.toISOString(),
    senderName: env.senderName,
  };
}

/** The database row of a report, as `select` returns it. */
export interface FeedbackRow {
  id: string;
  message: string;
  person_id: string | null;
  context: unknown;
  screenshot_path: string | null;
  status: string;
  created_at: string;
}

export function reportFromRow(row: FeedbackRow): FeedbackReport {
  const context =
    row.context && typeof row.context === "object" && !Array.isArray(row.context)
      ? (row.context as Partial<FeedbackContext>)
      : {};
  return {
    id: row.id,
    message: row.message,
    senderId: row.person_id,
    senderName:
      typeof context.senderName === "string" && context.senderName ? context.senderName : "Unknown",
    context,
    screenshotPath: row.screenshot_path,
    status: row.status === "done" ? "done" : "new",
    createdAt: row.created_at,
  };
}

export const nextStatus = (s: FeedbackStatus): FeedbackStatus => (s === "done" ? "new" : "done");

/** Newest first. */
export function newestFirst(reports: FeedbackReport[]): FeedbackReport[] {
  return [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Encode attempts, best first: full size at falling JPEG quality, then smaller
 * scales. `encode` returns null when the browser can't encode.
 */
export const ENCODE_STEPS: { scale: number; quality: number }[] = [
  { scale: 1, quality: 0.82 },
  { scale: 1, quality: 0.65 },
  { scale: 1, quality: 0.5 },
  { scale: 0.75, quality: 0.6 },
  { scale: 0.75, quality: 0.45 },
  { scale: 0.5, quality: 0.5 },
  { scale: 0.35, quality: 0.4 },
];

/** The first encoding that fits `maxBytes` (the smallest attempt when none does is dropped: null). */
export async function fitImage(
  encode: (scale: number, quality: number) => Promise<Blob | null>,
  maxBytes: number = SNAPSHOT_MAX_BYTES,
): Promise<Blob | null> {
  for (const step of ENCODE_STEPS) {
    const blob = await encode(step.scale, step.quality);
    if (!blob) return null;
    if (blob.size <= maxBytes) return blob;
  }
  return null;
}
