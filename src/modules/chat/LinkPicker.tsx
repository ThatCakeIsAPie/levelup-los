import { useMemo, useState } from "react";
import { CalendarDays, MessageSquareQuote } from "lucide-react";
import { PersonAvatar } from "@/components/brand";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  messagePreview,
  useChatPeople,
  useConversations,
  useEvents,
  useCatalog,
  useMessageIndex,
  useVisibleTeam,
  type LinkTargetKind,
} from "@/data";
import { dateRange } from "@/modules/dashboard/format";
import { KIND_ICON } from "@/modules/library/icons";
import { materialMeta } from "./cards";

/**
 * "Link something": search messages, events, people (only those you may see)
 * and library material; picking one attaches a link card to the message.
 */
export function LinkPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (target: { kind: LinkTargetKind; id: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const index = useMessageIndex();
  const convs = useConversations();
  const people = useChatPeople();
  const events = useEvents();
  const team = useVisibleTeam();
  const library = useCatalog();

  const titles = useMemo(() => new Map(convs.map((c) => [c.id, c.title])), [convs]);
  const messages = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...index.values()]
      .filter((m) => !m.deletedAt && m.body && (!q || m.body.toLowerCase().includes(q)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, q ? 20 : 6);
  }, [index, query]);

  const pick = (kind: LinkTargetKind, id: string) => {
    onPick({ kind, id });
    onOpenChange(false);
    setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg gap-0 overflow-hidden rounded-card p-0">
        <DialogTitle className="sr-only">Link something</DialogTitle>
        <DialogDescription className="sr-only">
          Search messages, events, people and library material to link in your message.
        </DialogDescription>
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search messages, events, people, library…"
          />
          <CommandList className="max-h-[60dvh]">
            <CommandEmpty>Nothing found.</CommandEmpty>
            {messages.length > 0 && (
              <CommandGroup heading="Messages">
                {messages.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`m-${m.id}`}
                    onSelect={() => pick("message", m.id)}
                  >
                    <MessageSquareQuote aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="truncate text-[13px]">{messagePreview(m)}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {people.get(m.authorId)?.name ?? "Someone"} · {titles.get(m.conversationId)}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <Group
              heading="Events"
              items={events
                .filter((e) => match(query, e.name))
                .slice(-6)
                .reverse()}
              render={(e) => (
                <CommandItem key={e.id} value={`e-${e.id}`} onSelect={() => pick("event", e.id)}>
                  <CalendarDays aria-hidden="true" />
                  <span className="truncate">{e.name}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                    {dateRange(e)}
                  </span>
                </CommandItem>
              )}
            />
            <Group
              heading="People"
              items={team.filter((p) => match(query, p.name)).slice(0, query ? 12 : 5)}
              render={(p) => (
                <CommandItem key={p.id} value={`p-${p.id}`} onSelect={() => pick("person", p.id)}>
                  <PersonAvatar name={p.name} stage={p.bizClass} size="sm" />
                  <span className="truncate">{p.name}</span>
                </CommandItem>
              )}
            />
            <Group
              heading="Library"
              items={library.filter((l) => match(query, l.title))}
              render={(l) => {
                const Icon = KIND_ICON[l.kind];
                return (
                  <CommandItem
                    key={l.id}
                    value={`l-${l.id}`}
                    onSelect={() => pick("material", l.id)}
                  >
                    <Icon aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="truncate text-[13px]">{l.title}</div>
                      <div className="text-[11px] text-muted-foreground">{materialMeta(l)}</div>
                    </div>
                  </CommandItem>
                );
              }}
            />
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

const match = (q: string, s: string) =>
  !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());

function Group<T>({
  heading,
  items,
  render,
}: {
  heading: string;
  items: T[];
  render: (t: T) => React.ReactNode;
}) {
  if (!items.length) return null;
  return <CommandGroup heading={heading}>{items.map(render)}</CommandGroup>;
}
