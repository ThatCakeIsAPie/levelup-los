/**
 * Which view of the events page a person sees: the calendar or the list.
 *
 * The page's `?view=` says it when it is there (a shared link shows what its sender meant). Without
 * it the person's last choice (kept in this browser) applies; with neither, the calendar on a
 * desktop-width screen and the list below it.
 */
import { storageKey } from "@/lib/brand";

export const EVENT_VIEWS = ["calendar", "list"] as const;
export type EventsView = (typeof EVENT_VIEWS)[number];

/** The view a `?view=` value (or a stored one) names; undefined when it is anything else. */
export const parseView = (raw: unknown): EventsView | undefined =>
  EVENT_VIEWS.find((v) => v === raw);

/** The slice of `Storage` this needs (so a test can hand in a plain object). */
export interface ViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const key = () => storageKey("events-view");

const browserStorage = (): ViewStorage | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

/** The view this person chose last, if any. */
export function readStoredView(
  storage: ViewStorage | undefined = browserStorage(),
): EventsView | undefined {
  try {
    return parseView(storage?.getItem(key()));
  } catch {
    return undefined;
  }
}

/** Remembers the person's choice (private browsing may refuse; then it is simply not remembered). */
export function storeView(
  view: EventsView,
  storage: ViewStorage | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(key(), view);
  } catch {
    // not remembered
  }
}

/** The link's view, else the remembered one, else the default for the screen. */
export function resolveView(opts: {
  url: EventsView | undefined;
  stored: EventsView | undefined;
  desktop: boolean;
}): EventsView {
  return opts.url ?? opts.stored ?? (opts.desktop ? "calendar" : "list");
}
