import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { CalendarDays, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar, Sensitive } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toastWithUndo } from "@/components/log/quickLog";
import { sensitive } from "@/lib/sensitive";
import { cn } from "@/lib/utils";
import {
  MAX_TASK_TITLE,
  addCardTask,
  removeCardTask,
  setTaskDone,
  updateCardTask,
  useAssigneeChoices,
  useCardTasks,
  useCurrentUser,
  usePersonLookup,
  type CardRef,
  type CardTask,
} from "@/data";
import { dueText } from "./format";
import { UndoButton, useUndoSlot, type Undoable } from "./UndoSlot";

const NOBODY = "nobody";

/**
 * A card's Tasks (both boards, the card panels and the profile's pipeline card): tick or untick;
 * add one by typing into the last row and pressing Enter (focus stays for the next one); click a
 * title to rename it in place (Enter saves, Escape cancels); a due date and optional time; the
 * assignee (the card's owner, you, or nobody); delete, with Undo on the toast. In order, new tasks
 * last, ticked ones staying where they are.
 */
export function CardTasks({ card }: { card: CardRef }) {
  const tasks = useCardTasks(card);
  const [draft, setDraft] = useState("");
  const add = useRef<HTMLInputElement>(null);
  // After an Undo the restored task takes the focus back.
  const [refocus, setRefocus] = useState<string | null>(null);
  const root = useRef<HTMLUListElement>(null);
  const undoSlot = useUndoSlot(root, () => add.current?.focus());
  useEffect(() => {
    if (!refocus) return;
    const box = root.current?.querySelector<HTMLElement>(
      `[data-task="${refocus}"] [role="checkbox"]`,
    );
    if (box) {
      box.focus();
      setRefocus(null);
    }
  }, [refocus, tasks]);

  const submit = () => {
    const title = draft.trim();
    if (!title) return;
    const r = addCardTask(card, { title });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setDraft("");
    add.current?.focus();
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  };

  return (
    <section className="grid gap-1.5" aria-labelledby={`tasks-${card.id}`}>
      <h3 id={`tasks-${card.id}`} className="text-[12px] font-bold text-muted-foreground">
        Tasks
      </h3>
      <ul ref={root} className="grid">
        {tasks.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            card={card}
            onDeleted={undoSlot.offer}
            onRestored={() => {
              undoSlot.clear();
              setRefocus(t.id);
            }}
          />
        ))}
      </ul>
      <UndoButton slot={undoSlot.slot} button={undoSlot.button} />
      <Input
        ref={add}
        value={draft}
        maxLength={MAX_TASK_TITLE}
        placeholder="Add a task"
        aria-label="New task"
        {...sensitive("note")}
        className="h-9"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
      />
    </section>
  );
}

function TaskRow({
  task,
  card,
  onDeleted,
  onRestored,
}: {
  task: CardTask;
  card: CardRef;
  onDeleted: (u: Undoable) => void;
  onRestored: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const title = useRef<HTMLButtonElement>(null);

  const tick = (done: boolean) => {
    setTaskDone(task.id, done);
  };
  const remove = () => {
    const undo = removeCardTask(task.id);
    if (!undo) return;
    const restore = () => {
      undo();
      onRestored();
    };
    onDeleted({ label: task.title, restore });
    toastWithUndo("Task deleted", restore, { undoneMessage: "Task restored" });
  };

  return (
    <li
      data-task={task.id}
      className="flex items-start gap-2 border-t border-line py-1.5 first:border-t-0"
    >
      <Checkbox
        checked={task.done}
        onCheckedChange={(v) => tick(v === true)}
        aria-label={`Done: ${task.title}`}
        className="relative mt-[5px] before:absolute before:-inset-2.5 before:content-['']"
      />
      <div className="min-w-0 flex-1 pt-px">
        {editing ? (
          <TitleEditor
            value={task.title}
            onDone={(next) => {
              setEditing(false);
              if (next !== null && next !== task.title) {
                const r = updateCardTask(task.id, { title: next });
                if (!r.ok) toast.error(r.error);
              }
              requestAnimationFrame(() => title.current?.focus());
            }}
          />
        ) : (
          <button
            ref={title}
            type="button"
            onClick={() => setEditing(true)}
            className={cn(
              "w-full break-words rounded-sm py-0.5 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-ring",
              task.done && "text-muted-foreground line-through",
            )}
          >
            <Sensitive kind="note">{task.title}</Sensitive>
          </button>
        )}
      </div>
      <DuePicker task={task} />
      <AssigneePicker task={task} card={card} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-faint hover:text-foreground pointer-coarse:size-9"
        aria-label={`Delete task: ${task.title}`}
        onClick={remove}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}

/** The title as a field: its text selected, Enter saves, Escape cancels, leaving the field saves. */
function TitleEditor({ value, onDone }: { value: string; onDone: (next: string | null) => void }) {
  const [text, setText] = useState(value);
  const finished = useRef(false);
  const finish = (next: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(next);
  };
  return (
    <Input
      autoFocus
      value={text}
      maxLength={MAX_TASK_TITLE}
      aria-label="Task title"
      data-task-title-input
      {...sensitive("note")}
      className="h-7 px-2 text-[13px]"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(text.trim() || null)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          finish(text.trim() || null);
        } else if (e.key === "Escape") {
          // Not the sheet's own Escape: this one only leaves the field.
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      }}
    />
  );
}

/** The due date and an optional time (a time needs a date); the clear button drops both. */
function DuePicker({ task }: { task: CardTask }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 shrink-0 gap-1 px-1.5 text-[11.5px] font-semibold pointer-coarse:h-9",
            task.dueDate ? "text-foreground" : "text-faint hover:text-foreground",
          )}
          aria-label={task.dueDate ? `Due ${dueText(task.dueDate, task.dueTime)}` : "Due date"}
        >
          <CalendarDays className="size-3.5" />
          {task.dueDate && <span>{dueText(task.dueDate, task.dueTime)}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-auto items-center gap-2 p-2.5">
        <Input
          type="date"
          aria-label="Due date"
          className="h-8 w-auto min-w-0 pointer-coarse:h-10"
          value={task.dueDate ?? ""}
          onChange={(e) => {
            const r = updateCardTask(task.id, { dueDate: e.target.value || null });
            if (!r.ok) toast.error(r.error);
          }}
        />
        <Input
          type="time"
          aria-label="Time"
          className="h-8 w-auto min-w-0 pointer-coarse:h-10"
          disabled={!task.dueDate}
          value={task.dueTime ?? ""}
          onChange={(e) => {
            const r = updateCardTask(task.id, { dueTime: e.target.value || null });
            if (!r.ok) toast.error(r.error);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 pointer-coarse:size-10"
          aria-label="Clear due date"
          disabled={!task.dueDate}
          onClick={() => {
            updateCardTask(task.id, { dueDate: null, dueTime: null });
            setOpen(false);
          }}
        >
          <X className="size-4" />
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Who the task is for: the card's owner, you, or nobody (then it is the owner's). */
function AssigneePicker({ task, card }: { task: CardTask; card: CardRef }) {
  const me = useCurrentUser().personId;
  const choices = useAssigneeChoices(card);
  const who = usePersonLookup();
  const current = who(task.assigneeId);
  // A task already given to someone else's name keeps it, and shows it.
  const options =
    task.assigneeId && !choices.includes(task.assigneeId) ? [...choices, task.assigneeId] : choices;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 pointer-coarse:size-9"
          aria-label={current ? `Assignee: ${current.name}` : "Assignee"}
        >
          {current ? (
            <PersonAvatar
              name={current.name}
              stage={current.stage}
              size="sm"
              className="size-5 text-[9px]"
            />
          ) : (
            <UserRound className="size-3.5 text-faint" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup
          value={task.assigneeId ?? NOBODY}
          onValueChange={(v) => {
            const r = updateCardTask(task.id, { assigneeId: v === NOBODY ? null : v });
            if (!r.ok) toast.error(r.error);
          }}
        >
          {options.map((id) => (
            <DropdownMenuRadioItem key={id} value={id}>
              <Sensitive kind="name">{id === me ? "You" : (who(id)?.name ?? "Someone")}</Sensitive>
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value={NOBODY}>No one</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
