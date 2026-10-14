import { Fragment, memo, type ReactNode } from "react";
import {
  Ban,
  ChevronDown,
  Copy,
  CornerUpLeft,
  Flag,
  Link2,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
import { PersonAvatar, STAGE_LABEL } from "@/components/brand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  canDeleteMessage,
  canEditMessage,
  toggleReaction,
  workspaceRoleLabel,
  type ChatPerson,
  type MessageView,
} from "@/data";
import { isActivityCard, MessageCardView } from "./cards";
import { ImageThumb, VoicePlayer } from "./media";
import { clockTime } from "./format";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "🔥", "🙌"];

export type MessageAction =
  "reply" | "edit" | "delete" | "copy" | "link" | "report" | "block" | "pin" | "unpin";

/** Leader / Moderator for team roles, else the business stage. */
function roleTag(p: ChatPerson | undefined): string | undefined {
  if (!p) return undefined;
  if (p.role === "leader" || p.role === "moderator") return workspaceRoleLabel(p.role);
  return STAGE_LABEL[p.stage];
}

/** Message text with @mentions highlighted. */
function Body({ text, mentionNames }: { text: string; mentionNames: string[] }) {
  if (!mentionNames.length) return <>{text}</>;
  const esc = mentionNames
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(@(?:${esc.join("|")}))`, "gi"));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="rounded bg-info-soft px-0.5 font-semibold text-info-ink">
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export interface BubbleProps {
  m: MessageView;
  meId: string;
  people: Map<string, ChatPerson>;
  /** Show avatar + name (first of a run, not in DMs). */
  showAuthor: boolean;
  /** Show the avatar column at all (not in DMs). */
  avatars: boolean;
  moderator: boolean;
  canPin: boolean;
  highlighted: boolean;
  onAction: (action: MessageAction, m: MessageView) => void;
  onJump: (messageId: string) => void;
}

/** One message: bubble, quote, cards, media, reactions and the actions menu. */
export const MessageBubble = memo(function MessageBubble({
  m,
  meId,
  people,
  showAuthor,
  avatars,
  moderator,
  canPin,
  highlighted,
  onAction,
  onJump,
}: BubbleProps) {
  const authorName = m.author?.name ?? "Former member";
  const deleted = !!m.deletedAt;
  const own = m.mine;
  const mentionNames = m.mentionIds.map((id) => people.get(id)?.name).filter(Boolean) as string[];

  let content: ReactNode;
  if (deleted) {
    content = <span className="italic text-faint">Message deleted</span>;
  } else if (m.blocked) {
    content = <span className="italic text-faint">Message from someone you blocked</span>;
  } else {
    content = (
      <>
        {m.replyTo && (
          <button
            type="button"
            onClick={() => !m.replyTo!.deleted && onJump(m.replyTo!.id)}
            className={cn(
              "grid min-w-0 gap-0.5 rounded-[10px] border border-line px-2 py-1.5 text-left text-xs",
              own ? "bg-surface" : "bg-surface-2",
              !m.replyTo.deleted &&
                "hover:border-primary focus-visible:outline-2 focus-visible:outline-ring",
            )}
            aria-label={`Replying to ${m.replyTo.authorName}. Go to the original message`}
          >
            <span className="flex items-center gap-1 text-[11px] font-bold text-primary-ink">
              <CornerUpLeft className="size-3" aria-hidden="true" />
              {m.replyTo.authorName.split(" ")[0]}
              {m.replyTo.at && ` · ${format(new Date(m.replyTo.at), "MMM d")}`}
            </span>
            <span className="truncate text-muted-foreground">{m.replyTo.preview}</span>
          </button>
        )}
        {m.card && (
          <MessageCardView
            card={m.card}
            messageId={m.id}
            authorId={m.authorId}
            authorName={authorName}
          />
        )}
        {m.attachments.map((a) =>
          a.kind === "voice" ? (
            <VoicePlayer key={a.id} attachment={a} label={`voice note from ${authorName}`} />
          ) : a.kind === "image" ? (
            <ImageThumb key={a.id} attachment={a} alt={`Photo from ${authorName}`} />
          ) : null,
        )}
        {m.body && (
          <p className="whitespace-pre-wrap break-words">
            <Body text={m.body} mentionNames={mentionNames} />
          </p>
        )}
      </>
    );
  }

  const tag = roleTag(m.author);
  // Activity posts (wins, learning) get a 5px gold band on the bubble edge
  // away from the screen edge: right for others, left for your own.
  const activity = !deleted && !m.blocked && isActivityCard(m.card);
  return (
    <div
      id={`msg-${m.id}`}
      className={cn(
        "group grid items-end gap-2 scroll-mt-16",
        own ? "justify-items-end" : avatars ? "grid-cols-[28px_minmax(0,1fr)]" : "",
        highlighted && "chat-flash",
      )}
    >
      {!own && avatars && (
        <span className="self-start pt-0.5">
          {showAuthor ? (
            <PersonAvatar name={authorName} stage={m.author?.stage} size="sm" className="size-7" />
          ) : null}
        </span>
      )}
      <div className={cn("grid min-w-0 max-w-[min(440px,88%)] gap-1", own && "justify-items-end")}>
        <div className={cn("flex min-w-0 items-start gap-1", own && "flex-row-reverse")}>
          <div
            className={cn(
              "relative grid min-w-0 gap-1.5 border px-[11px] py-2 text-[13px]",
              own
                ? "rounded-[14px_14px_4px_14px] border-transparent bg-primary-soft"
                : "rounded-[14px_14px_14px_4px] border-line bg-surface",
              deleted && "bg-transparent",
              // Activity posts: a gold band on the bubble's inner edge (clipped by its corners).
              activity && "overflow-hidden",
              activity && (own ? "pl-4" : "pr-4"),
            )}
          >
            {showAuthor && !own && avatars && (
              <div className="flex items-center gap-1.5 text-[11.5px] font-bold">
                <span
                  className={
                    m.author?.stage === "apprentice" ? "text-primary-ink" : "text-foreground"
                  }
                >
                  {authorName}
                </span>
                {tag && <small className="font-medium text-faint">{tag}</small>}
              </div>
            )}
            {activity && (
              <span
                aria-hidden="true"
                className={cn("absolute inset-y-0 w-[5px] bg-amber", own ? "left-0" : "right-0")}
              />
            )}
            {content}
            <span
              className={cn(
                "flex items-center justify-end gap-1 text-[10.5px]",
                // Own bubbles are tinted (primary-soft); faint text is below AA there.
                own ? "text-muted-foreground" : "text-faint",
              )}
            >
              {m.pinned && <Pin className="size-3 text-amber-strong" aria-label="Pinned" />}
              {m.editedAt && !deleted && <span>edited ·</span>}
              <time dateTime={m.createdAt} title={format(new Date(m.createdAt), "PPpp")}>
                {clockTime(m.createdAt)}
              </time>
            </span>
          </div>
          {!deleted && (
            <MessageMenu
              m={m}
              meId={meId}
              moderator={moderator}
              canPin={canPin}
              onAction={onAction}
            />
          )}
        </div>
        {m.reactions.length > 0 && !deleted && (
          <div className={cn("flex flex-wrap gap-1", own && "justify-end")}>
            {m.reactions.map((r) => (
              <Tooltip key={r.emoji}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={r.mine}
                    aria-label={`${r.emoji} ${r.count}: ${r.names.join(", ")}. ${r.mine ? "Remove your reaction" : "React"}`}
                    onClick={() => toggleReaction(m.id, r.emoji)}
                    className={cn(
                      "rounded-full border border-line bg-surface px-2 py-px text-[11px] font-bold tabular-nums hover:border-primary focus-visible:outline-2 focus-visible:outline-ring",
                      r.mine && "border-primary bg-primary-soft text-primary-ink",
                    )}
                  >
                    {r.emoji} {r.count}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{r.names.join(", ")}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

function MessageMenu({
  m,
  meId,
  moderator,
  canPin,
  onAction,
  className,
}: {
  m: MessageView;
  meId: string;
  moderator: boolean;
  canPin: boolean;
  onAction: (a: MessageAction, m: MessageView) => void;
  className?: string;
}) {
  const own = m.authorId === meId;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Message actions"
          className={cn(
            "mt-1 grid size-7 shrink-0 place-items-center rounded-full text-faint hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:opacity-100 lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100",
            className,
          )}
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={own ? "end" : "start"} className="w-56">
        {!m.blocked && (
          <>
            <div className="flex justify-between gap-0.5 px-1 py-1" role="group" aria-label="React">
              {QUICK_REACTIONS.map((e) => {
                const mine = m.reactions.some((r) => r.emoji === e && r.mine);
                return (
                  <DropdownMenuItem
                    key={e}
                    onSelect={() => toggleReaction(m.id, e)}
                    aria-label={`${mine ? "Remove" : "React with"} ${e}`}
                    className={cn(
                      "size-8 justify-center rounded-full p-0 text-base",
                      mine && "bg-primary-soft",
                    )}
                  >
                    {e}
                  </DropdownMenuItem>
                );
              })}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction("reply", m)}>
              <CornerUpLeft /> Reply
            </DropdownMenuItem>
            {m.body && (
              <DropdownMenuItem onSelect={() => onAction("copy", m)}>
                <Copy /> Copy text
              </DropdownMenuItem>
            )}
          </>
        )}
        <DropdownMenuItem onSelect={() => onAction("link", m)}>
          <Link2 /> Copy link to message
        </DropdownMenuItem>
        {canEditMessage(meId, m) && (m.body || !m.card) && (
          <DropdownMenuItem onSelect={() => onAction("edit", m)}>
            <Pencil /> Edit
          </DropdownMenuItem>
        )}
        {canPin && (
          <DropdownMenuItem onSelect={() => onAction(m.pinned ? "unpin" : "pin", m)}>
            {m.pinned ? <PinOff /> : <Pin />} {m.pinned ? "Unpin" : "Pin to top"}
          </DropdownMenuItem>
        )}
        {canDeleteMessage(meId, m, moderator) && (
          <DropdownMenuItem
            onSelect={() => onAction("delete", m)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 /> {own ? "Delete" : "Remove message"}
          </DropdownMenuItem>
        )}
        {!own && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction("report", m)}>
              <Flag /> Report
            </DropdownMenuItem>
            {!m.blocked && (
              <DropdownMenuItem onSelect={() => onAction("block", m)}>
                <Ban /> Block {m.author?.name.split(" ")[0] ?? "author"}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
