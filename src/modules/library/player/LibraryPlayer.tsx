/**
 * The app-wide library player, rendered once by the app shell (between the
 * page and the phone tab bar). It owns the single media element, follows the
 * player store, saves progress (every few seconds, on pause, on switching
 * items and when the tab is hidden), logs finished items to learning (via the
 * data layer) and auto-advances to the next lesson of the channel.
 *
 * Desktop: a persistent bar along the bottom (+ a small floating video).
 * Phone: a compact bar above the tab bar; tapping it opens the full-screen
 * player, which keeps playing while you move around the app.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Flame, Link2, Maximize2, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { useIsDesktop } from "@/components/brand";
import { cn } from "@/lib/utils";
import {
  demoVideoPoster,
  isPlayable,
  learningStreak,
  lengthLabel,
  remainingSec,
  resumePosition,
  saveLibraryPosition,
  speakerLine,
  formatMinutes,
  useCatalogItem,
  useCurrentUser,
  useItemProgress,
  useLearning,
  useLessonContext,
  useLibraryFileUrl,
  useLibraryPeople,
  type CatalogItem,
  type ProgressResult,
} from "@/data";
import { CHANNEL_COLOR_CLASS, KIND_ICON, KindIcon } from "../icons";
import { itemHref } from "../links";
import { ShareToChatDialog, useCanShareToChat } from "../ShareToChatDialog";
import {
  closePlayer,
  playLibraryItem,
  registerController,
  setPlayerExpanded,
  usePlayerStore,
} from "./store";
import { NextButton, PlayPauseButton, SeekBar, SkipButton, SpeedButton } from "./controls";
import { VideoSlot, attachMedia } from "./videoSlot";

/** Save at most this often while playing (seconds of playback). */
const SAVE_EVERY = 5;

function announce(item: CatalogItem, r: ProgressResult) {
  if (r.logged) {
    toast.success(`Finished "${item.title}"`, {
      description: "Logged to your learning. It counts toward your streak and weekly goal.",
    });
  }
}

export function LibraryPlayer() {
  const itemId = usePlayerStore((s) => s.itemId);
  const channelId = usePlayerStore((s) => s.channelId);
  const playing = usePlayerStore((s) => s.playing);
  const rate = usePlayerStore((s) => s.rate);
  const item = useCatalogItem(itemId ?? undefined);
  const progress = useItemProgress(itemId ?? undefined);
  const ctx = useLessonContext(itemId ?? undefined, channelId ?? undefined);
  const url = useLibraryFileUrl(item && isPlayable(item) ? item.storagePath : null);

  const [media] = useState<HTMLVideoElement | null>(() => {
    if (typeof document === "undefined") return null;
    const v = document.createElement("video");
    v.preload = "metadata";
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    return v;
  });
  const parkRef = useRef<HTMLDivElement>(null);

  // Latest values for the media event handlers.
  const live = useRef({ item, progress, ctx, playing, lastSaved: 0, loadedFor: "" });
  live.current.item = item;
  live.current.progress = progress;
  live.current.ctx = ctx;
  live.current.playing = playing;

  useEffect(() => {
    attachMedia(media, parkRef.current);
    return () => attachMedia(null, null);
  }, [media]);

  // The item disappeared (deleted, or no longer visible): close.
  useEffect(() => {
    if (itemId && item === undefined) {
      const t = setTimeout(() => {
        if (usePlayerStore.getState().itemId === itemId) closePlayer();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [itemId, item]);

  // Controller + media events (once).
  useEffect(() => {
    if (!media) return;
    const durationOf = () =>
      Number.isFinite(media.duration) && media.duration > 0
        ? media.duration
        : (live.current.item?.durationSec ?? 0);
    const save = () => {
      const it = live.current.item;
      if (!it || !media.src || live.current.loadedFor !== it.id) return;
      const t = media.currentTime;
      if (!(t > 0)) return;
      live.current.lastSaved = t;
      announce(it, saveLibraryPosition(it.id, t, durationOf()));
    };
    registerController({
      play: () => {
        if (media.src) media.play().catch(() => usePlayerStore.setState({ playing: false }));
      },
      pause: () => media.pause(),
      seekTo: (sec) => {
        if (media.src) media.currentTime = sec;
      },
      setRate: (r) => {
        media.playbackRate = r;
      },
      flush: save,
    });
    const onTime = () => {
      usePlayerStore.setState({ position: media.currentTime });
      if (Math.abs(media.currentTime - live.current.lastSaved) >= SAVE_EVERY) save();
    };
    const onMeta = () => {
      const it = live.current.item;
      if (!it) return;
      const start = resumePosition({ durationSec: durationOf() }, live.current.progress);
      if (start > 0) media.currentTime = start;
      live.current.lastSaved = start;
      media.playbackRate = usePlayerStore.getState().rate;
      usePlayerStore.setState({ status: "ready", duration: durationOf(), position: start });
      if (usePlayerStore.getState().playing)
        media.play().catch(() => usePlayerStore.setState({ playing: false }));
    };
    const onPause = () => {
      save();
      if (
        !media.ended &&
        usePlayerStore.getState().playing &&
        document.visibilityState === "visible"
      ) {
        // Paused from outside (headset button, OS controls).
        usePlayerStore.setState({ playing: false });
      }
    };
    const onPlay = () => usePlayerStore.setState({ playing: true });
    const onEnded = () => {
      const it = live.current.item;
      if (!it) return;
      const d = durationOf();
      announce(it, saveLibraryPosition(it.id, d, d));
      live.current.lastSaved = d;
      const { ctx: c } = live.current;
      const next = c.nextId ? c.channel?.items.find((i) => i.id === c.nextId) : undefined;
      if (next && isPlayable(next)) {
        playLibraryItem(next.id, { channelId: c.channel?.channel.id ?? null });
      } else {
        usePlayerStore.setState({ playing: false, position: d });
        if (next)
          toast(`Up next: ${next.title}`, {
            description: "Open it from the channel when you're ready.",
          });
      }
    };
    const onError = () => {
      if (media.src) usePlayerStore.setState({ status: "error", playing: false });
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    media.addEventListener("timeupdate", onTime);
    media.addEventListener("loadedmetadata", onMeta);
    media.addEventListener("pause", onPause);
    media.addEventListener("play", onPlay);
    media.addEventListener("ended", onEnded);
    media.addEventListener("error", onError);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      save();
      registerController(null);
      media.removeEventListener("timeupdate", onTime);
      media.removeEventListener("loadedmetadata", onMeta);
      media.removeEventListener("pause", onPause);
      media.removeEventListener("play", onPlay);
      media.removeEventListener("ended", onEnded);
      media.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
      media.pause();
    };
  }, [media]);

  // Load the item's file.
  useEffect(() => {
    if (!media) return;
    if (!itemId || url === null) {
      if (media.src) {
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
      live.current.loadedFor = "";
      if (itemId && url === null && item)
        usePlayerStore.setState({ status: "error", playing: false });
      return;
    }
    if (url === undefined) {
      usePlayerStore.setState({ status: "loading" });
      return;
    }
    if (live.current.loadedFor === itemId && media.src === url) return;
    live.current.loadedFor = itemId;
    live.current.lastSaved = 0;
    usePlayerStore.setState({ status: "loading", duration: item?.durationSec ?? 0 });
    const poster = item ? demoVideoPoster(item.storagePath, item.title) : null;
    if (poster) media.poster = poster;
    else media.removeAttribute("poster");
    media.src = url;
    media.load();
  }, [media, itemId, url, item]);

  useEffect(() => {
    if (media) media.playbackRate = rate;
  }, [media, rate]);

  return (
    <>
      <div ref={parkRef} className="hidden" aria-hidden="true" />
      {item && <PlayerChrome item={item} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bars and full-screen player
// ---------------------------------------------------------------------------

function usePlayerContext(item: CatalogItem) {
  const channelId = usePlayerStore((s) => s.channelId);
  const ctx = useLessonContext(item.id, channelId ?? undefined);
  const next = ctx.nextId ? ctx.channel?.items.find((i) => i.id === ctx.nextId) : undefined;
  const goNext = () => {
    if (!next) return;
    if (isPlayable(next)) playLibraryItem(next.id, { channelId: ctx.channel?.channel.id ?? null });
  };
  return { ctx, next, goNext, channelId };
}

function PlayerChrome({ item }: { item: CatalogItem }) {
  const desktop = useIsDesktop();
  const expanded = usePlayerStore((s) => s.expanded);
  if (desktop) return <DesktopBar item={item} />;
  return (
    <>
      <PhoneBar item={item} />
      {expanded && <FullPlayer item={item} />}
    </>
  );
}

function StatusLine({ item, fallback }: { item: CatalogItem; fallback: string }) {
  const status = usePlayerStore((s) => s.status);
  if (status === "error")
    return (
      <small className="block truncate text-[11.5px] text-bad">
        This file can't be played on this device
      </small>
    );
  return <small className="block truncate text-[11.5px] text-muted-foreground">{fallback}</small>;
}

function DesktopBar({ item }: { item: CatalogItem }) {
  const { ctx, next, goNext, channelId } = usePlayerContext(item);
  const canShare = useCanShareToChat();
  const [shareOpen, setShareOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onItemPage = pathname.endsWith(`/library/item/${item.id}`);
  const sub = ctx.channel
    ? `${ctx.channel.channel.title}${ctx.number ? ` · Lesson ${ctx.number}` : ""}`
    : lengthLabel(item);
  const href = itemHref(item.id, channelId);
  return (
    <div
      className="relative z-20 shrink-0 border-t border-line bg-surface"
      role="region"
      aria-label="Player"
    >
      {item.kind === "video" && !onItemPage && (
        <div className="absolute right-4 bottom-[calc(100%+12px)] w-[288px] overflow-hidden rounded-card border border-line bg-black shadow-lg">
          <VideoSlot priority={1} className="aspect-video w-full" />
        </div>
      )}
      {canShare && <ShareToChatDialog open={shareOpen} onOpenChange={setShareOpen} item={item} />}
      <div className="grid grid-cols-[auto_minmax(0,240px)_auto_minmax(0,1fr)_auto] items-center gap-4 px-[26px] py-3">
        <KindIcon kind={item.kind} size="lg" />
        <div className="min-w-0">
          <Link {...href} className="block truncate text-[13px] font-bold hover:underline">
            {item.title}
          </Link>
          <StatusLine item={item} fallback={sub} />
        </div>
        <div className="flex items-center gap-1.5">
          <SkipButton dir={-1} />
          <PlayPauseButton />
          <SkipButton dir={1} />
          <NextButton onNext={goNext} disabled={!next || !isPlayable(next)} />
        </div>
        <SeekBar />
        <div className="flex items-center gap-1">
          <SpeedButton />
          {canShare && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              aria-label="Share to chat"
              className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            >
              <Share2 className="size-4" aria-hidden="true" />
            </button>
          )}
          <Link
            {...href}
            aria-label="Open the lesson"
            className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            <Maximize2 className="size-4" aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={closePlayer}
            aria-label="Close the player"
            className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PhoneBar({ item }: { item: CatalogItem }) {
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const expanded = usePlayerStore((s) => s.expanded);
  const { ctx } = usePlayerContext(item);
  const pct = duration ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <div
      className="relative z-20 shrink-0 border-t border-line bg-surface"
      role="region"
      aria-label="Player"
    >
      <div className="absolute inset-x-0 top-0 h-[3px] bg-track" aria-hidden="true">
        <span className="block h-full bg-sky" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-2">
        <button
          type="button"
          onClick={() => setPlayerExpanded(true)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          aria-label={`Open the player: ${item.title}`}
        >
          {item.kind === "video" && !expanded ? (
            <VideoSlot priority={1} className="h-9 w-16 shrink-0 rounded-md" />
          ) : (
            <KindIcon kind={item.kind} size="sm" />
          )}
          <span className="min-w-0">
            <b className="block truncate text-[13px]">{item.title}</b>
            <StatusLine
              item={item}
              fallback={
                ctx.channel
                  ? `${ctx.channel.channel.title}${ctx.number ? ` · ${ctx.number} of ${ctx.channel.items.length}` : ""}`
                  : lengthLabel(item)
              }
            />
          </span>
        </button>
        <PlayPauseButton size="sm" />
        <button
          type="button"
          onClick={closePlayer}
          aria-label="Close the player"
          className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-surface-2"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function FullPlayer({ item }: { item: CatalogItem }) {
  const { ctx, next, goNext, channelId } = usePlayerContext(item);
  const people = useLibraryPeople();
  const user = useCurrentUser();
  const learning = useLearning(user.personId);
  const streak = learningStreak(learning);
  const progress = useItemProgress(item.id);
  const color = ctx.channel?.channel.color ?? "teal";
  const Icon = KIND_ICON[item.kind];
  const close = () => setPlayerExpanded(false);
  const canShare = useCanShareToChat();
  const [shareOpen, setShareOpen] = useState(false);

  // Escape closes; the page behind doesn't scroll.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const copyLink = async () => {
    const url = `${window.location.origin}${import.meta.env.BASE_URL}library/item/${item.id}${
      channelId ? `?channel=${encodeURIComponent(channelId)}` : ""
    }`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Now playing: ${item.title}`}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-app px-5 pt-[calc(env(safe-area-inset-top)+12px)] pb-[calc(env(safe-area-inset-bottom)+20px)]"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={close}
          aria-label="Minimize the player"
          className="grid size-10 place-items-center rounded-full hover:bg-surface-2"
        >
          <ChevronDown className="size-5" aria-hidden="true" />
        </button>
        <small className="min-w-0 flex-1 truncate text-center text-[12px] text-muted-foreground">
          {ctx.channel
            ? `${ctx.channel.channel.title}${ctx.number ? ` · ${ctx.number} of ${ctx.channel.items.length}` : ""}`
            : "Now playing"}
        </small>
        <button
          type="button"
          onClick={canShare ? () => setShareOpen(true) : copyLink}
          aria-label={canShare ? "Share to chat" : "Copy a link to this lesson"}
          className="grid size-10 place-items-center rounded-full hover:bg-surface-2"
        >
          {canShare ? (
            <Share2 className="size-5" aria-hidden="true" />
          ) : (
            <Link2 className="size-5" aria-hidden="true" />
          )}
        </button>
        {canShare && <ShareToChatDialog open={shareOpen} onOpenChange={setShareOpen} item={item} />}
      </div>

      <div className="mx-auto grid w-full max-w-md flex-1 content-center gap-4 py-4">
        {item.kind === "video" ? (
          <VideoSlot priority={3} className="aspect-video w-full rounded-card" />
        ) : (
          <div
            className={cn(
              "mx-auto grid aspect-square w-[min(64vw,240px)] place-items-center rounded-[24px] [&_svg]:size-16",
              CHANNEL_COLOR_CLASS[color],
            )}
            aria-hidden="true"
          >
            <Icon />
          </div>
        )}
        <div className="text-center">
          <b className="block text-[17px] leading-snug">{item.title}</b>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {speakerLine(item.speakers, people)} · {lengthLabel(item)}
          </p>
        </div>
        <SeekBar remaining />
        <div className="flex items-center justify-between">
          <SpeedButton />
          <SkipButton dir={-1} size="lg" />
          <PlayPauseButton size="lg" />
          <SkipButton dir={1} size="lg" />
          <NextButton onNext={goNext} disabled={!next || !isPlayable(next)} size="lg" />
        </div>
        {next && (
          <div className="grid gap-1 border-t border-line pt-3">
            <small className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-faint">
              Up next
            </small>
            <Link
              {...itemHref(next.id, ctx.channel?.channel.id)}
              onClick={close}
              className="grid grid-cols-[24px_34px_minmax(0,1fr)] items-center gap-3 py-1"
            >
              <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-[11px] font-extrabold text-muted-foreground">
                {(ctx.number ?? 0) + 1}
              </span>
              <KindIcon kind={next.kind} />
              <span className="min-w-0">
                <b className="block truncate text-[13px]">{next.title}</b>
                <small className="text-[11.5px] text-muted-foreground">{lengthLabel(next)}</small>
              </span>
            </Link>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-[10px] bg-warn-soft px-2.5 py-2 text-[11.5px] text-warn-ink">
          <Flame className="size-[15px] shrink-0 text-amber-strong" aria-hidden="true" />
          {progress?.loggedAt
            ? "Logged to your learning. Listening again is always welcome."
            : streak > 0
              ? `Finishing this logs it to your learning and keeps your ${streak}-day streak going`
              : "Finishing this logs it to your learning and starts a streak"}
          {item.durationSec && !progress?.loggedAt
            ? ` · ${formatMinutes(remainingSec(item, progress) ?? 0)} left`
            : ""}
        </div>
      </div>
    </div>
  );
}
