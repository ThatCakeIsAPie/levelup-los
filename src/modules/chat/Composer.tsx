import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import {
  CalendarDays,
  Image as ImageIcon,
  Link2,
  Loader2,
  Mic,
  Pencil,
  Plus,
  SendHorizontal,
  Trash2,
  Trophy,
  X,
  CornerUpLeft,
} from "lucide-react";
import { PersonAvatar } from "@/components/brand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  compressImage,
  editMessage,
  openLog,
  saveAttachment,
  sendMessage,
  useVoiceRecorder,
  type AttachmentInput,
  type ConversationSummary,
  type MemberView,
  type MessageCard,
  type MessageView,
  type VoiceRecording,
} from "@/data";
import { LinkCard, EventCard } from "./cards";
import { LinkPicker } from "./LinkPicker";
import { EventPostDialog } from "./EventPostDialog";
import { duration, firstName } from "./format";

const round =
  "grid size-9 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

interface PendingImage {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
  url: string;
}

/** Text before the caret ending in "@name" -> the query (letters and spaces, max 30). */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([\p{L}\p{N}' -]{0,30})$/u.exec(before);
  if (!m) return null;
  return { start: before.length - m[2].length - 1, query: m[2] };
}

export function Composer({
  conv,
  members,
  meId,
  replyTo,
  onCancelReply,
  editing,
  onCancelEdit,
  onSent,
}: {
  conv: ConversationSummary;
  members: MemberView[];
  meId: string;
  replyTo: MessageView | null;
  onCancelReply: () => void;
  editing: MessageView | null;
  onCancelEdit: () => void;
  onSent: (messageId: string) => void;
}) {
  const [text, setText] = useState("");
  const [card, setCard] = useState<MessageCard | null>(null);
  const [image, setImage] = useState<PendingImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const sendVoice = async (r: VoiceRecording | null) => {
    if (!r) return;
    setBusy(true);
    try {
      const { storagePath } = await saveAttachment(r.blob);
      deliver("", null, [
        {
          kind: "voice",
          storagePath,
          mime: r.mime,
          size: r.blob.size,
          durationMs: r.durationMs,
        },
      ]);
    } catch {
      toast.error("The voice note couldn't be saved on this device.");
    } finally {
      setBusy(false);
    }
  };
  const recorder = useVoiceRecorder({
    onLimit: (r) => {
      toast("Voice notes are up to 5 minutes. Sending what you recorded.");
      void sendVoice(r);
    },
  });

  // Prefill when editing; focus on reply/edit.
  useEffect(() => {
    if (editing) setText(editing.body);
  }, [editing]);
  useEffect(() => {
    if (replyTo || editing) area.current?.focus();
  }, [replyTo, editing]);
  // Microphone problems are explained once, then the composer returns to normal.
  useEffect(() => {
    const msg =
      recorder.status === "denied"
        ? "Microphone access is blocked. Allow it for this site in your browser settings to record voice notes."
        : recorder.status === "unsupported"
          ? "This browser can't record voice notes. Try the latest Safari or Chrome."
          : recorder.status === "error"
            ? "No microphone was found."
            : null;
    if (msg) {
      toast.error(msg);
      recorder.reset();
    }
  }, [recorder.status, recorder]);
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image],
  );
  // Auto-grow the textarea (1-6 lines).
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    el.style.overflowY = el.scrollHeight > 140 ? "auto" : "hidden";
  }, [text]);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return members
      .filter((p) => p.id !== meId && p.name.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)),
      )
      .slice(0, 6);
  }, [mention, members, meId]);

  const updateMention = (value: string, caret: number) => {
    const m = mentionQuery(value, caret);
    setMention(m);
    setActive(0);
  };

  const pickMention = (name: string) => {
    if (!mention) return;
    const caret = area.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${name} ${text.slice(caret)}`;
    setText(next);
    setMention(null);
    const pos = mention.start + name.length + 2;
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
    });
  };

  const deliver = (body: string, c: MessageCard | null, attachments: AttachmentInput[]) => {
    const r = sendMessage({
      conversationId: conv.id,
      body,
      replyToId: replyTo?.id ?? null,
      card: c,
      attachments,
    });
    if (!r) {
      toast.error("Your message couldn't be sent here.");
      return false;
    }
    onCancelReply();
    onSent(r.message.id);
    if (r.checkinWith) {
      const name = members.find((p) => p.id === r.checkinWith)?.name;
      toast.success(`Check-in with ${name ? firstName(name) : "them"} logged`, {
        description: "From your conversation. Counts for both of you.",
      });
    }
    return true;
  };

  const submit = async () => {
    if (busy) return;
    const body = text.trim();
    if (editing) {
      if (editMessage(editing.id, body)) {
        setText("");
        onCancelEdit();
      } else toast.error("A message can't be empty.");
      return;
    }
    if (!body && !card && !image) return;
    setBusy(true);
    try {
      const attachments: AttachmentInput[] = [];
      if (image) {
        const { storagePath } = await saveAttachment(image.blob);
        attachments.push({
          kind: "image",
          storagePath,
          mime: image.mime,
          size: image.blob.size,
          width: image.width,
          height: image.height,
        });
      }
      if (deliver(body, card, attachments)) {
        setText("");
        setCard(null);
        setImage(null);
      }
    } catch {
      toast.error("The photo couldn't be saved on this device.");
    } finally {
      setBusy(false);
      area.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && suggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(suggestions[active].name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === "Escape" && (editing || replyTo)) {
      e.preventDefault();
      if (editing) {
        setText("");
        onCancelEdit();
      } else onCancelReply();
      return;
    }
    // Enter sends on devices with a keyboard; Shift+Enter is a new line.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      const coarse = window.matchMedia?.("(pointer: coarse)").matches;
      if (!coarse) {
        e.preventDefault();
        void submit();
      }
    }
  };

  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const c = await compressImage(f);
      setImage({ ...c, url: URL.createObjectURL(c.blob) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That photo couldn't be used.");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const placeholder =
    conv.conversation.id === "daily-wins"
      ? "Share a win"
      : `Message ${conv.conversation.kind === "dm" ? firstName(conv.title) : conv.title}`;
  const canSend = !!(text.trim() || card || image);

  if (recorder.status === "recording" || recorder.status === "requesting") {
    return (
      <div className="flex items-center gap-2 border-t border-line pt-2">
        <button
          type="button"
          onClick={recorder.cancel}
          aria-label="Cancel voice note"
          className={cn(round, "bg-surface-2 text-destructive")}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
        <div
          className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-2 px-3 py-2 text-[12.5px]"
          role="status"
          aria-live="polite"
        >
          <span className="size-2.5 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
          {recorder.status === "requesting" ? (
            "Waiting for the microphone…"
          ) : (
            <>
              Recording <span className="tabular-nums">{duration(recorder.elapsedMs)}</span>
            </>
          )}
        </div>
        <button
          type="button"
          disabled={recorder.status !== "recording"}
          onClick={() => void recorder.stop().then(sendVoice)}
          aria-label="Send voice note"
          className={cn(round, "bg-primary text-primary-foreground disabled:opacity-50")}
        >
          <SendHorizontal className="size-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative grid gap-2 border-t border-line pt-2">
      {(replyTo || editing) && (
        <div className="flex items-center gap-2 rounded-[10px] bg-surface-2 px-2.5 py-1.5 text-xs">
          {editing ? (
            <Pencil className="size-3.5 text-primary-ink" aria-hidden="true" />
          ) : (
            <CornerUpLeft className="size-3.5 text-primary-ink" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-bold text-primary-ink">
              {editing ? "Editing message" : `Replying to ${replyTo?.author?.name ?? "message"}`}
            </div>
            {!editing && replyTo && (
              <div className="truncate text-muted-foreground">
                {replyTo.body || (replyTo.card ? "Post" : "Attachment")}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label={editing ? "Cancel editing" : "Cancel reply"}
            onClick={() => {
              if (editing) {
                setText("");
                onCancelEdit();
              } else onCancelReply();
            }}
            className="grid size-6 place-items-center rounded text-faint hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {(card || image) && (
        <div className="relative grid max-w-sm gap-2 rounded-[10px] border border-dashed border-line p-2">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-faint">
            Attached
          </span>
          {card?.type === "link" && <LinkCard card={card} />}
          {card?.type === "event" && <EventCard eventId={card.eventId} />}
          {image && (
            <img
              src={image.url}
              alt="Photo to send"
              className="max-h-40 w-auto rounded-lg object-contain"
            />
          )}
          <button
            type="button"
            aria-label="Remove attachment"
            onClick={() => {
              setCard(null);
              setImage(null);
            }}
            className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-surface text-faint shadow-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {mention && suggestions.length > 0 && (
        <ul
          id="mention-list"
          role="listbox"
          aria-label="Mention someone"
          className="absolute bottom-full left-10 z-20 mb-1 w-64 max-w-[calc(100%-3rem)] overflow-hidden rounded-lg border border-line bg-popover p-1 shadow-lg"
        >
          {suggestions.map((p, i) => (
            <li
              key={p.id}
              id={`mention-${p.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(p.name);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px]",
                i === active && "bg-surface-2",
              )}
            >
              <PersonAvatar name={p.name} stage={p.stage} size="sm" />
              <span className="truncate">{p.name}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        {!editing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Attach or post"
                disabled={busy}
                className={cn(round, "bg-surface-2 text-foreground hover:bg-line")}
              >
                <Plus className="size-[18px]" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-52">
              <DropdownMenuItem onSelect={() => file.current?.click()}>
                <ImageIcon /> Photo
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void recorder.start()}>
                <Mic /> Voice note
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEventOpen(true)}>
                <CalendarDays /> Event post
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openLog()}>
                <Trophy /> Share a win
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setLinkOpen(true)}>
                <Link2 /> Link something
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <input
          ref={file}
          type="file"
          accept="image/*"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void pickPhoto(e.target.files?.[0])}
        />
        <textarea
          ref={area}
          rows={1}
          value={text}
          aria-label={placeholder}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={!!mention && suggestions.length > 0}
          aria-controls="mention-list"
          aria-autocomplete="list"
          aria-activedescendant={
            mention && suggestions[active] ? `mention-${suggestions[active].id}` : undefined
          }
          onChange={(e) => {
            setText(e.target.value);
            updateMention(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setMention(null), 120)}
          className="max-h-[140px] min-h-9 min-w-0 flex-1 resize-none overflow-y-hidden rounded-[18px] border border-transparent bg-surface-2 px-3.5 py-2 text-[13px] leading-5 placeholder:text-faint focus-visible:border-ring focus-visible:outline-none"
        />
        {canSend || editing ? (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || (!canSend && !editing)}
            aria-label={editing ? "Save edit" : "Send"}
            className={cn(round, "bg-primary text-primary-foreground disabled:opacity-50")}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <SendHorizontal className="size-4" aria-hidden="true" />
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void recorder.start()}
            disabled={busy}
            aria-label="Record voice note"
            className={cn(round, "bg-primary text-primary-foreground disabled:opacity-50")}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Mic className="size-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      <LinkPicker
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onPick={(target) => setCard({ type: "link", target })}
      />
      <EventPostDialog
        open={eventOpen}
        onOpenChange={setEventOpen}
        onPick={(eventId) => setCard({ type: "event", eventId })}
      />
    </div>
  );
}
