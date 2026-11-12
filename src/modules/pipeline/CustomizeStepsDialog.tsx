import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, Flag, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  MAX_STEP_LABEL,
  addPipelineStep,
  deletePipelineStep,
  hidePipelineStep,
  movePipelineStep,
  renamePipelineStep,
  saveStageNames,
  showPipelineStep,
  stageSourceHint,
  useCustomerStepsEditor,
  useStageNameEditor,
  useStageNames,
  useStepsEditor,
  type BoardKind,
  type CustomerStepBand,
  type StageNameEditor,
  type StageNameRow,
  type StepBand,
} from "@/data";
import { plural } from "./format";
import { nextOwnName, stageEditError } from "./stageNameEdit";

/** A band of the steps editor (the same shape on both boards). */
interface EditorBand {
  band: string;
  steps: EditorStep[];
}
interface EditorStep {
  step: { id: string; label: string; band: string };
  own: boolean;
  hiddenBy: string | null;
  ownerName: string;
  hiddenByName: string | null;
  cards: number;
}

/** The viewer's milestone names for a board (their own, else inherited, else the defaults). */
function useMilestoneNames(kind: BoardKind) {
  const names = useStageNames(kind);
  return {
    label: (band: string) => names.name(band),
  };
}

/**
 * Customize steps: the four stages keep their order and meaning, but their
 * names are yours to change (click one to edit it in place); inherited steps
 * can be hidden for your team; your own steps can be added, renamed,
 * reordered and deleted. `kind` picks the board (recruiting by default, or
 * the customer board). Everyone with the pipeline can open it and rename;
 * steps are only ever edited by the person who made them.
 */
export function CustomizeStepsDialog({
  open,
  onOpenChange,
  kind = "recruiting",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind?: BoardKind;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg"
        // Escape in a stage name's field cancels that edit; it doesn't close the dialog.
        onEscapeKeyDown={(e) => {
          if ((e.target as HTMLElement | null)?.closest?.("[data-stage-name-input]"))
            e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {kind === "customer" ? "Customize customer steps" : "Customize steps"}
          </DialogTitle>
          <DialogDescription>
            Click a stage name to rename it. Stages keep their order and meaning, so every
            team&rsquo;s numbers add up. Steps between them are yours: your team sees them too. Hide
            your upline&rsquo;s steps your team doesn&rsquo;t use.
          </DialogDescription>
        </DialogHeader>
        {kind === "customer" ? <CustomerBands /> : <RecruitingBands />}
      </DialogContent>
    </Dialog>
  );
}

function RecruitingBands() {
  return <Bands bands={useStepsEditor()} kind="recruiting" />;
}

function CustomerBands() {
  return <Bands bands={useCustomerStepsEditor()} kind="customer" />;
}

function Bands({ bands, kind }: { bands: EditorBand[]; kind: BoardKind }) {
  const editor = useStageNameEditor(kind);
  const last = editor.rows[bands.length];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <p className="text-[12px] text-muted-foreground">
        People below you see your stage names unless they set their own.
      </p>
      <ol className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {bands.map((b, i) => (
          <BandEditor key={b.band} band={b} index={i} kind={kind} editor={editor} />
        ))}
        <li className="grid gap-1.5">
          {last && <StageRow kind={kind} index={bands.length + 1} row={last} editor={editor} />}
        </li>
      </ol>
    </div>
  );
}

/**
 * One stage: its name edits in place (tap or click it, or Tab to it and press
 * Enter; the name is selected so typing replaces it; Enter or leaving the field
 * saves, Escape cancels, an emptied field goes back to the inherited or
 * built-in name). Below it, where the name comes from, or Reset for your own.
 */
function StageRow({
  kind,
  index,
  row,
  editor,
}: {
  kind: BoardKind;
  index: number;
  row: StageNameRow;
  editor: StageNameEditor;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  /** Set once an edit has ended, so the blur that follows doesn't save again. */
  const finished = useRef(false);
  /** Hand focus back to the name after Enter or Escape, not after tabbing away. */
  const refocus = useRef(false);
  const name = row.effective.name;
  const own = row.own !== "";
  const liveError = editing
    ? stageEditError(kind, editor.rows, editor.reserved, row.key, value)
    : null;
  const error = liveError ?? saveError;

  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      trigger.current?.focus();
    }
  }, [editing]);

  const start = () => {
    finished.current = false;
    setValue(name);
    setSaveError(null);
    setEditing(true);
  };
  const stop = (focusName: boolean) => {
    finished.current = true;
    refocus.current = focusName;
    setSaveError(null);
    setEditing(false);
  };
  /** Save what was typed; false when it was refused (the message stays under the field). */
  const commit = (): boolean => {
    const next = nextOwnName(row, value);
    if (next === null) return true;
    const message = stageEditError(kind, editor.rows, editor.reserved, row.key, next);
    if (message) {
      setSaveError(message);
      return false;
    }
    const draft = Object.fromEntries(editor.rows.map((r) => [r.key, r.own]));
    draft[row.key] = next;
    const r = saveStageNames(kind, draft);
    if (!r.ok) {
      setSaveError(r.errors[row.key] ?? Object.values(r.errors)[0] ?? "Couldn’t save that name.");
      return false;
    }
    return true;
  };
  const reset = () => {
    const draft = Object.fromEntries(editor.rows.map((r) => [r.key, r.own]));
    draft[row.key] = "";
    const r = saveStageNames(kind, draft);
    setSaveError(
      r.ok
        ? null
        : (r.errors[row.key] ?? Object.values(r.errors)[0] ?? "Couldn’t reset that name."),
    );
  };

  const hint = stageSourceHint(row.inherited);
  const inheritedHint =
    row.inherited.source === "default" ? hint : `${hint} · default is ${row.inherited.defaultName}`;
  const hintId = `stage-${kind}-${row.key}-note`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
      <div className="flex items-center gap-2">
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-foreground text-[11px] font-extrabold text-background">
          {index}
        </span>
        <Flag className="size-3.5 shrink-0 text-amber-strong" aria-hidden="true" />
        {editing ? (
          <Input
            ref={input}
            data-stage-name-input=""
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaveError(null);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") {
                e.preventDefault();
                if (commit()) stop(true);
              } else if (e.key === "Escape") {
                e.preventDefault();
                stop(true);
              }
            }}
            onBlur={() => {
              if (finished.current) return;
              if (commit()) stop(false);
            }}
            placeholder={row.inherited.name}
            aria-label={`Name of stage ${index}`}
            aria-invalid={!!error}
            aria-describedby={hintId}
            enterKeyHint="done"
            autoComplete="off"
            className="h-7 min-w-0 flex-1 text-[13px] font-bold"
          />
        ) : (
          <button
            ref={trigger}
            type="button"
            onClick={start}
            aria-label={`Rename stage ${name}`}
            title="Rename this stage"
            className="-mx-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left font-bold outline-none transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="min-w-0 truncate">{name}</span>
            <Pencil className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        )}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground">
          <Lock className="size-3" aria-hidden="true" /> Milestone
        </span>
      </div>
      <p
        id={hintId}
        role={error ? "alert" : undefined}
        className={cn("pl-[34px] text-[11.5px]", error ? "text-bad" : "text-muted-foreground")}
      >
        {error ??
          (own ? (
            <>
              Your name ·{" "}
              <button
                type="button"
                onClick={reset}
                aria-label={`Reset ${name} to ${row.inherited.name}`}
                className="rounded font-semibold text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Reset
              </button>
            </>
          ) : (
            inheritedHint
          ))}
      </p>
    </div>
  );
}

function BandEditor({
  band,
  index,
  kind,
  editor,
}: {
  band: EditorBand;
  index: number;
  kind: BoardKind;
  editor: StageNameEditor;
}) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const own = band.steps.filter((s) => s.own);
  const names = useMilestoneNames(kind);
  const name = names.label(band.band);
  const add = () => {
    const r = addPipelineStep(band.band as StepBand | CustomerStepBand, label, kind);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setLabel("");
    setError(null);
  };
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-1.5" aria-label={`${name} band`}>
      <StageRow kind={kind} index={index + 1} row={editor.rows[index]} editor={editor} />
      <ul className="grid gap-1 pl-3">
        {band.steps.map((s) => (
          <StepRow
            key={s.step.id}
            s={s}
            kind={kind}
            first={own[0]?.step.id === s.step.id}
            last={own[own.length - 1]?.step.id === s.step.id}
          />
        ))}
        {band.steps.length === 0 && (
          <li className="px-2 py-1 text-[12px] text-faint">No steps in this band yet.</li>
        )}
      </ul>
      <form
        className="grid gap-1 pl-3"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="flex gap-2">
          <Input
            value={label}
            maxLength={MAX_STEP_LABEL + 5}
            onChange={(e) => {
              setLabel(e.target.value);
              setError(null);
            }}
            placeholder={`Add a step after ${name}`}
            aria-label={`New step after ${name}`}
            aria-invalid={!!error}
            className="h-8 text-[13px]"
          />
          <Button type="submit" size="sm" variant="soft" disabled={!label.trim()}>
            <Plus /> Add
          </Button>
        </div>
        {error && <p className="text-[11.5px] text-bad">{error}</p>}
      </form>
    </li>
  );
}

function StepRow({
  s,
  first,
  last,
  kind,
}: {
  s: EditorStep;
  first: boolean;
  last: boolean;
  kind: BoardKind;
}) {
  const [editing, setEditing] = useState(false);
  const names = useMilestoneNames(kind);
  const [name, setName] = useState(s.step.label);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const hiddenByUpline = !!s.hiddenBy && s.hiddenByName !== "You";
  const hidden = !!s.hiddenBy;

  const save = () => {
    const r = renamePipelineStep(s.step.id, name, kind);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEditing(false);
    setError(null);
  };
  const remove = () => {
    const r = deletePipelineStep(s.step.id, kind);
    if (r.ok)
      toast.success(
        `${s.step.label} deleted${r.moved ? ` · ${plural(r.moved, "card")} moved back to the milestone` : ""}`,
      );
    else toast.error(r.error);
  };

  return (
    <li
      className={cn(
        "grid gap-1 rounded-lg border border-line px-2.5 py-1.5",
        hidden && "border-dashed bg-surface-2/50",
      )}
    >
      <div className="flex min-h-8 items-center gap-2 text-[13px]">
        {editing ? (
          <form
            className="flex min-w-0 flex-1 gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              aria-label="Step name"
              className="h-7 text-[13px]"
            />
            <Button
              type="submit"
              size="icon"
              variant="soft"
              className="size-7"
              aria-label="Save name"
            >
              <Check />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Cancel"
              onClick={() => {
                setEditing(false);
                setName(s.step.label);
                setError(null);
              }}
            >
              <X />
            </Button>
          </form>
        ) : (
          <>
            <span
              className={cn(
                "min-w-0 truncate font-semibold",
                hidden && "text-muted-foreground line-through",
              )}
            >
              {s.step.label}
            </span>
            <span className="shrink-0 text-[11px] text-faint">
              {s.own ? "Your step" : `${s.ownerName}’s step`}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              {s.own ? (
                <>
                  <IconBtn label={`Rename ${s.step.label}`} onClick={() => setEditing(true)}>
                    <Pencil />
                  </IconBtn>
                  <IconBtn
                    label={`Move ${s.step.label} up`}
                    disabled={first}
                    onClick={() => movePipelineStep(s.step.id, -1, kind)}
                  >
                    <ArrowUp />
                  </IconBtn>
                  <IconBtn
                    label={`Move ${s.step.label} down`}
                    disabled={last}
                    onClick={() => movePipelineStep(s.step.id, 1, kind)}
                  >
                    <ArrowDown />
                  </IconBtn>
                  <IconBtn
                    label={`Delete ${s.step.label}`}
                    onClick={() => (s.cards ? setConfirm(true) : remove())}
                  >
                    <Trash2 />
                  </IconBtn>
                </>
              ) : (
                <Switch
                  checked={!hidden}
                  disabled={hiddenByUpline}
                  onCheckedChange={(on) => {
                    if (on) showPipelineStep(s.step.id, kind);
                    else hidePipelineStep(s.step.id, kind);
                  }}
                  aria-label={`Show ${s.step.label} on your team's board`}
                />
              )}
            </span>
          </>
        )}
      </div>
      {error && <p className="text-[11.5px] text-bad">{error}</p>}
      {hiddenByUpline && (
        <p className="text-[11px] text-muted-foreground">
          Hidden by {s.hiddenByName} for their team.
        </p>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {s.step.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {plural(s.cards, "card")} in it move back to {names.label(s.step.band)}. Past moves
              still count toward the milestone. Your team loses this step too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-7 text-muted-foreground [&_svg]:size-3.5"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
