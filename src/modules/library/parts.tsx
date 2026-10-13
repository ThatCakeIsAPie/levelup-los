import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { Check, CircleCheck, CircleDashed, Lock, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatMinutes,
  isNewItem,
  itemFraction,
  lengthLabel,
  type CatalogItem,
  type ChannelView,
  type ContinueView,
  type LibraryProgress,
  type LibraryVisibility,
  useCurrentUser,
} from "@/data";
import { ChannelIcon, CHANNEL_COLOR_CLASS, CHANNEL_ICON, KindIcon } from "./icons";
import { channelHref } from "./links";
import { BookOpen } from "lucide-react";

/** Thin progress bar (sky on the track). */
export function Bar({
  value,
  className,
  fill = "bg-sky",
}: {
  value: number;
  className?: string;
  fill?: string;
}) {
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-track", className)}
      aria-hidden="true"
    >
      <span
        className={cn("block h-full rounded-full", fill)}
        style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }}
      />
    </div>
  );
}

/** "Channels | All talks" (links; the current one is highlighted). */
export function LibraryTabs({
  current,
  className,
}: {
  current: "channels" | "talks";
  className?: string;
}) {
  const base =
    "rounded-[7px] px-3.5 py-1.5 text-[12.5px] font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring";
  const on = "bg-surface text-foreground shadow-sm";
  return (
    <nav
      aria-label="Library views"
      className={cn(
        "inline-flex w-fit gap-0.5 rounded-[10px] border border-line bg-surface-2 p-[3px]",
        className,
      )}
    >
      <Link
        to="/library"
        className={cn(base, current === "channels" && on)}
        aria-current={current === "channels" ? "page" : undefined}
      >
        Channels
      </Link>
      <Link
        to="/library/talks"
        className={cn(base, current === "talks" && on)}
        aria-current={current === "talks" ? "page" : undefined}
      >
        All talks
      </Link>
    </nav>
  );
}

/** Done / 40% done / New for a catalog row. */
export function ItemStatus({
  item,
  progress,
  className,
}: {
  item: CatalogItem;
  progress: LibraryProgress | undefined;
  className?: string;
}) {
  const viewerId = useCurrentUser().personId;
  if (progress?.completedAt)
    return (
      <span
        className={cn("inline-flex items-center gap-1 text-[11px] font-bold text-good", className)}
      >
        <CircleCheck className="size-[13px]" aria-hidden="true" />
        Done
      </span>
    );
  const f = itemFraction(item, progress);
  if (f > 0)
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground",
          className,
        )}
      >
        <CircleDashed className="size-[13px]" aria-hidden="true" />
        {f >= 0.45 && f <= 0.55 ? "Half done" : `${Math.round(f * 100)}% done`}
      </span>
    );
  if (isNewItem(item, progress, Date.now(), viewerId))
    return (
      <span
        className={cn(
          "w-fit rounded-full bg-amber px-2 py-px text-[11px] font-bold text-on-amber",
          className,
        )}
      >
        New
      </span>
    );
  return null;
}

/** Plain-text status for phone rows ("done", "half done", "new"). */
export function statusText(item: CatalogItem, p: LibraryProgress | undefined): string | null {
  if (p?.completedAt) return "done";
  const f = itemFraction(item, p);
  if (f > 0) return f >= 0.45 && f <= 0.55 ? "half done" : `${Math.round(f * 100)}% done`;
  return null;
}

/** "7 lessons · 5 of 12", "done", "for IBOs", "2 new" — the channel list's second line. */
export function channelMeta(v: ChannelView): string {
  const n = v.lessonCount;
  const lessons = `${n} ${n === 1 ? "lesson" : "lessons"}`;
  if (v.locked) return `${lessons} · for IBOs`;
  if (v.stats.total && v.stats.done === v.stats.total) return `${lessons} · done`;
  if (v.newCount) return `${lessons} · ${v.newCount} new`;
  if (v.stats.done) return `${lessons} · ${v.stats.done} of ${v.stats.total}`;
  return `${lessons} · ${v.started ? "started" : "not started"}`;
}

/** Desktop channel list row. */
export function ChannelRow({ view, active }: { view: ChannelView; active: boolean }) {
  const c = view.channel;
  const done = view.stats.total > 0 && view.stats.done === view.stats.total;
  return (
    <Link
      {...channelHref(c.id)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "grid grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] p-2 text-[13px] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring",
        active && "bg-primary-soft hover:bg-primary-soft",
      )}
    >
      <ChannelIcon icon={c.icon} color={c.color} />
      <span className="min-w-0">
        <b className="block truncate">{c.title}</b>
        <small className="block truncate text-[11.5px] text-muted-foreground">
          {channelMeta(view)}
        </small>
      </span>
      {view.locked ? (
        <Lock className="size-4 text-faint" aria-label="For IBOs and leaders" />
      ) : done ? (
        <CircleCheck className="size-[18px] text-good" aria-label="Done" />
      ) : view.newCount > 0 ? (
        <span className="size-[9px] rounded-full bg-amber" aria-label={`${view.newCount} new`} />
      ) : view.stats.done > 0 ? (
        <MiniRing value={view.stats.fraction} />
      ) : (
        <span />
      )}
    </Link>
  );
}

/** 22px progress ring for list rows. */
export function MiniRing({ value }: { value: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 22 22"
      className="size-[22px] -rotate-90"
      role="img"
      aria-label={`${Math.round(value * 100)}% done`}
    >
      <circle cx="11" cy="11" r={r} fill="none" strokeWidth="3" className="stroke-track" />
      <circle
        cx="11"
        cy="11"
        r={r}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-sky"
        strokeDasharray={`${c * value} ${c}`}
      />
    </svg>
  );
}

/** Phone channel tile (colored, progress along the bottom). */
export function ChannelTile({ view }: { view: ChannelView }) {
  const c = view.channel;
  const Icon = CHANNEL_ICON[c.icon] ?? BookOpen;
  const done = view.stats.total > 0 && view.stats.done === view.stats.total;
  const sub = view.locked
    ? "For IBOs"
    : done
      ? "Done"
      : view.newCount
        ? `${view.newCount} new`
        : view.stats.done
          ? `${view.stats.done} of ${view.stats.total}`
          : `${view.lessonCount} ${view.lessonCount === 1 ? "lesson" : "lessons"}`;
  return (
    <Link
      {...channelHref(c.id)}
      className={cn(
        "grid min-h-[118px] content-end gap-1 rounded-card p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        CHANNEL_COLOR_CLASS[c.color],
      )}
    >
      <span className="mb-auto flex items-start justify-between">
        <Icon className="size-[22px]" aria-hidden="true" />
        {view.locked && <Lock className="size-4 opacity-80" aria-label="For IBOs and leaders" />}
      </span>
      <b className="text-[13px] leading-tight">{c.title}</b>
      <small className="text-[11px] opacity-85">{sub}</small>
      <div className="h-[5px] overflow-hidden rounded-full bg-black/15" aria-hidden="true">
        <span
          className="block h-full rounded-full bg-current"
          style={{ width: `${Math.round(view.stats.fraction * 100)}%` }}
        />
      </div>
    </Link>
  );
}

/** One lesson in a channel (number or check, kind icon, title, meta, right label). */
export function LessonRow({
  item,
  number,
  progress,
  current,
  onOpen,
  trailing,
}: {
  item: CatalogItem;
  number: number;
  progress: LibraryProgress | undefined;
  /** The lesson to continue with. */
  current: boolean;
  onOpen: () => void;
  /** Edit controls (replace the date/status label). */
  trailing?: ReactNode;
}) {
  const done = !!progress?.completedAt;
  const f = itemFraction(item, progress);
  const left =
    !done && f > 0 && item.durationSec
      ? ` · ${formatMinutes(item.durationSec * (1 - f))} left`
      : "";
  const label = done
    ? `Done ${format(new Date(progress!.completedAt!), "MMM d")}`
    : f > 0 || current
      ? f > 0
        ? "In progress"
        : "Up next"
      : "";
  return (
    <div
      className={cn(
        "grid grid-cols-[28px_34px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-2.5 py-2 text-[13px]",
        current && "bg-primary-soft",
      )}
    >
      <span
        className={cn(
          "grid size-6 place-items-center rounded-full bg-surface-2 text-[11px] font-extrabold text-muted-foreground",
          done && "bg-good-soft text-good",
          current && !done && "bg-primary text-primary-foreground",
        )}
        aria-label={done ? "Done" : `Lesson ${number}`}
      >
        {done ? <Check className="size-3.5" aria-hidden="true" /> : number}
      </span>
      <KindIcon kind={item.kind} />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 rounded text-left focus-visible:outline-2 focus-visible:outline-ring"
      >
        <b
          className={cn(
            "block truncate hover:underline",
            done && "font-semibold text-muted-foreground",
          )}
        >
          {item.title}
        </b>
        <small className="block truncate text-[11.5px] text-muted-foreground">
          {lengthLabel(item)}
          {left}
        </small>
      </button>
      {trailing ?? (
        <span
          className={cn(
            "whitespace-nowrap text-[11.5px] text-faint",
            current && !done && "font-bold text-primary-ink",
          )}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/** The "Continue" card (library home and Home dashboard). */
export function ContinueCard({
  view,
  eyebrow = "Continue",
  sub,
  onPlay,
  className,
}: {
  view: ContinueView;
  eyebrow?: string;
  /** Second line (default: channel and time left). */
  sub?: string;
  onPlay: () => void;
  className?: string;
}) {
  const left = view.remainingSec !== null ? `${formatMinutes(view.remainingSec)} left` : null;
  const line = sub ?? [view.channel?.title, left].filter(Boolean).join(" · ");
  return (
    <div
      className={cn(
        "grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5",
        className,
      )}
    >
      <KindIcon kind={view.item.kind} size="lg" />
      <div className="min-w-0">
        <small className="block text-[10px] font-extrabold uppercase tracking-[.08em] text-faint">
          {eyebrow}
        </small>
        <b className="mt-px mb-[5px] block truncate text-[13px]">{view.item.title}</b>
        <Bar value={view.fraction} className="h-[5px]" />
        <small className="mt-1 block truncate text-[11.5px] text-muted-foreground">{line}</small>
      </div>
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Continue ${view.item.title}`}
        className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Play className="size-4 translate-x-px" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Small uppercase label above a group. */
export function GroupLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "px-2 pt-3 pb-1 text-[10.5px] font-extrabold uppercase tracking-[.08em] text-faint",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Who an item or channel is shared with, from the viewer's side ("Anita's downline", "Your downline"). */
export function audienceText(
  visibility: LibraryVisibility,
  ownerId: string,
  ownerName: string,
  viewerId: string,
): string {
  if (visibility === "team") return "Whole team";
  if (visibility === "ibos") return "IBOs and leaders";
  return ownerId === viewerId ? "Your downline" : `${ownerName.split(" ")[0]}'s downline`;
}

/** Unique lessons across channels (a lesson in two channels counts once). */
export function lessonTotals(views: ChannelView[], progress: Map<string, LibraryProgress>) {
  const ids = new Set(views.filter((v) => !v.locked).flatMap((v) => v.items.map((i) => i.id)));
  let done = 0;
  for (const id of ids) if (progress.get(id)?.completedAt) done++;
  return { done, total: ids.size };
}

/** "From Anita (your upline)" group heading for a channel owner. */
export const uplineLabel = (ownerName: string) => `From ${ownerName.split(" ")[0]} (your upline)`;

/** Topic pill (sky). */
export function TopicPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-info-soft px-[7px] py-px text-[10.5px] font-bold text-info-ink">
      {children}
    </span>
  );
}
