import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, Hash, Megaphone, Search, Send, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  lengthLabel,
  sendMessage,
  useChatAccess,
  useFeature,
  useConversations,
  useLibraryPeople,
  type CatalogItem,
} from "@/data";
import { FormSheet } from "./FormSheet";
import { KindIcon } from "./icons";
import { audienceText } from "./parts";

/** May the current user share library items into chats? (Chat members, with Chats on.) */
export function useCanShareToChat(): boolean {
  const chats = useFeature("chats");
  return useChatAccess().eligible && chats;
}

/**
 * "Share to chat": pick one of your chats, add a note, and post the item as a
 * material link card (it plays / opens from the chat).
 */
export function ShareToChatDialog({
  open,
  onOpenChange,
  item,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item: CatalogItem;
}) {
  const navigate = useNavigate();
  const access = useChatAccess();
  const conversations = useConversations();
  const people = useLibraryPeople();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setQ("");
    setPicked(null);
    setNote("");
  }, [open]);

  const chats = useMemo(
    () =>
      conversations
        .filter((c) => !c.blocked)
        .filter((c) => c.conversation.kind !== "announcements" || access.canReview)
        .filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase())),
    [conversations, access.canReview, q],
  );
  const chosen = conversations.find((c) => c.id === picked);

  const share = () => {
    if (!chosen) return;
    const sent = sendMessage({
      conversationId: chosen.id,
      body: note.trim(),
      card: { type: "link", target: { kind: "material", id: item.id } },
    });
    if (!sent) {
      toast.error("Couldn't post in that chat");
      return;
    }
    onOpenChange(false);
    toast.success(`Shared to ${chosen.title}`, {
      action: {
        label: "Open chat",
        onClick: () => void navigate({ to: "/chats/$id", params: { id: chosen.id } }),
      },
    });
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Share to chat"
      description="Posts it as a card that plays or opens right from the chat."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={share} disabled={!chosen}>
            <Send /> Share{chosen ? ` to ${chosen.title}` : ""}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-line p-2.5">
        <KindIcon kind={item.kind} size="lg" />
        <div className="min-w-0">
          <b className="block truncate text-[13px]">{item.title}</b>
          <small className="text-[11.5px] text-muted-foreground">{lengthLabel(item)}</small>
        </div>
      </div>
      {item.visibility !== "team" && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-warn-ink">
          Only{" "}
          {audienceText(
            item.visibility,
            item.createdBy,
            people.get(item.createdBy)?.name ?? "Your upline",
            access.personId,
          ).replace(/^Your/, "your")}{" "}
          can open it. Others in the chat will see that it isn&apos;t available to them.
        </p>
      )}
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
          aria-hidden="true"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a chat"
          aria-label="Find a chat"
          className="pl-9"
        />
      </div>
      <ul className="grid max-h-[40dvh] gap-0.5 overflow-y-auto" aria-label="Your chats">
        {chats.map((c) => {
          const Icon =
            c.conversation.kind === "dm"
              ? User
              : c.conversation.kind === "announcements"
                ? Megaphone
                : Hash;
          const on = picked === c.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(c.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring",
                  on && "bg-primary-soft hover:bg-primary-soft",
                )}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">{c.title}</span>
                {on && <Check className="size-4 text-primary" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
        {!chats.length && (
          <li className="px-2 py-6 text-center text-[13px] text-muted-foreground">
            No chats found.
          </li>
        )}
      </ul>
      <Textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional)"
        aria-label="Note"
      />
    </FormSheet>
  );
}
