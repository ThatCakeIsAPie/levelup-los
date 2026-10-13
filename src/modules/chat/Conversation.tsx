import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Ban, Check, ChevronLeft, Megaphone, PanelRight, Pin, Search, X } from "lucide-react";
import { EmptyState, PersonAvatar, StageChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  approveDraft,
  blockPerson,
  deleteMessage,
  markRead,
  pinMessage,
  rejectDraft,
  reportMessage,
  submitAnnouncement,
  unblockPerson,
  useAnnouncementDrafts,
  useChatAccess,
  useChatPeople,
  useConversation,
  useConversationMembers,
  useMessages,
  useMyDrafts,
  type ConversationSummary,
  type MessageView,
} from "@/data";
import { ConversationAvatar } from "./avatars";
import { Composer } from "./Composer";
import { MessageBubble, type MessageAction } from "./MessageBubble";
import { dayKey, dayLabel, messageUrl, plural, shortAgo } from "./format";
import "./chat.css";

/** Messages from the same author within this window share one name/avatar. */
const RUN_MS = 5 * 60 * 1000;

export function ConversationView({
  id,
  focusMessageId,
  onBack,
  onDetails,
  detailsOpen,
}: {
  id: string;
  focusMessageId?: string;
  /** Phone: show a back button to the list. */
  onBack?: boolean;
  /** Open/close the details panel (desktop) or sheet (phone). */
  onDetails: () => void;
  detailsOpen?: boolean;
}) {
  const conv = useConversation(id);
  if (!conv) {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <EmptyState
          title="Chat not found"
          body="It may have been deleted, or you're not a member."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/chats">Back to chats</Link>
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <ConversationBody
      key={conv.id}
      conv={conv}
      focusMessageId={focusMessageId}
      onBack={onBack}
      onDetails={onDetails}
      detailsOpen={detailsOpen}
    />
  );
}

function ConversationBody({
  conv,
  focusMessageId,
  onBack,
  onDetails,
  detailsOpen,
}: {
  conv: ConversationSummary;
  focusMessageId?: string;
  onBack?: boolean;
  onDetails: () => void;
  detailsOpen?: boolean;
}) {
  const access = useChatAccess();
  const meId = access.personId;
  const messages = useMessages(conv.id);
  const members = useConversationMembers(conv.id);
  const people = useChatPeople();
  const [replyTo, setReplyTo] = useState<MessageView | null>(null);
  const [editing, setEditing] = useState<MessageView | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState<{ kind: "delete" | "block"; m: MessageView } | null>(null);
  const [reporting, setReporting] = useState<MessageView | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const threadBody = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Where "New messages" starts: your read position when you opened the chat.
  const [readFrom] = useState(conv.me.lastReadAt);

  const isAnnouncements = conv.conversation.kind === "announcements";
  const isDm = conv.conversation.kind === "dm";
  const canPostHere = !isAnnouncements || access.canReview;
  const canPin = isDm || conv.canModerate;

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term
      ? messages.filter((m) => !m.deletedAt && m.body.toLowerCase().includes(term))
      : messages;
  }, [messages, q]);
  const firstUnread = useMemo(
    () =>
      q
        ? undefined
        : messages.find((m) => !m.mine && !m.deletedAt && (!readFrom || m.createdAt > readFrom))
            ?.id,
    [messages, readFrom, q],
  );
  const pinned = messages.find((m) => m.pinned && !m.deletedAt);

  // Read state: mark read on open and whenever new messages arrive while visible.
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (document.visibilityState === "visible") markRead(conv.id);
    const onVis = () => document.visibilityState === "visible" && markRead(conv.id);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [conv.id, lastId]);

  const jump = useCallback(
    (messageId: string) => {
      if (q && !shown.some((m) => m.id === messageId)) setQ("");
      requestAnimationFrame(() => {
        const el = document.getElementById(`msg-${messageId}`);
        if (!el) {
          toast("That message is no longer here.");
          return;
        }
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setHighlight(null);
        requestAnimationFrame(() => setHighlight(messageId));
      });
    },
    [q, shown],
  );

  // First paint: jump to a linked message, else to the first unread, else the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (focusMessageId && document.getElementById(`msg-${focusMessageId}`)) {
      document.getElementById(`msg-${focusMessageId}`)!.scrollIntoView({ block: "center" });
      setHighlight(focusMessageId);
      stick.current = false;
    } else if (firstUnread) {
      document.getElementById("new-messages")?.scrollIntoView({ block: "start" });
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    } else {
      el.scrollTop = el.scrollHeight;
    }
    // Only on open (and when the linked message changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId]);

  // Keep pinned to the bottom when new messages arrive and you're already there.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  // Cards, images and reactions can grow (and the pane can shrink, e.g. under a
  // draft-approval panel) after the first paint; stay at the bottom if you were
  // there (otherwise the last message and its reactions end up hidden).
  useEffect(() => {
    const el = scroller.current;
    const body = threadBody.current;
    if (!el || !body || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(body);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), 2300);
    return () => clearTimeout(t);
  }, [highlight]);

  const onAction = useCallback((a: MessageAction, m: MessageView) => {
    switch (a) {
      case "reply":
        setEditing(null);
        setReplyTo(m);
        break;
      case "edit":
        setReplyTo(null);
        setEditing(m);
        break;
      case "copy":
        void navigator.clipboard
          ?.writeText(m.body)
          .then(() => toast.success("Copied"))
          .catch(() => toast.error("Couldn't copy"));
        break;
      case "link":
        void navigator.clipboard
          ?.writeText(messageUrl(m.conversationId, m.id))
          .then(() => toast.success("Link to message copied"))
          .catch(() => toast.error("Couldn't copy the link"));
        break;
      case "pin":
      case "unpin":
        if (pinMessage(m.conversationId, a === "pin" ? m.id : null)) {
          toast.success(a === "pin" ? "Pinned to the top of the chat" : "Unpinned");
        }
        break;
      case "delete":
      case "block":
        setConfirm({ kind: a, m });
        break;
      case "report":
        setReporting(m);
        break;
    }
  }, []);

  const subtitle = isDm ? null : (
    <>
      {conv.conversation.description ? `${conv.conversation.description} · ` : ""}
      {plural(conv.memberCount, "member")}
    </>
  );

  return (
    <section
      aria-label={conv.title}
      className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-2.5 px-3 pb-3 pt-2 sm:px-5 lg:pt-3.5"
    >
      {/* Header */}
      <header className="grid gap-2 border-b border-line pb-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {onBack && (
            <Link
              to="/chats"
              aria-label="Back to chats"
              className="-ml-1 grid size-9 shrink-0 place-items-center rounded-full hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Link>
          )}
          <button
            type="button"
            onClick={onDetails}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={`${conv.title}: chat details`}
          >
            <ConversationAvatar summary={conv} className={onBack ? "size-[34px]" : undefined} />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-extrabold">{conv.title}</span>
              <span className="flex min-w-0 items-center gap-1.5 truncate text-[11.5px] text-muted-foreground">
                {isDm && conv.other ? (
                  <>
                    <StageChip stage={conv.other.stage} />
                    Direct message
                  </>
                ) : (
                  <span className="truncate">{subtitle}</span>
                )}
              </span>
            </span>
          </button>
          <IconButton
            label={searchOpen ? "Close search" : "Search in chat"}
            onClick={() => {
              setSearchOpen((o) => !o);
              setQ("");
            }}
            pressed={searchOpen}
          >
            <Search className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Chat details" onClick={onDetails} pressed={detailsOpen}>
            <PanelRight className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
        {searchOpen && (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search in ${conv.title}`}
              aria-label={`Search in ${conv.title}`}
              className="h-8 text-[13px]"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchOpen(false);
                  setQ("");
                }
              }}
            />
            {q && (
              <span className="shrink-0 text-xs text-muted-foreground" role="status">
                {plural(shown.length, "match", "matches")}
              </span>
            )}
          </div>
        )}
        {pinned && !q && (
          <button
            type="button"
            onClick={() => jump(pinned.id)}
            className="flex min-w-0 items-center gap-2 rounded-[10px] bg-surface-2 px-2.5 py-1.5 text-left text-[11.5px] text-muted-foreground hover:bg-line focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Pin className="size-[13px] shrink-0 text-amber-strong" aria-hidden="true" />
            <span className="truncate">
              <b className="font-semibold text-foreground">Pinned:</b> {pinned.body || "Post"}
            </span>
          </button>
        )}
      </header>

      {/* Thread */}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="-mx-3 min-h-0 overflow-y-auto overflow-x-hidden px-3 sm:-mx-5 sm:px-5"
        role="log"
        aria-label={`Messages in ${conv.title}`}
        aria-live="polite"
        aria-relevant="additions"
      >
        <div ref={threadBody} className="grid content-start gap-2.5 pb-2">
          {isAnnouncements && access.canReview && <DraftsPanel />}
          {shown.length === 0 && (
            <EmptyState
              className="mt-6"
              title={q ? "No messages match" : "No messages yet"}
              body={q ? undefined : "Say hello to get things going."}
            />
          )}
          {shown.map((m, i) => {
            const prev = shown[i - 1];
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            const run =
              !!prev &&
              !newDay &&
              prev.authorId === m.authorId &&
              Date.parse(m.createdAt) - Date.parse(prev.createdAt) < RUN_MS;
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <span className="justify-self-center rounded-full bg-surface-2 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                    {dayLabel(m.createdAt)}
                  </span>
                )}
                {m.id === firstUnread && (
                  <div
                    id="new-messages"
                    className="flex scroll-mt-4 items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-primary"
                  >
                    <span className="h-px flex-1 bg-primary/40" />
                    New messages
                    <span className="h-px flex-1 bg-primary/40" />
                  </div>
                )}
                <MessageBubble
                  m={m}
                  meId={meId}
                  people={people}
                  showAuthor={!run || m.id === firstUnread}
                  avatars={!isDm}
                  moderator={conv.canModerate}
                  canPin={canPin}
                  highlighted={highlight === m.id}
                  onAction={onAction}
                  onJump={jump}
                />
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Composer, or what replaces it */}
      {conv.blocked === "me" && conv.other ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5 text-[12.5px] text-muted-foreground">
          <span className="flex items-center gap-2">
            <Ban className="size-4" aria-hidden="true" />
            You blocked {conv.other.name}.
          </span>
          <Button size="sm" variant="outline" onClick={() => unblockPerson(conv.other!.id)}>
            Unblock
          </Button>
        </div>
      ) : conv.blocked === "them" ? (
        <p className="border-t border-line pt-2.5 text-[12.5px] text-muted-foreground">
          You can't reply to this conversation.
        </p>
      ) : canPostHere ? (
        <Composer
          conv={conv}
          members={members}
          meId={meId}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onSent={() => {
            stick.current = true;
          }}
        />
      ) : (
        <SuggestBar />
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          {confirm?.kind === "delete" ? (
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirm.m.mine ? "Delete this message?" : "Remove this message?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirm.m.mine
                  ? "It's replaced by “Message deleted” for everyone. This can't be undone."
                  : `As a moderator you're removing ${confirm.m.author?.name ?? "someone"}'s message for everyone. This can't be undone.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
          ) : (
            <AlertDialogHeader>
              <AlertDialogTitle>Block {confirm?.m.author?.name ?? "this person"}?</AlertDialogTitle>
              <AlertDialogDescription>
                Their messages are hidden for you and neither of you can send direct messages to the
                other. They aren't told. You can unblock them in the chat details or Team settings.
              </AlertDialogDescription>
            </AlertDialogHeader>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!confirm) return;
                if (confirm.kind === "delete") {
                  if (deleteMessage(confirm.m.id)) toast.success("Message deleted");
                } else {
                  blockPerson(confirm.m.authorId);
                  toast.success(`${confirm.m.author?.name ?? "They"} blocked`);
                }
              }}
            >
              {confirm?.kind === "delete" ? "Delete" : "Block"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ReportDialog message={reporting} onOpenChange={(o) => !o && setReporting(null)} />
    </section>
  );
}

function IconButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={pressed}
          className={cn(
            "grid size-[34px] shrink-0 place-items-center rounded-[10px] border border-line bg-surface hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring",
            pressed && "bg-primary-soft text-primary-ink",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Announcements: drafts (reviewers) and suggestions (members)
// ---------------------------------------------------------------------------

function DraftsPanel() {
  const drafts = useAnnouncementDrafts();
  const people = useChatPeople();
  if (!drafts.length) return null;
  return (
    <section
      aria-label="Drafts waiting for approval"
      className="grid gap-2 rounded-card border border-line bg-warn-soft/50 p-3"
    >
      <h2 className="text-[12.5px] font-bold text-warn-ink">
        {plural(drafts.length, "draft")} waiting for approval
      </h2>
      {drafts.map((d) => {
        const author = people.get(d.authorId);
        return (
          <div key={d.id} className="grid gap-2 rounded-xl border border-line bg-surface p-3">
            <div className="flex items-center gap-2 text-xs">
              <PersonAvatar name={author?.name ?? "?"} stage={author?.stage} size="sm" />
              <b className="font-bold">{author?.name ?? "Someone"}</b>
              <span className="text-faint">· {shortAgo(d.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-[13px]">{d.body}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  if (approveDraft(d.id)) toast.success("Approved and posted");
                }}
              >
                <Check /> Approve and post
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (rejectDraft(d.id)) toast("Draft rejected");
                }}
              >
                <X /> Reject
              </Button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function SuggestBar() {
  const mine = useMyDrafts();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const latest = mine[0];
  return (
    <div className="grid gap-2 border-t border-line pt-2.5">
      {latest && (
        <p className="text-[12px] text-muted-foreground" role="status">
          Your suggestion from {shortAgo(latest.createdAt)} ago:{" "}
          <b
            className={cn(
              "font-semibold",
              latest.status === "approved"
                ? "text-good"
                : latest.status === "rejected"
                  ? "text-bad"
                  : "text-warn-ink",
            )}
          >
            {latest.status === "pending"
              ? "waiting for approval"
              : latest.status === "approved"
                ? "approved and posted"
                : "not approved"}
          </b>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] text-muted-foreground">
          Only leaders and moderators post here.
        </span>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Megaphone /> Suggest an announcement
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-card">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const r = submitAnnouncement({ body });
              if (r?.draft) {
                toast.success("Sent for approval", {
                  description: "A leader or moderator will review it.",
                });
                setBody("");
                setOpen(false);
              } else if (r?.posted) {
                setBody("");
                setOpen(false);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Suggest an announcement</DialogTitle>
              <DialogDescription>
                A leader or moderator approves it before it's posted to everyone.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="suggest-body" className="text-xs font-semibold">
                Announcement
              </Label>
              <Textarea
                id="suggest-body"
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="e.g. Carpool sign-up for the Fall Weekend is open…"
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!body.trim()}>
                Send for approval
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const REASONS = ["Spam", "Harassment or bullying", "Inappropriate content", "Other"];

function ReportDialog({
  message,
  onOpenChange,
}: {
  message: MessageView | null;
  onOpenChange: (o: boolean) => void;
}) {
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState("");
  return (
    <Dialog open={!!message} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-card">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!message) return;
            const text = details.trim() ? `${reason}: ${details.trim()}` : reason;
            if (reportMessage(message.id, text)) {
              toast.success("Reported", {
                description: "Your team leader will review it.",
              });
              setDetails("");
              onOpenChange(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Report this message</DialogTitle>
            <DialogDescription>
              Your team leader reviews reports and can remove the message.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={reason} onValueChange={setReason} aria-label="Reason">
            {REASONS.map((r) => (
              <div key={r} className="flex items-center gap-2">
                <RadioGroupItem id={`reason-${r}`} value={r} />
                <Label htmlFor={`reason-${r}`} className="text-[13px] font-medium">
                  {r}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <div className="grid gap-1.5">
            <Label htmlFor="report-details" className="text-xs font-semibold">
              Details (optional)
            </Label>
            <Textarea
              id="report-details"
              rows={2}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Report</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
