import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BellOff, MessageSquareText, Pin, Search, SquarePen, Users, X } from "lucide-react";
import { EmptyState } from "@/components/brand";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useChatSearch, useConversations, type ConversationSummary } from "@/data";
import { ConversationAvatar } from "./avatars";
import { NewChatDialog, type NewChatMode } from "./NewChatDialog";
import { listTime } from "./format";

type Filter = "all" | "unread" | "groups" | "direct";

/**
 * The chat list: pinned team chats first, then groups and DMs by recency.
 * Search filters chats and finds messages; chips filter by kind.
 */
export function ChatList({
  selectedId,
  sectionLabels,
  className,
}: {
  selectedId?: string;
  /** Show "Team" / "Groups and direct" labels (desktop). */
  sectionLabels?: boolean;
  className?: string;
}) {
  const all = useConversations();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [newChat, setNewChat] = useState<NewChatMode | null>(null);
  const hits = useChatSearch(query);

  const counts = useMemo(
    () => ({
      unread: all.filter((c) => c.unread > 0).length,
      groups: all.filter((c) => c.conversation.kind !== "dm").length,
      direct: all.filter((c) => c.conversation.kind === "dm").length,
    }),
    [all],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((c) => {
      if (filter === "unread" && c.unread === 0) return false;
      if (filter === "groups" && c.conversation.kind === "dm") return false;
      if (filter === "direct" && c.conversation.kind !== "dm") return false;
      if (q && !c.title.toLowerCase().includes(q) && !c.preview.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [all, filter, query]);
  const messageHits = hits.filter((h) => h.kind === "message");
  const team = rows.filter((r) => r.team);
  const rest = rows.filter((r) => !r.team);

  const chips: { value: Filter; label: string; count?: number }[] = [
    { value: "all", label: "All" },
    { value: "unread", label: "Unread", count: counts.unread },
    { value: "groups", label: "Groups", count: counts.groups },
    { value: "direct", label: "Direct", count: counts.direct },
  ];

  return (
    <div className={cn("grid content-start gap-2.5", className)}>
      <div className="flex items-center gap-2.5">
        <h1 className="text-[19px] font-extrabold leading-tight lg:text-[19px]">Chats</h1>
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="New chat"
              className="grid size-[34px] place-items-center rounded-[10px] border border-line bg-surface text-foreground hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <SquarePen className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => setNewChat("group")}>
              <Users /> New group
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setNewChat("dm")}>
              <MessageSquareText /> New direct message
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
          aria-label="Search chats and messages"
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

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter chats">
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={filter === c.value}
            onClick={() => setFilter(c.value)}
            className={cn(
              "rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring",
              filter === c.value &&
                "border-foreground bg-foreground text-surface hover:bg-foreground",
            )}
          >
            {c.label}
            {c.count ? <span className="ml-1 tabular-nums">{c.count}</span> : null}
          </button>
        ))}
      </div>

      <nav aria-label="Conversations" className="grid">
        {rows.length === 0 && messageHits.length === 0 && (
          <EmptyState
            className="mt-2"
            title={query ? "Nothing matches your search" : "No chats here"}
            body={
              filter === "unread" ? "You're all caught up." : "Start a group or a direct message."
            }
          />
        )}
        {sectionLabels && team.length > 0 && <Label>Team</Label>}
        <Rows rows={team} selectedId={selectedId} />
        {sectionLabels && rest.length > 0 && <Label>Groups and direct</Label>}
        <Rows
          rows={rest}
          selectedId={selectedId}
          dividerFirst={!sectionLabels && team.length > 0}
        />
        {messageHits.length > 0 && (
          <>
            <Label>Messages</Label>
            {messageHits.map((h) => (
              <Link
                key={h.messageId}
                to="/chats/$id"
                params={{ id: h.conversationId }}
                search={{ m: h.messageId }}
                className="grid gap-0.5 border-t border-line py-2 first:border-t-0 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="truncate text-xs font-semibold">{h.title}</span>
                <span className="truncate text-xs text-muted-foreground">{h.snippet}</span>
              </Link>
            ))}
          </>
        )}
      </nav>
      <NewChatDialog mode={newChat} onOpenChange={(o) => !o && setNewChat(null)} />
    </div>
  );
}

function Label({ children }: { children: string }) {
  return (
    <div className="px-0 pb-1 pt-2.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint">
      {children}
    </div>
  );
}

function Rows({
  rows,
  selectedId,
  dividerFirst,
}: {
  rows: ConversationSummary[];
  selectedId?: string;
  dividerFirst?: boolean;
}) {
  return (
    <>
      {rows.map((c, i) => (
        <Row
          key={c.id}
          c={c}
          selected={c.id === selectedId}
          divider={
            (i > 0 || !!dividerFirst) && c.id !== selectedId && rows[i - 1]?.id !== selectedId
          }
        />
      ))}
    </>
  );
}

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
  return (
    <Link
      to="/chats/$id"
      params={{ id: c.id }}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] py-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring",
        divider && "rounded-none border-t border-line hover:rounded-[10px]",
        selected && "-mx-2 bg-primary-soft px-2 hover:bg-primary-soft",
      )}
    >
      <ConversationAvatar summary={c} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-bold">
          <span className="truncate">{c.title}</span>
          {c.team && <Pin className="size-[13px] shrink-0 text-faint" aria-label="Pinned" />}
          {c.muted && <BellOff className="size-[13px] shrink-0 text-faint" aria-label="Muted" />}
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
        <span>{c.lastMessage ? listTime(c.lastAt) : ""}</span>
        {c.pendingDrafts > 0 ? (
          <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-bold text-warn-ink">
            {c.pendingDrafts} {c.pendingDrafts === 1 ? "draft" : "drafts"}
          </span>
        ) : hasUnread ? (
          <span
            className={cn(
              "grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-extrabold",
              c.muted ? "bg-surface-2 text-muted-foreground" : "bg-primary text-primary-foreground",
            )}
          >
            <span className="sr-only">Unread messages: </span>
            {c.unread}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
