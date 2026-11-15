import { useRef, useState, type KeyboardEvent } from "react";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Sensitive } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toastWithUndo } from "@/components/log/quickLog";
import { relativeTime } from "@/data/agents/rules";
import { sensitive } from "@/lib/sensitive";
import {
  MAX_NOTE_BODY,
  addCardNote,
  removeCardNote,
  useCardNotes,
  useCurrentUser,
  usePersonLookup,
  type CardNote,
  type CardRef,
} from "@/data";

/**
 * A card's Notes: a running log, newest first, each with who wrote it and when (relative; the exact
 * time on hover). Enter adds a note, Shift+Enter is a new line. Your own notes can be deleted, with
 * Undo on the toast; nobody edits one.
 */
export function CardNotes({ card }: { card: CardRef }) {
  const notes = useCardNotes(card);
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (!draft.trim()) return;
    const r = addCardNote(card, draft);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setDraft("");
    field.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  };

  return (
    <section className="grid gap-1.5" aria-labelledby={`notes-${card.id}`}>
      <h3 id={`notes-${card.id}`} className="text-[12px] font-bold text-muted-foreground">
        Notes
      </h3>
      <Textarea
        ref={field}
        value={draft}
        rows={2}
        maxLength={MAX_NOTE_BODY}
        placeholder="Add a note"
        aria-label="New note"
        {...sensitive("note")}
        className="min-h-0 resize-none"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
      />
      {notes.length > 0 && (
        <ul className="grid">
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} onDeleted={() => field.current?.focus()} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteRow({ note, onDeleted }: { note: CardNote; onDeleted: () => void }) {
  const me = useCurrentUser().personId;
  const who = usePersonLookup();
  const author = who(note.authorId);
  const mine = !!note.authorId && note.authorId === me;
  const remove = () => {
    const undo = removeCardNote(note.id);
    if (!undo) return;
    onDeleted();
    toastWithUndo("Note deleted", undo, { undoneMessage: "Note restored" });
  };
  return (
    <li className="grid gap-0.5 border-t border-line py-2 first:border-t-0">
      <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
        <span className="min-w-0 truncate">
          {author && (
            <b className="font-semibold text-foreground">
              <Sensitive kind="name">{author.name}</Sensitive>
            </b>
          )}
          {author && " · "}
          <time
            dateTime={note.createdAt}
            title={format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mm a")}
          >
            {relativeTime(note.createdAt)}
          </time>
        </span>
        {mine && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-my-1 size-7 shrink-0 text-faint hover:text-foreground"
            aria-label="Delete note"
            onClick={remove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-[13px]">
        <Sensitive kind="note">{note.body}</Sensitive>
      </p>
    </li>
  );
}
