import { useState } from "react";
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
  CUSTOMER_MILESTONE_LABEL,
  MAX_STEP_LABEL,
  MILESTONE_COLUMN_LABEL,
  MILESTONE_LABEL,
  addPipelineStep,
  deletePipelineStep,
  hidePipelineStep,
  movePipelineStep,
  renamePipelineStep,
  showPipelineStep,
  useCustomerStepsEditor,
  useStepsEditor,
  type BoardKind,
  type CustomerStepBand,
  type StepBand,
} from "@/data";
import { plural } from "./format";

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

/** Milestone names per board. */
const NAMES: Record<
  BoardKind,
  { label: (band: string) => string; column: (band: string) => string; last: string }
> = {
  recruiting: {
    label: (b) => MILESTONE_LABEL[b as StepBand],
    column: (b) => MILESTONE_COLUMN_LABEL[b as StepBand],
    last: MILESTONE_COLUMN_LABEL.registered,
  },
  customer: {
    label: (b) => CUSTOMER_MILESTONE_LABEL[b as CustomerStepBand],
    column: (b) => CUSTOMER_MILESTONE_LABEL[b as CustomerStepBand],
    last: CUSTOMER_MILESTONE_LABEL.on_ditto,
  },
};

/**
 * Customize steps: milestones are locked; inherited steps can be hidden for
 * your team; your own steps can be added, renamed, reordered and deleted.
 * `kind` picks the board (recruiting by default, or the customer board).
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {kind === "customer" ? "Customize customer steps" : "Customize steps"}
          </DialogTitle>
          <DialogDescription>
            The four milestones are the same for everyone, so every team&rsquo;s numbers add up.
            Steps between them are yours: your team sees them too. Hide your upline&rsquo;s steps
            your team doesn&rsquo;t use.
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
  return (
    <ol className="grid gap-4">
      {bands.map((b, i) => (
        <BandEditor key={b.band} band={b} index={i} kind={kind} />
      ))}
      <li className="grid gap-1.5">
        <MilestoneRow index={bands.length + 1} label={NAMES[kind].last} />
      </li>
    </ol>
  );
}

function MilestoneRow({ index, label }: { index: number; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
      <span className="grid size-5 place-items-center rounded-md bg-foreground text-[11px] font-extrabold text-background">
        {index}
      </span>
      <Flag className="size-3.5 text-amber-strong" aria-hidden="true" />
      <b>{label}</b>
      <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
        <Lock className="size-3" aria-hidden="true" /> Milestone
      </span>
    </div>
  );
}

function BandEditor({ band, index, kind }: { band: EditorBand; index: number; kind: BoardKind }) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const own = band.steps.filter((s) => s.own);
  const name = NAMES[kind].label(band.band);
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
    <li className="grid gap-1.5" aria-label={`${name} band`}>
      <MilestoneRow index={index + 1} label={NAMES[kind].column(band.band)} />
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
              {plural(s.cards, "card")} in it move back to {NAMES[kind].label(s.step.band)}. Past
              moves still count toward the milestone. Your team loses this step too.
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
