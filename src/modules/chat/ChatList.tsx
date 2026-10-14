import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  BellOff,
  CheckCheck,
  MessageSquareText,
  MoreHorizontal,
  Pin,
  PinOff,
  Search,
  SquarePen,
  Users,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  markRead,
  useChatSearch,
  useChatTabs,
  useConversations,
  type ChatTab,
  type ConversationSummary,
} from "@/data";
import { ConversationAvatar } from "./avatars";
import { NewChatDialog, type NewChatMode } from "./NewChatDialog";
import { TAB_LABEL, togglePin } from "./chatTab";
import { listTime } from "./format";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-ring";
const TABS: ChatTab[] = ["groups", "direct"];

/**
 * The chat list: two tabs, Groups (team chats and side groups) and Direct
 * messages. Your pinned chats come first in each tab, then the rest by latest
 * message. "Unread only" filters the current tab; search looks across both.
 */
export function ChatList({
  selectedId,
  tab,
  onTab,
  className,
}: {
  selectedId?: string;
  tab: ChatTab;
  onTab: (t: ChatTab) => void;
  className?: string;
}) {
  const tabs = useChatTabs();
  const all = useConversations();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [newChat, setNewChat] = useState<NewChatMode | null>(null);
  const hits = useChatSearch(query);
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const rows = useMemo(
    () => (unreadOnly ? tabs[tab].filter((c) => c.unread > 0) : tabs[tab]),
    [tabs, tab, unreadOnly],
  );
  const found = useMemo(() => {
    if (!searching) return { groups: [], direct: [] };
    const match = all.filter(
      (c) => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q),
    );
    return {
      groups: match.filter((c) => c.tab === "groups"),
      direct: match.filter((c) => c.tab === "direct"),
    };
  }, [all, q, searching]);
  const messageHits = hits.filter((h) => h.kind === "message");
  const newMode: NewChatMode = tab === "direct" ? "dm" : "group";
  const newLabel = tab === "direct" ? "New message" : "New group";

  const pickTab = (t: ChatTab) => {
    if (searching) setQuery("");
    onTab(t);
  };
  const tabRefs = useRef<Record<ChatTab, HTMLButtonElement | null>>({ groups: null, direct: null });
  const onTabKey = (e: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next: ChatTab =
      e.key === "Home"
        ? "groups"
        : e.key === "End"
          ? "direct"
          : tab === "groups"
            ? "direct"
            : "groups";
    pickTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className={cn("grid content-start gap-2.5", className)}>
      <div className="flex items-center gap-2.5">
        <h1 className="text-[19px] font-extrabold leading-tight">Chats</h1>
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={newLabel}
              onClick={() => setNewChat(newMode)}
              className={cn(
                "grid size-[34px] place-items-center rounded-[10px] border border-line bg-surface text-foreground hover:bg-surface-2",
                FOCUS,
              )}
            >
              <SquarePen className="size-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{newLabel}</TooltipContent>
        </Tooltip>
      </div>

      <div
        role="tablist"
        aria-label="Chat lists"
        onKeyDown={onTabKey}
        className="flex gap-0.5 rounded-[10px] bg-surface-2 p-[3px]"
      >
        {TABS.map((t) => {
          const on = tab === t;
          const n = tabs.unread[t];
          return (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              type="button"
              role="tab"
              id={`chat-tab-${t}`}
              aria-selected={on}
              aria-controls="chat-list-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => pickTab(t)}
              className={cn(
                "inline-flex min-w-0 flex-auto items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground",
                on && "bg-surface text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              )}
            >
              <span className="truncate">{TAB_LABEL[t]}</span>
              {n > 0 && (
                <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-primary px-1 text-[10.5px] font-extrabold tabular-nums text-primary-foreground">
                  <span className="sr-only">, unread chats: </span>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats and messages"
          aria-label="Search chats and messages in both tabs"
          className="h-9 border-transparent bg-surface-2 pl-9 pr-8 text-[13px]"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-faint hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {!searching && (
        <div className="flex">
          <button
            type="button"
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
              unreadOnly
                ? "border-transparent bg-primary-soft text-primary-ink"
                : "border-line text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              FOCUS,
            )}
          >
            <CheckCheck className="size-3.5" aria-hidden="true" />
            Unread only
          </button>
        </div>
      )}

      <div id="chat-list-panel" role="tabpanel" aria-labelledby={`chat-tab-${tab}`}>
        <nav aria-label="Conversations" className="grid">
          {searching ? (
            <>
              {found.groups.length + found.direct.length + messageHits.length === 0 && (
                <EmptyState
                  className="mt-2"
                  title="Nothing matches your search"
                  body="Search looks through both tabs: chat names and messages."
                />
              )}
              {found.groups.length > 0 && <Label>{TAB_LABEL.groups}</Label>}
              <Rows rows={found.groups} selectedId={selectedId} />
              {found.direct.length > 0 && <Label>{TAB_LABEL.direct}</Label>}
              <Rows rows={found.direct} selectedId={selectedId} />
              {messageHits.length > 0 && (
                <>
                  <Label>Messages</Label>
                  {messageHits.map((h) => (
                    <Link
                      key={h.messageId}
                      to="/chats/$id"
                      params={{ id: h.conversationId }}
                      search={{ m: h.messageId }}
                      className={cn(
                        "grid gap-0.5 border-t border-line py-2 first:border-t-0 hover:bg-surface-2",
                        FOCUS,
                      )}
                    >
                      <span className="truncate text-xs font-semibold">{h.title}</span>
                      <span className="truncate text-xs text-muted-foreground">{h.snippet}</span>
                    </Link>
                  ))}
                </>
              )}
            </>
          ) : rows.length === 0 ? (
            <TabEmpty
              tab={tab}
              unreadOnly={unreadOnly && tabs[tab].length > 0}
              onShowAll={() => setUnreadOnly(false)}
              onNew={() => setNewChat(newMode)}
            />
          ) : (
            <Rows rows={rows} selectedId={selectedId} />
          )}
        </nav>
      </div>
      <NewChatDialog mode={newChat} onOpenChange={(o) => !o && setNewChat(null)} />
    </div>
  );
}

function TabEmpty({
  tab,
  unreadOnly,
  onShowAll,
  onNew,
}: {
  tab: ChatTab;
  unreadOnly: boolean;
  onShowAll: () => void;
  onNew: () => void;
}) {
  if (unreadOnly) {
    return (
      <EmptyState
        className="mt-2"
        icon={<CheckCheck aria-hidden="true" />}
        title="You're all caught up"
        body={`No unread chats in ${TAB_LABEL[tab]}.`}
        action={
          <Button size="sm" variant="outline" onClick={onShowAll}>
            Show all
          </Button>
        }
      />
    );
  }
  return tab === "direct" ? (
    <EmptyState
      className="mt-2"
      icon={<MessageSquareText aria-hidden="true" />}
      title="No direct messages yet"
      body="Start one with someone you share a chat with."
      action={
        <Button size="sm" onClick={onNew}>
          <SquarePen /> New message
        </Button>
      }
    />
  ) : (
    <EmptyState
      className="mt-2"
      icon={<Users aria-hidden="true" />}
      title="No groups yet"
      body="Start a group for a project, an event or a carpool."
      action={
        <Button size="sm" onClick={onNew}>
          <SquarePen /> New group
        </Button>
      }
    />
  );
}

function Label({ children }: { children: string }) {
  return (
    <div className="px-0 pb-1 pt-2.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint">
      {children}
    </div>
  );
}

function Rows({ rows, selectedId }: { rows: ConversationSummary[]; selectedId?: string }) {
  return (
    <>
      {rows.map((c, i) => (
        <Row
          key={c.id}
          c={c}
          selected={c.id === selectedId}
          divider={i > 0 && c.id !== selectedId && rows[i - 1]?.id !== selectedId}
        />
      ))}
    </>
  );
}

/**
 * One chat. Its menu (pin / unpin, mark as read) opens with a right-click on
 * desktop, a long press on phones, or the "more" button that appears on hover
 * and keyboard focus.
 */
function Row({
  c,
  selected,
  divider,
}: {
  c: ConversationSummary;
  selected: boolean;
  divider: boolean;
}) {
  const hasUnread = c.unread > 0;
  // A long press opens the menu; don't also follow the link when the finger lifts.
  const menuOpenedAt = useRef(0);
  const pinLabel = c.pinned ? "Unpin" : "Pin to top";
  return (
    <ContextMenu
      onOpenChange={(o) => {
        if (o) menuOpenedAt.current = Date.now();
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group/row relative select-none rounded-[10px] hover:bg-surface-2 [-webkit-touch-callout:none]",
            divider && "rounded-none border-t border-line hover:rounded-[10px]",
            selected && "-mx-2 bg-primary-soft px-2 hover:bg-primary-soft",
          )}
        >
          <Link
            to="/chats/$id"
            params={{ id: c.id }}
            aria-current={selected ? "page" : undefined}
            onClick={(e) => {
              if (Date.now() - menuOpenedAt.current < 1000) e.preventDefault();
            }}
            className={cn(
              "grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] py-2",
              FOCUS,
            )}
          >
            <ConversationAvatar summary={c} />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-bold">
                <span className="truncate">{c.title}</span>
                {c.pinned && (
                  <Pin className="size-[13px] shrink-0 text-faint" aria-label="Pinned" />
                )}
                {c.muted && (
                  <BellOff className="size-[13px] shrink-0 text-faint" aria-label="Muted" />
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {c.lastAuthor && (
                  <b className="font-semibold text-foreground">
                    {c.lastAuthor}
                    {": "}
                  </b>
                )}
                {c.preview}
              </div>
            </div>
            <div
              className={cn(
                "grid justify-items-end gap-1 text-[11px] text-faint",
                hasUnread && !c.muted && "font-bold text-primary",
              )}
            >
              {/* The "more" button takes the time's place on hover and keyboard focus. */}
              <span className="group-hover/row:invisible group-has-[:focus-visible]/row:invisible group-has-[[data-state=open]]/row:invisible">
                {c.lastMessage ? listTime(c.lastAt) : ""}
              </span>
              {c.pendingDrafts > 0 ? (
                <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-bold text-warn-ink">
                  {c.pendingDrafts} {c.pendingDrafts === 1 ? "draft" : "drafts"}
                </span>
              ) : hasUnread ? (
                <span
                  className={cn(
                    "grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-extrabold",
                    c.muted
                      ? "bg-surface-2 text-muted-foreground"
                      : "bg-primary text-primary-foreground",
                  )}
                >
                  <span className="sr-only">Unread messages: </span>
                  {c.unread}
                </span>
              ) : null}
            </div>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More for ${c.title}`}
                className={cn(
                  "invisible absolute right-0 top-1.5 grid size-6 place-items-center rounded-md border border-line bg-surface text-muted-foreground shadow-sm hover:text-foreground group-hover/row:visible group-has-[:focus-visible]/row:visible data-[state=open]:visible",
                  selected && "right-2",
                  FOCUS,
                )}
              >
                <MoreHorizontal className="size-3.5" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => togglePin(c)}>
                {c.pinned ? <PinOff /> : <Pin />} {pinLabel}
              </DropdownMenuItem>
              {hasUnread && (
                <DropdownMenuItem onSelect={() => markRead(c.id)}>
                  <CheckCheck /> Mark as read
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={() => togglePin(c)}>
          {c.pinned ? <PinOff /> : <Pin />} {pinLabel}
        </ContextMenuItem>
        {hasUnread && (
          <ContextMenuItem onSelect={() => markRead(c.id)}>
            <CheckCheck /> Mark as read
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
