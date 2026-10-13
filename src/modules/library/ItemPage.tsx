/**
 * One lesson / talk: the in-app viewer (player for audio and uploaded video,
 * embedded YouTube / Vimeo / Google Slides, the browser's PDF viewer for
 * uploaded documents and slides), details, "Mark as done", and previous /
 * next lesson when opened from a channel.
 */
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ExternalLink,
  Pencil,
  Play,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PersonAvatar, ToneChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  FORMAT_LABEL,
  LINK_PROVIDER_LABEL,
  canEditLibrary,
  formatClock,
  formatMinutes,
  isPlayable,
  itemFraction,
  lengthLabel,
  markLibraryItemDone,
  markLibraryItemNotDone,
  parseDate,
  parseLink,
  remainingSec,
  removeCatalogItem,
  speakerName,
  useCatalogItem,
  useChannelsWithItem,
  useEvent,
  useItemProgress,
  useLessonContext,
  useLibraryFileUrl,
  useLibraryPeople,
  useLibraryTopics,
  useLibraryViewer,
  type CatalogItem,
} from "@/data";
import { CHANNEL_COLOR_CLASS, ChannelIcon, KIND_ICON } from "./icons";
import { ItemDialog } from "./ItemDialog";
import { ShareToChatDialog, useCanShareToChat } from "./ShareToChatDialog";
import { channelHref, itemHref } from "./links";
import { Bar, TopicPill, audienceText } from "./parts";
import { PlayPauseButton, SeekBar, SkipButton, SpeedButton } from "./player/controls";
import { playLibraryItem, usePlayerStore } from "./player/store";
import { VideoSlot } from "./player/videoSlot";

export function ItemPage({ itemId, channelId }: { itemId: string; channelId?: string }) {
  const item = useCatalogItem(itemId);
  if (!item) {
    return (
      <div className="mx-auto grid w-full max-w-4xl content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]">
        <BackLink to="/library/talks" label="All talks" />
        <EmptyState
          title="Not found"
          body="This talk was removed from the library, or it isn't shared with you."
          action={
            <Button asChild variant="soft">
              <Link to="/library/talks">Open All talks</Link>
            </Button>
          }
        />
      </div>
    );
  }
  return <Item item={item} channelId={channelId} />;
}

function BackLink(
  props:
    { to: "/library/talks" | "/library"; label: string } | { channelId: string; label: string },
) {
  const cls =
    "inline-flex w-fit items-center gap-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground";
  return "channelId" in props ? (
    <Link {...channelHref(props.channelId)} className={cls}>
      <ChevronLeft className="size-3.5" aria-hidden="true" />
      {props.label}
    </Link>
  ) : (
    <Link to={props.to} className={cls}>
      <ChevronLeft className="size-3.5" aria-hidden="true" />
      {props.label}
    </Link>
  );
}

function Item({ item, channelId }: { item: CatalogItem; channelId?: string }) {
  const navigate = useNavigate();
  const viewer = useLibraryViewer();
  const people = useLibraryPeople();
  const topics = useLibraryTopics();
  const event = useEvent(item.eventId ?? "");
  const progress = useItemProgress(item.id);
  const ctx = useLessonContext(item.id, channelId);
  const inChannels = useChannelsWithItem(item.id);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const canShare = useCanShareToChat();
  const canEdit = canEditLibrary(item, viewer);
  const done = !!progress?.completedAt;
  const topicName = new Map(topics.map((t) => [t.id, t.name]));
  const prev = ctx.prevId ? ctx.channel?.items.find((i) => i.id === ctx.prevId) : undefined;
  const next = ctx.nextId ? ctx.channel?.items.find((i) => i.id === ctx.nextId) : undefined;

  const markDone = () => {
    const r = markLibraryItemDone(item.id);
    if (r.logged)
      toast.success(`Finished "${item.title}"`, {
        description: "Logged to your learning. It counts toward your streak and weekly goal.",
      });
    else toast.success("Marked as done");
  };

  return (
    <div className="mx-auto grid w-full max-w-4xl content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      {ctx.channel ? (
        <BackLink channelId={ctx.channel.channel.id} label={ctx.channel.channel.title} />
      ) : (
        <BackLink to="/library/talks" label="All talks" />
      )}

      <header className="grid gap-1">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-faint">
          {ctx.channel && ctx.number
            ? `Lesson ${ctx.number} of ${ctx.channel.items.length} · ${FORMAT_LABEL[item.format]}`
            : FORMAT_LABEL[item.format]}
        </span>
        <h1 className="text-[19px] font-extrabold leading-tight lg:text-[22px]">{item.title}</h1>
        <p className="text-[13px] text-muted-foreground">
          {item.speakers
            .map((s) => speakerName(s, people) + (s.personId ? "" : " (guest)"))
            .join(", ")}{" "}
          · {lengthLabel(item)}
        </p>
      </header>

      <Viewer item={item} channelId={ctx.channel?.channel.id} />

      {/* Done / not done, previous / next */}
      <div className="flex flex-wrap items-center gap-2">
        {done ? (
          <>
            <ToneChip tone="good" icon={CircleCheck}>
              Done {format(new Date(progress!.completedAt!), "MMM d")}
            </ToneChip>
            <Button variant="ghost" size="sm" onClick={() => markLibraryItemNotDone(item.id)}>
              <Undo2 /> Mark as not done
            </Button>
          </>
        ) : (
          <Button variant={isPlayable(item) ? "outline" : "default"} onClick={markDone}>
            <CircleCheck /> Mark as done
          </Button>
        )}
        {canShare && (
          <Button variant="outline" onClick={() => setShareOpen(true)}>
            <Send /> Share to chat
          </Button>
        )}
        <span className="flex-1" />
        {prev && (
          <Button asChild variant="outline" size="sm">
            <Link {...itemHref(prev.id, ctx.channel?.channel.id)}>
              <ChevronLeft /> Previous
            </Link>
          </Button>
        )}
        {next && (
          <Button asChild variant="soft" size="sm">
            <Link {...itemHref(next.id, ctx.channel?.channel.id)}>
              Next: {next.title.length > 28 ? `${next.title.slice(0, 27)}…` : next.title}{" "}
              <ChevronRight />
            </Link>
          </Button>
        )}
      </div>
      {!done && (
        <p className="-mt-2 text-[12px] text-muted-foreground">
          {isPlayable(item)
            ? "Listening to the end (90%) marks it done and logs it to your learning."
            : "Mark it as done when you've finished; it's logged to your learning."}
        </p>
      )}

      {/* Details */}
      <section className="grid gap-3 rounded-card border border-line bg-surface p-4 lg:grid-cols-2">
        {item.description && <p className="text-[13px] lg:col-span-2">{item.description}</p>}
        <Detail label="Speakers">
          <div className="flex flex-wrap gap-2">
            {item.speakers.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-[13px]">
                <PersonAvatar name={speakerName(s, people)} size="sm" />
                {speakerName(s, people)}
                {!s.personId && <span className="text-muted-foreground">(guest)</span>}
              </span>
            ))}
          </div>
        </Detail>
        <Detail label="Topics">
          {item.topicIds.length ? (
            <div className="flex flex-wrap gap-1">
              {item.topicIds.map(
                (t) => topicName.get(t) && <TopicPill key={t}>{topicName.get(t)}</TopicPill>,
              )}
            </div>
          ) : (
            <span className="text-[13px] text-muted-foreground">None</span>
          )}
        </Detail>
        <Detail label="Recorded">
          <span className="text-[13px]">
            {event ? (
              <Link
                to="/events/$id"
                params={{ id: event.id }}
                className="font-semibold hover:underline"
              >
                {event.name}
              </Link>
            ) : null}
            {event && item.recordedOn ? " · " : null}
            {item.recordedOn
              ? format(parseDate(item.recordedOn), "MMM d, yyyy")
              : event
                ? null
                : "—"}
          </span>
        </Detail>
        <Detail label="Shared with">
          <span className="text-[13px]">
            {audienceText(
              item.visibility,
              item.createdBy,
              people.get(item.createdBy)?.name ?? "Your upline",
              viewer?.personId ?? "",
            )}{" "}
            · added by {people.get(item.createdBy)?.name ?? "a team member"}{" "}
            {format(new Date(item.createdAt), "MMM d, yyyy")}
          </span>
        </Detail>
        {inChannels.length > 0 && (
          <Detail label="In channels" className="lg:col-span-2">
            <div className="flex flex-wrap gap-2">
              {inChannels.map((c) => (
                <Link
                  key={c.channel.id}
                  {...channelHref(c.channel.id)}
                  className="inline-flex items-center gap-2 rounded-full border border-line py-1 pr-3 pl-1 text-[12.5px] font-semibold hover:bg-surface-2"
                >
                  <ChannelIcon
                    icon={c.channel.icon}
                    color={c.channel.color}
                    size="sm"
                    className="size-6 rounded-full [&_svg]:size-3.5"
                  />
                  {c.channel.title}
                </Link>
              ))}
            </div>
          </Detail>
        )}
        {canEdit && (
          <div className="flex gap-2 lg:col-span-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-bad"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 /> Delete
            </Button>
          </div>
        )}
      </section>

      {canShare && <ShareToChatDialog open={shareOpen} onOpenChange={setShareOpen} item={item} />}
      {canEdit && (
        <>
          <ItemDialog open={editOpen} onOpenChange={setEditOpen} item={item} />
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{item.title}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  It leaves All talks and every channel it's in
                  {inChannels.length ? ` (${inChannels.length})` : ""}, for everyone. Learning
                  already logged stays.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    removeCatalogItem(item.id);
                    void navigate({ to: "/library/talks" });
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

function Detail({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid content-start gap-1", className)}>
      <span className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-faint">
        {label}
      </span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

function Viewer({ item, channelId }: { item: CatalogItem; channelId?: string }) {
  if (isPlayable(item)) return <MediaPanel item={item} channelId={channelId} />;
  if (item.source === "link") return <LinkViewer item={item} />;
  return <PdfViewer item={item} />;
}

/** Audio / uploaded video: driven by the app-wide player. */
function MediaPanel({ item, channelId }: { item: CatalogItem; channelId?: string }) {
  const current = usePlayerStore((s) => s.itemId === item.id);
  const progress = useItemProgress(item.id);
  const Icon = KIND_ICON[item.kind];
  const f = itemFraction(item, progress);
  const resumeAt =
    progress && !progress.completedAt && progress.positionSec > 0 ? progress.positionSec : 0;
  const left = remainingSec(item, progress);

  return (
    <div className="grid gap-3 rounded-card border border-line bg-surface p-3 lg:p-4">
      {item.kind === "video" ? (
        current ? (
          <VideoSlot priority={2} className="aspect-video w-full rounded-xl" />
        ) : (
          <button
            type="button"
            onClick={() => playLibraryItem(item.id, { channelId: channelId ?? null })}
            className="grid aspect-video w-full place-items-center rounded-xl bg-black/90 text-white focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={`Play ${item.title}`}
          >
            <span className="grid size-16 place-items-center rounded-full bg-primary text-primary-foreground">
              <Play className="size-7 translate-x-0.5" aria-hidden="true" />
            </span>
          </button>
        )
      ) : (
        <div
          className={cn(
            "grid h-36 place-items-center rounded-xl [&_svg]:size-12",
            CHANNEL_COLOR_CLASS.mist,
          )}
          aria-hidden="true"
        >
          <Icon />
        </div>
      )}
      {current ? (
        <div className="grid gap-2">
          <SeekBar remaining />
          <div className="flex items-center justify-center gap-3">
            <SpeedButton />
            <SkipButton dir={-1} />
            <PlayPauseButton />
            <SkipButton dir={1} />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => playLibraryItem(item.id, { channelId: channelId ?? null })}>
            <Play />
            {resumeAt
              ? `Resume from ${formatClock(resumeAt)}`
              : progress?.completedAt
                ? "Play again"
                : "Play"}
          </Button>
          {f > 0 && f < 1 && (
            <div className="grid min-w-[160px] flex-1 gap-1">
              <Bar value={f} />
              <small className="text-[11.5px] text-muted-foreground">
                {left !== null ? `${formatMinutes(left)} left` : `${Math.round(f * 100)}% done`}
              </small>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** YouTube / Vimeo / Google Slides embed (or an "Open" button for other links). */
function LinkViewer({ item }: { item: CatalogItem }) {
  const parsed = parseLink(item.linkUrl ?? "");
  const provider = item.linkProvider ?? parsed?.provider ?? "other";
  return (
    <div className="grid gap-2">
      {parsed?.embedUrl ? (
        <iframe
          src={parsed.embedUrl}
          title={item.title}
          className={cn(
            "w-full rounded-card border border-line bg-black",
            item.kind === "slides" ? "aspect-[16/10]" : "aspect-video",
          )}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="grid h-40 place-items-center rounded-card border border-dashed border-line text-[13px] text-muted-foreground">
          This link opens outside the app.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <Button asChild variant="outline" size="sm">
          <a href={item.linkUrl ?? "#"} target="_blank" rel="noreferrer noopener">
            <ExternalLink /> Open on {LINK_PROVIDER_LABEL[provider]}
          </a>
        </Button>
        {parsed?.embedUrl && (
          <span>Progress isn't tracked for links: mark it as done when you've watched it.</span>
        )}
      </div>
    </div>
  );
}

/** Uploaded PDF (document or slides) in the browser's own viewer. */
function PdfViewer({ item }: { item: CatalogItem }) {
  const url = useLibraryFileUrl(item.storagePath);
  if (url === undefined)
    return (
      <div
        className="h-[60vh] animate-pulse rounded-card bg-surface-2"
        aria-label="Loading the document"
      />
    );
  if (url === null)
    return (
      <EmptyState
        title="The file isn't available"
        body="It may have been stored on another device. Ask the person who added it to upload it again."
      />
    );
  return (
    <div className="grid gap-2">
      <iframe
        src={`${url}#view=${item.kind === "slides" ? "Fit" : "FitH"}`}
        title={item.title}
        className={cn(
          "w-full rounded-card border border-line bg-surface-2",
          item.kind === "slides" ? "aspect-[16/10] max-h-[75vh]" : "h-[70vh]",
        )}
      />
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <span className="lg:hidden">Some phones can't show documents inside the app:</span>
        <Button asChild variant="outline" size="sm">
          <a href={url} target="_blank" rel="noreferrer noopener">
            <ExternalLink /> Open
          </a>
        </Button>
      </div>
    </div>
  );
}
