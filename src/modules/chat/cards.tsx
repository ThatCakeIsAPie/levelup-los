import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Award,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Headphones,
  MessageSquareQuote,
  Presentation,
  ShoppingBag,
  Ticket,
  Trophy,
  UserPlus,
  Video,
  type LucideIcon,
} from "lucide-react";
import { PersonAvatar, StageChip } from "@/components/brand";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  canOpenPerson,
  daysFromToday,
  downloadEventIcs,
  googleCalendarUrl,
  messagePreview,
  parseDate,
  postWin,
  rsvpEvent,
  unpost,
  useChatPeople,
  useEventRsvp,
  useLibrary,
  useMessageIndex,
  winCardTarget,
  type CardTarget,
  type LibraryItem,
  type MessageCard,
  type RsvpChoice,
  type WinKind,
} from "@/data";
import { toastWithUndo } from "@/components/log/quickLog";
import { dateRange } from "@/modules/dashboard/format";
import "./chat.css";

/** Navigate to a card target. */
export function useOpenTarget() {
  const navigate = useNavigate();
  return (t: CardTarget) => {
    if (t.kind === "person") navigate({ to: "/people/$id", params: { id: t.id } });
    else if (t.kind === "event") navigate({ to: "/events/$id", params: { id: t.id } });
    else if (t.kind === "message") {
      navigate({ to: "/chats/$id", params: { id: t.conversationId }, search: { m: t.messageId } });
    }
  };
}

// ---------------------------------------------------------------------------
// Win card
// ---------------------------------------------------------------------------

export const WIN_ICON: Record<WinKind, LucideIcon> = {
  sale: ShoppingBag,
  contact: UserPlus,
  plan: Presentation,
  ticket: Ticket,
  rank: Award,
  other: Trophy,
};

/** Icon tile per win kind (docs/design/chats-mockup.html: sale teal, contact sky, others amber). */
const WIN_TILE: Record<WinKind, string> = {
  sale: "bg-primary text-primary-foreground",
  contact: "bg-sky text-on-sky",
  plan: "bg-warn-soft text-amber-strong",
  ticket: "bg-warn-soft text-amber-strong",
  rank: "bg-warn-soft text-amber-strong",
  other: "bg-warn-soft text-amber-strong",
};

/** Outline shared by the activity cards (wins and learning). */
const ACTIVITY_CARD =
  "rounded-xl border-[1.5px] border-[var(--win-line)] bg-transparent px-3 py-2.5 text-left text-muted-foreground";

/**
 * The win card look: 1.5px outline in the text blue (--win-line), transparent
 * background, 12px radius and an icon tile colored by kind. (The gold
 * "activity" band belongs to the message bubble, not the card; see MessageBubble.)
 */
export function WinCardFrame({
  winKind,
  title,
  detail,
  className,
  children,
}: {
  winKind: WinKind;
  title: ReactNode;
  detail?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const Icon = WIN_ICON[winKind];
  return (
    <div
      className={cn(
        "grid grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5",
        ACTIVITY_CARD,
        className,
      )}
    >
      <span className={cn("grid size-[34px] place-items-center rounded-[10px]", WIN_TILE[winKind])}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        {children ?? (
          <>
            <div className="text-[13px] font-extrabold text-foreground">{title}</div>
            {detail && <div className="text-[11.5px]">{detail}</div>}
          </>
        )}
      </div>
    </div>
  );
}

/** A posted win: opens the logged record (or the author's profile). */
export function WinCard({
  card,
  authorId,
  authorName,
}: {
  card: Extract<MessageCard, { type: "win" }>;
  authorId: string;
  authorName: string;
}) {
  const open = useOpenTarget();
  return (
    <button
      type="button"
      className="block w-full rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      onClick={() => {
        const t = winCardTarget(card, authorId);
        if (t) open(t);
        else toast(`Only ${authorName.split(" ")[0]} and their upline can open this record.`);
      }}
      aria-label={`${card.title}${card.detail ? `, ${card.detail}` : ""}. Open the record`}
    >
      <WinCardFrame winKind={card.winKind} title={card.title} detail={card.detail} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Learning card
// ---------------------------------------------------------------------------

export function LearningCard({
  card,
  authorId,
  authorName,
}: {
  card: Extract<MessageCard, { type: "learning" }>;
  authorId: string;
  authorName: string;
}) {
  const open = useOpenTarget();
  const visible = canOpenPerson(authorId);
  // Same outlined activity card as a win, with a sky "learning" tile.
  const body = (
    <>
      <span className="grid size-[34px] place-items-center rounded-[10px] bg-info-soft text-info-ink">
        <BookOpen className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-extrabold text-foreground">
          {authorName.split(" ")[0]} finished <i>{card.title}</i>
        </div>
        <div className="text-[11.5px]">Learning · logged</div>
      </div>
    </>
  );
  const cls = cn(
    "grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5",
    ACTIVITY_CARD,
  );
  if (!visible) {
    return (
      <div className={cls}>
        {body}
        <span />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => open({ kind: "person", id: authorId })}
      aria-label={`${authorName} finished ${card.title}. Open their profile`}
      className={cn(
        cls,
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      {body}
      <ChevronRight className="size-4 text-faint" aria-hidden="true" />
    </button>
  );
}

/** Bordered inset row used by learning and link cards. */
function CardButton({
  children,
  onClick,
  label,
}: {
  children: ReactNode;
  onClick?: () => void;
  label: string;
}) {
  const cls =
    "grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] border border-line bg-surface-2 px-2.5 py-2 text-left";
  if (!onClick) {
    return (
      <div className={cls}>
        {children}
        <span />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        cls,
        "hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      {children}
      <ChevronRight className="size-4 text-faint" aria-hidden="true" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Link card
// ---------------------------------------------------------------------------

const MATERIAL_ICON: Record<LibraryItem["kind"], LucideIcon> = {
  audio: Headphones,
  video: Video,
  document: FileText,
};

export function materialMeta(item: LibraryItem): string {
  const kind = item.kind === "audio" ? "Audio" : item.kind === "video" ? "Video" : "Document";
  const mins = item.durationSec ? ` · ${Math.round(item.durationSec / 60)} min` : "";
  return `${kind}${mins} · from the library`;
}

export function LinkCard({ card }: { card: Extract<MessageCard, { type: "link" }> }) {
  const { kind, id } = card.target;
  if (kind === "material") return <MaterialLink id={id} />;
  if (kind === "event") return <EventLink id={id} />;
  if (kind === "person") return <PersonLink id={id} />;
  return <MessageLink id={id} />;
}

function MaterialLink({ id }: { id: string }) {
  const item = useLibrary().find((x) => x.id === id);
  const [open, setOpen] = useState(false);
  if (!item) return <Unavailable text="This material was removed from the library" />;
  const Icon = MATERIAL_ICON[item.kind];
  return (
    <>
      <CardButton onClick={() => setOpen(true)} label={`Open ${item.title}`}>
        <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-bold">{item.title}</div>
          <div className="text-[11px] text-muted-foreground">{materialMeta(item)}</div>
        </div>
      </CardButton>
      <MaterialDialog item={item} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function MaterialDialog({
  item,
  open,
  onOpenChange,
}: {
  item: LibraryItem;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const Icon = MATERIAL_ICON[item.kind];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-card">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-xl bg-primary-soft text-primary-ink">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <DialogTitle>{item.title}</DialogTitle>
          <DialogDescription>{materialMeta(item)}</DialogDescription>
        </DialogHeader>
        <p className="text-[13px] text-muted-foreground">
          Our own talks, videos and documents will play right here once the media library ships. In
          this demo the file itself isn't included.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function EventLink({ id }: { id: string }) {
  const { event } = useEventRsvp(id);
  const open = useOpenTarget();
  if (!event) return <Unavailable text="This event was removed" />;
  return (
    <CardButton onClick={() => open({ kind: "event", id })} label={`Open ${event.name}`}>
      <span className="grid size-9 place-items-center rounded-full bg-event text-event-fg">
        <CalendarDays className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-bold">{event.name}</div>
        <div className="text-[11px] text-muted-foreground">
          {dateRange(event)}
          {event.location ? ` · ${event.location}` : ""}
        </div>
      </div>
    </CardButton>
  );
}

function PersonLink({ id }: { id: string }) {
  const people = useChatPeople();
  const open = useOpenTarget();
  const p = people.get(id);
  const visible = canOpenPerson(id);
  if (!p) return <Unavailable text="This person is no longer on the team" />;
  return (
    <CardButton
      onClick={visible ? () => open({ kind: "person", id }) : undefined}
      label={`Open ${p.name}'s profile`}
    >
      <PersonAvatar name={p.name} stage={p.stage} size="md" className="size-9" />
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-bold">{p.name}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <StageChip stage={p.stage} />
          {!visible && <span>Profile is private to their upline</span>}
        </div>
      </div>
    </CardButton>
  );
}

function MessageLink({ id }: { id: string }) {
  const index = useMessageIndex();
  const people = useChatPeople();
  const open = useOpenTarget();
  const m = index.get(id);
  if (!m) return <Unavailable text="You can't open this message" />;
  const author = people.get(m.authorId)?.name ?? "Someone";
  return (
    <CardButton
      onClick={() => open({ kind: "message", conversationId: m.conversationId, messageId: m.id })}
      label={`Open message from ${author}`}
    >
      <span className="grid size-9 place-items-center rounded-full bg-surface text-primary-ink">
        <MessageSquareQuote className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-bold text-primary-ink">
          {author} · {format(new Date(m.createdAt), "MMM d")}
        </div>
        <div className="truncate text-[12px] text-muted-foreground">{messagePreview(m)}</div>
      </div>
    </CardButton>
  );
}

function Unavailable({ text }: { text: string }) {
  return (
    <div className="rounded-[10px] border border-dashed border-line px-3 py-2 text-[12px] text-faint">
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event card
// ---------------------------------------------------------------------------

const RSVP: { value: RsvpChoice; label: string }[] = [
  { value: "going", label: "Going" },
  { value: "maybe", label: "Maybe" },
  { value: "ticket", label: "Bought ticket" },
];

/**
 * Navy event post: Going / Maybe / Bought ticket write the viewer's
 * attendance; "Add to calendar" offers an .ics download and Google Calendar.
 */
export function EventCard({ eventId, messageId }: { eventId: string; messageId?: string }) {
  const { event, mine, counts } = useEventRsvp(eventId);
  const open = useOpenTarget();
  if (!event) return <Unavailable text="This event was removed" />;
  const current: RsvpChoice | null = mine?.hasTicket
    ? "ticket"
    : mine?.desireToAttend === "yes"
      ? "going"
      : mine?.desireToAttend === "maybe"
        ? "maybe"
        : null;
  const past = (event.endDate ?? event.date) < daysFromToday(0);
  const close = format(parseDate(event.date), "EEE, MMM d");

  const answer = (choice: RsvpChoice) => {
    if (choice === current) return;
    if (current === "ticket") {
      toast("You already have a ticket for this event.");
      return;
    }
    const attendanceId = rsvpEvent(eventId, choice, messageId);
    if (choice === "ticket") {
      toast.success(`Ticket for ${event.name} recorded`, {
        action: {
          label: "Share as a win",
          onClick: () => {
            const m = postWin({
              winKind: "ticket",
              refId: attendanceId,
              title: "Bought my ticket",
              detail: event.name,
            });
            if (m) toastWithUndo("Shared in Daily wins", () => unpost(m.id));
          },
        },
      });
    } else {
      toast.success(choice === "going" ? "Marked as going" : "Marked as maybe");
    }
  };

  return (
    <div className="grid gap-2.5 rounded-xl bg-event px-3 py-3 text-event-fg">
      <button
        type="button"
        onClick={() => open({ kind: "event", id: event.id })}
        className="grid justify-items-start gap-0.5 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="text-[13.5px] font-extrabold">{event.name}</span>
        <span className="text-[11.5px] text-event-muted">
          {dateRange(event)}
          {event.location ? ` · ${event.location}` : ""} · {past ? "finished" : `starts ${close}`}
        </span>
      </button>
      {!past && (
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Your answer">
          {RSVP.map((r) => (
            <button
              key={r.value}
              type="button"
              aria-pressed={current === r.value}
              onClick={() => answer(r.value)}
              className={cn(
                "rounded-lg bg-white/10 px-1 py-1.5 text-center text-[11.5px] font-bold text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                current === r.value && "bg-sky text-on-sky hover:bg-sky",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-event-muted">
        <span className="tabular-nums">
          {counts.bought} bought · {counts.going} going · {counts.maybe} maybe
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded font-bold text-white hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <CalendarPlus className="size-[13px]" aria-hidden="true" />
              Add to calendar
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => downloadEventIcs(event)}>
              <Download /> Download .ics (Apple, Outlook)
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> Google Calendar
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Win and learning cards mark a message as an activity post (gold band on the bubble edge). */
export const isActivityCard = (card: MessageCard | null | undefined) =>
  card?.type === "win" || card?.type === "learning";

/** Renders any message card. */
export function MessageCardView({
  card,
  messageId,
  authorId,
  authorName,
}: {
  card: MessageCard;
  messageId?: string;
  authorId: string;
  authorName: string;
}) {
  switch (card.type) {
    case "event":
      return <EventCard eventId={card.eventId} messageId={messageId} />;
    case "win":
      return <WinCard card={card} authorId={authorId} authorName={authorName} />;
    case "learning":
      return <LearningCard card={card} authorId={authorId} authorName={authorName} />;
    case "link":
      return <LinkCard card={card} />;
  }
}
