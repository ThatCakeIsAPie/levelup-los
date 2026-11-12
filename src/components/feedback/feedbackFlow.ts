/**
 * The Feedback flow's state, shared by the sidebar button, the phone More sheet
 * and the one <FeedbackDialog /> the shell renders (the same way `openLog`
 * drives the Log sheet).
 *
 * `startFeedback()` takes the snapshot FIRST, while the page is still on
 * screen, and only then opens the dialog, so the dialog is not in the picture.
 * A failed or slow capture (over ~4 seconds) opens the dialog without one.
 */
import { useSyncExternalStore } from "react";
import { appPath } from "@/components/shell/nav";
import { captureSnapshot, collectFeedbackContext, type FeedbackContext } from "@/data";

export type FeedbackFlow =
  | { phase: "idle" }
  | { phase: "capturing" }
  | { phase: "open"; id: string; context: FeedbackContext; image: Blob | null };

let flow: FeedbackFlow = { phase: "idle" };
const listeners = new Set<() => void>();

function set(next: FeedbackFlow): void {
  flow = next;
  listeners.forEach((l) => l());
}

export function useFeedbackFlow(): FeedbackFlow {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => flow,
    () => flow,
  );
}

/** Two animation frames: lets a closing sheet or menu leave the page before the capture. */
const settle = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

/** Wait (at most `ms`) until no modal dialog, sheet or menu is on screen. */
async function untilOverlaysGone(ms = 800): Promise<void> {
  const start = Date.now();
  const overlay = '[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]';
  while (document.querySelector(overlay) && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 40));
  }
  await settle();
}

/**
 * Snapshot the page, then open the dialog. `closeFirst` closes whatever is open
 * on top of the page (the phone More sheet) so it is not in the picture.
 */
export async function startFeedback(closeFirst?: () => void): Promise<void> {
  if (flow.phase !== "idle") return;
  set({ phase: "capturing" });
  try {
    closeFirst?.();
    await untilOverlaysGone();
    const context = collectFeedbackContext(appPath(window.location.pathname));
    const image = await captureSnapshot();
    set({ phase: "open", id: crypto.randomUUID(), context, image });
  } catch {
    set({ phase: "idle" });
  }
}

export function closeFeedback(): void {
  set({ phase: "idle" });
}
