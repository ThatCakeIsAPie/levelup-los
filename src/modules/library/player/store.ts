/**
 * Global library player state (one player for the whole app, mounted once by
 * <LibraryPlayer> in the app shell). Not persisted: progress is saved in the
 * library store, so a reload resumes from the saved position.
 *
 * The media element itself lives in LibraryPlayer; the functions below drive
 * it through `controller`, which LibraryPlayer registers on mount.
 */
import { create } from "zustand";
import { storageKey } from "@/lib/config";

export const SPEEDS = [1, 1.25, 1.5, 2] as const;
const RATE_KEY = storageKey("libraryRate");

function savedRate(): number {
  try {
    const r = Number(localStorage.getItem(RATE_KEY));
    return (SPEEDS as readonly number[]).includes(r) ? r : 1;
  } catch {
    return 1;
  }
}

export interface PlayerState {
  /** The catalog item loaded in the player (null = closed). */
  itemId: string | null;
  /** The channel it was started from (drives "Up next" and auto-advance). */
  channelId: string | null;
  /** Wants to play (the element follows). */
  playing: boolean;
  status: "idle" | "loading" | "ready" | "error";
  position: number;
  duration: number;
  rate: number;
  /** Phone: the full-screen player is open. */
  expanded: boolean;
}

export const usePlayerStore = create<PlayerState>()(() => ({
  itemId: null,
  channelId: null,
  playing: false,
  status: "idle",
  position: 0,
  duration: 0,
  rate: typeof localStorage === "undefined" ? 1 : savedRate(),
  expanded: false,
}));

/** What LibraryPlayer exposes to the commands below. */
export interface PlayerController {
  play: () => void;
  pause: () => void;
  seekTo: (sec: number) => void;
  setRate: (r: number) => void;
  /** Save the current position now (before switching items or closing). */
  flush: () => void;
}

let controller: PlayerController | null = null;
export function registerController(c: PlayerController | null): void {
  controller = c;
}

/** Start (or resume) an audio/video item in the global player. */
export function playLibraryItem(
  itemId: string,
  opts: { channelId?: string | null; expand?: boolean } = {},
): void {
  const s = usePlayerStore.getState();
  if (s.itemId === itemId) {
    usePlayerStore.setState({
      playing: true,
      ...(opts.channelId !== undefined ? { channelId: opts.channelId } : {}),
      ...(opts.expand ? { expanded: true } : {}),
    });
    controller?.play();
    return;
  }
  controller?.flush();
  usePlayerStore.setState({
    itemId,
    channelId: opts.channelId ?? null,
    playing: true,
    status: "loading",
    position: 0,
    duration: 0,
    expanded: opts.expand ?? s.expanded,
  });
}

export function togglePlayback(): void {
  const s = usePlayerStore.getState();
  if (!s.itemId) return;
  if (s.playing) {
    usePlayerStore.setState({ playing: false });
    controller?.pause();
  } else {
    usePlayerStore.setState({ playing: true });
    controller?.play();
  }
}

export function pausePlayback(): void {
  usePlayerStore.setState({ playing: false });
  controller?.pause();
}

export function seekBy(delta: number): void {
  const s = usePlayerStore.getState();
  seekTo(s.position + delta);
}

export function seekTo(sec: number): void {
  const s = usePlayerStore.getState();
  const t = Math.max(0, Math.min(s.duration || Infinity, sec));
  usePlayerStore.setState({ position: t });
  controller?.seekTo(t);
}

export function setPlaybackRate(rate: number): void {
  usePlayerStore.setState({ rate });
  controller?.setRate(rate);
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    // ignore
  }
}

/** 1× → 1.25× → 1.5× → 2× → 1×. */
export function cycleRate(): void {
  const r = usePlayerStore.getState().rate;
  const i = SPEEDS.indexOf(r as (typeof SPEEDS)[number]);
  setPlaybackRate(SPEEDS[(i + 1) % SPEEDS.length]);
}

export function setPlayerExpanded(expanded: boolean): void {
  usePlayerStore.setState({ expanded });
}

/** Stop and hide the player (the position is saved). */
export function closePlayer(): void {
  controller?.flush();
  controller?.pause();
  usePlayerStore.setState({
    itemId: null,
    channelId: null,
    playing: false,
    status: "idle",
    position: 0,
    duration: 0,
    expanded: false,
  });
}

/** `${rate}×` with the multiplication sign ("1.25×"). */
export const rateLabel = (r: number) => `${r}×`;
