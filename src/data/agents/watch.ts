/**
 * Watch for something to appear, for as long as a dialog is open: call `check` every `intervalMs`
 * (never two at once) until it finds something, `maxMs` have passed, or the returned function is
 * called. Used by the Add agent dialog to notice the agent that just connected.
 */

/** How often the dialog looks for the new connection, and how long it keeps looking. */
export const WATCH_INTERVAL_MS = 3000;
export const WATCH_MAX_MS = 10 * 60 * 1000;

export interface WatchOptions<T> {
  /** Resolves a value when found, null otherwise. A rejection counts as "not yet". */
  check: () => Promise<T | null>;
  onFound: (found: T) => void;
  intervalMs?: number;
  maxMs?: number;
}

/** Starts watching; returns the function that stops it (safe to call twice, and after it ended). */
export function watchFor<T>({
  check,
  onFound,
  intervalMs = WATCH_INTERVAL_MS,
  maxMs = WATCH_MAX_MS,
}: WatchOptions<T>): () => void {
  const deadline = Date.now() + maxMs;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const tick = async () => {
    timer = undefined;
    if (stopped) return;
    let found: T | null = null;
    try {
      found = await check();
    } catch {
      found = null;
    }
    if (stopped) return;
    if (found !== null) {
      stop();
      onFound(found);
      return;
    }
    if (Date.now() + intervalMs > deadline) {
      stop();
      return;
    }
    timer = setTimeout(tick, intervalMs);
  };

  timer = setTimeout(tick, intervalMs);
  return stop;
}
