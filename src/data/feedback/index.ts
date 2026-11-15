/**
 * Feedback public API (re-exported from "@/data").
 *
 * - `collectFeedbackContext()` and `captureSnapshot()` are what the sidebar
 *   button gathers before the dialog opens.
 * - `sendFeedback()` saves a report: in the database with real accounts, in this
 *   browser in the demo (`FEEDBACK_LOCAL_ONLY` says which).
 * - `useFeedbackReports()`, `setFeedbackStatus()` and `useFeedbackImageUrl()` are
 *   the admin page's (Settings > Feedback).
 */
import { useCallback, useEffect, useState } from "react";
import { brand } from "@/brand/brand";
import { IS_SUPABASE } from "@/lib/config";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/sessionStore";
import { buildFeedbackContext, nextStatus, pageLabel, safeSearch } from "./rules";
import { listRemoteReports, remoteImageUrl, sendRemoteReport, setRemoteStatus } from "./remote";
import { listLocalReports, loadLocalImage, saveLocalReport, setLocalStatus } from "./localStore";
import {
  FEEDBACK_LIST_LIMIT,
  type FeedbackContext,
  type FeedbackReport,
  type FeedbackStatus,
} from "./types";

export * from "./types";
export { feedbackMessageError, nextStatus } from "./rules";
export { captureSnapshot } from "./capture";
export { FEEDBACK_GITHUB_REPO, buildIssueUrl } from "./github";

/** True in the demo: reports stay in this browser because there is no server. */
export const FEEDBACK_LOCAL_ONLY = !IS_SUPABASE;

/**
 * Where the person is and what they use, read when they press Feedback.
 * `path` is the page's path inside the app (without the deploy base).
 */
export function collectFeedbackContext(path: string): FeedbackContext {
  return buildFeedbackContext({
    path,
    search: safeSearch(window.location.search),
    // Not document.title: on a person or chat page that holds their name.
    title: pageLabel(path),
    width: window.innerWidth,
    height: window.innerHeight,
    dark: document.documentElement.classList.contains("dark"),
    userAgent: navigator.userAgent,
    brandSlug: brand.slug,
    appVersion: __APP_VERSION__,
    now: new Date(),
    senderName: useSessionStore.getState().user?.name ?? "",
  });
}

/**
 * Send a report as the signed-in person. `id` stays the same across retries of
 * one report. Rejects with a readable message when it could not be saved.
 */
export async function sendFeedback(input: {
  id: string;
  message: string;
  context: FeedbackContext;
  image: Blob | null;
}): Promise<void> {
  const session = useSessionStore.getState();
  const user = session.user;
  if (!user) throw new Error("Sign in to send feedback.");
  if (IS_SUPABASE) {
    const workspaceId = session.account?.workspaceId;
    if (!supabase || !workspaceId) throw new Error("Not connected.");
    await sendRemoteReport(supabase, { ...input, workspaceId });
    return;
  }
  await saveLocalReport(
    {
      id: input.id,
      message: input.message.trim(),
      senderId: user.personId,
      senderName: user.name,
      context: input.context,
      screenshotPath: null,
      status: "new",
      createdAt: new Date().toISOString(),
    },
    input.image,
  );
}

async function loadReports(): Promise<FeedbackReport[]> {
  if (IS_SUPABASE) {
    if (!supabase) return [];
    return listRemoteReports(supabase, FEEDBACK_LIST_LIMIT);
  }
  return listLocalReports(FEEDBACK_LIST_LIMIT);
}

/** The newest reports for the admin page (loaded once; `reload` after a change). */
export function useFeedbackReports(enabled: boolean) {
  const [state, setState] = useState<{
    reports: FeedbackReport[];
    loading: boolean;
    error: string | null;
  }>({ reports: [], loading: enabled, error: null });
  const reload = useCallback(async () => {
    try {
      setState({ reports: await loadReports(), loading: false, error: null });
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Couldn't load the reports.",
      }));
    }
  }, []);
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);
  return { ...state, reload };
}

/** Mark a report Done, or reopen it. */
export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<void> {
  if (IS_SUPABASE) {
    if (!supabase) throw new Error("Not connected.");
    await setRemoteStatus(supabase, id, status);
    return;
  }
  setLocalStatus(id, status);
}

/** A URL for a report's snapshot: undefined while loading, null when there is none. */
export function useFeedbackImageUrl(report: FeedbackReport): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(
    report.screenshotPath ? undefined : null,
  );
  useEffect(() => {
    if (!report.screenshotPath) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const load = async () => {
      let next: string | null = null;
      try {
        if (IS_SUPABASE) {
          next = supabase ? await remoteImageUrl(supabase, report.screenshotPath as string) : null;
        } else {
          const blob = await loadLocalImage(report.id);
          next = objectUrl = blob ? URL.createObjectURL(blob) : null;
        }
      } catch {
        next = null;
      }
      if (cancelled) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      setUrl(next);
    };
    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [report.id, report.screenshotPath]);
  return url;
}
