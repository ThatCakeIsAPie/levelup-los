import { useEffect, useRef, useState, type ReactNode } from "react";
import { Flame, GripVertical, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { ProgressRing, SectionCard, SegmentedBar, ToneChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  MAX_GOAL_TARGET,
  addableCategories,
  goalCategory,
  itemLine,
  newGoalItem,
  openLog,
  setLearningGoal,
  useUnlocks,
  validTarget,
  type GoalItem,
  type GoalKind,
  type LearningGoal,
  type LearningUnit,
} from "@/data";
import type { MyLearning } from "./hooks";

function streakHint(l: MyLearning): string {
  if (l.loggedToday) return "Logged today";
  if (l.streak === 0) return "Log today to start a streak";
  return `Log today to make it ${l.streak + 1}`;
}

const CARD_BUTTON =
  "rounded-card border border-line bg-card text-left text-card-foreground transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function FlameTile({ size }: { size: "md" | "sm" }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-warn-soft text-amber-strong",
        size === "md" ? "size-[46px] rounded-xl [&_svg]:size-6" : "size-[34px] rounded-[10px]",
      )}
      aria-hidden="true"
    >
      <Flame className="size-5" />
    </span>
  );
}

/** Desktop learning streak card. The whole card opens the Log sheet on Learning. */
export function StreakCard({ learning }: { learning: MyLearning }) {
  const loggedDays = learning.days.filter((d) => d.logged).length;
  return (
    <button
      type="button"
      onClick={() => openLog({ tab: "learning" })}
      className={cn(CARD_BUTTON, "grid min-w-0 content-start gap-3 px-[18px] py-4")}
      aria-label={`Learning streak: ${learning.streak} ${learning.streak === 1 ? "day" : "days"}. ${streakHint(learning)}. Log learning`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold">Learning streak</span>
        {learning.best > 0 && <ToneChip tone="warn">Personal best: {learning.best}</ToneChip>}
      </span>
      <span className="flex items-center gap-3.5">
        <FlameTile size="md" />
        <span className="min-w-0">
          <span className="block text-[28px] font-extrabold leading-[1.05] tracking-[-0.02em] tabular-nums">
            {learning.streak} {learning.streak === 1 ? "day" : "days"}
          </span>
          <span className="block text-[12.5px] text-muted-foreground">{streakHint(learning)}</span>
        </span>
      </span>
      <span
        className="grid grid-cols-7 gap-1.5"
        role="img"
        aria-label={`Learning logged on ${loggedDays} of the last 7 days`}
      >
        {learning.days.map((d) => (
          <span
            key={d.date}
            className={cn(
              "grid justify-items-center gap-1 text-[10.5px] font-semibold",
              d.isToday ? "font-extrabold text-foreground" : "text-faint",
            )}
            title={`${d.name}${d.logged ? ": learning logged" : ""}`}
          >
            <i
              className={cn(
                "block h-2 w-full rounded",
                d.logged ? "bg-amber" : "bg-track",
                d.isToday && !d.logged && "outline-1 outline-offset-1 outline-amber outline-dashed",
              )}
            />
            {d.letter}
          </span>
        ))}
      </span>
    </button>
  );
}

/** Phone streak tile. */
export function StreakTile({ learning }: { learning: MyLearning }) {
  return (
    <button
      type="button"
      onClick={() => openLog({ tab: "learning" })}
      className={cn(CARD_BUTTON, "grid min-w-0 content-start gap-2 rounded-xl p-3")}
      aria-label={`Learning streak: ${learning.streak} ${learning.streak === 1 ? "day" : "days"}. ${streakHint(learning)}. Log learning`}
    >
      <span className="text-[12.5px] font-bold">Streak</span>
      <span className="flex items-center gap-2">
        <FlameTile size="sm" />
        <span className="text-[22px] font-extrabold leading-none tabular-nums">
          {learning.streak}
        </span>
      </span>
      <span className="text-[11px] leading-snug text-faint">{streakHint(learning)}</span>
    </button>
  );
}

/** Desktop weekly goal card with an Edit dialog. */
export function GoalCard({ learning, personId }: { learning: MyLearning; personId: string }) {
  const [editing, setEditing] = useState(false);
  const empty = learning.goalItems.length === 0;
  return (
    <SectionCard
      title="This week's goal"
      action={
        empty ? undefined : (
          <button
            type="button"
            className="rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        )
      }
    >
      {empty ? (
        <GoalEmpty onAdd={() => setEditing(true)} />
      ) : (
        <div className="flex items-center gap-4">
          <ProgressRing value={learning.progress} />
          <GoalRows learning={learning} className="min-w-0 flex-1" />
        </div>
      )}
      <GoalDialog
        open={editing}
        onOpenChange={setEditing}
        personId={personId}
        goal={learning.goal}
      />
    </SectionCard>
  );
}

function GoalEmpty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="grid justify-items-start gap-3">
      <p className="text-[13px] text-muted-foreground">
        No goal for this week yet. Pick what you want to aim for: reading, check-ins, new customers
        and more.
      </p>
      <Button type="button" size="sm" onClick={onAdd}>
        <Plus /> Add a goal
      </Button>
    </div>
  );
}

/** One line per item: this week's total against its target. */
function GoalRows({ learning, className }: { learning: MyLearning; className?: string }) {
  return (
    <dl className={cn("grid gap-1.5 text-[12.5px]", className)}>
      {learning.goalItems.map(({ item, category, done }) => (
        <div key={item.kind} className="flex justify-between gap-2">
          <dt className="min-w-0 truncate text-muted-foreground">{category.rowLabel(item.unit)}</dt>
          <dd className="shrink-0 font-bold tabular-nums">
            {done} / {item.target}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Phone weekly goal tile; tapping it opens the goal dialog (progress + edit). */
export function GoalTile({ learning, personId }: { learning: MyLearning; personId: string }) {
  const [editing, setEditing] = useState(false);
  const pct = Math.round(learning.progress * 100);
  const first = learning.goalItems[0];
  return (
    <>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(CARD_BUTTON, "grid min-w-0 content-start gap-2 rounded-xl p-3")}
        aria-label={
          first ? `Weekly goal ${pct}% done. Open goal details` : "No weekly goal yet. Add a goal"
        }
      >
        <span className="text-[12.5px] font-bold">Week goal</span>
        {first ? (
          <>
            <span className="text-[22px] font-extrabold leading-none tabular-nums">{pct}%</span>
            <SegmentedBar
              total={1}
              segments={[{ value: learning.progress, className: "bg-sky" }]}
            />
            <span className="text-[11px] leading-snug text-faint">{itemLine(first)}</span>
          </>
        ) : (
          <>
            <span className="grid size-[34px] place-items-center rounded-[10px] bg-primary-soft text-primary-ink">
              <Plus className="size-5" aria-hidden="true" />
            </span>
            <span className="text-[11px] leading-snug text-faint">Tap to add a goal</span>
          </>
        )}
      </button>
      <GoalDialog
        open={editing}
        onOpenChange={setEditing}
        personId={personId}
        goal={learning.goal}
        summary={
          first ? (
            <GoalRows learning={learning} className="rounded-lg bg-surface-2 px-3 py-2.5" />
          ) : undefined
        }
      />
    </>
  );
}

function GoalDialog({
  open,
  onOpenChange,
  personId,
  goal,
  summary,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  personId: string;
  goal: LearningGoal;
  summary?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Weekly goal</DialogTitle>
          <DialogDescription>
            What you want to do in the last 7 days, counted from today. Reading and podcasts count
            only what you log in the unit you pick.
          </DialogDescription>
        </DialogHeader>
        {summary}
        {open && (
          <GoalForm
            goal={goal}
            onCancel={() => onOpenChange(false)}
            onSave={(next) => {
              setLearningGoal(personId, next);
              toast.success("Weekly goal saved");
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A goal item being edited: the target as typed. */
interface DraftItem {
  kind: GoalKind;
  target: string;
  unit?: LearningUnit;
}

const targetId = (kind: GoalKind) => `goal-${kind}-target`;
const amountId = (kind: GoalKind) => `goal-${kind}-amount`;

function GoalForm({
  goal,
  onSave,
  onCancel,
}: {
  goal: LearningGoal;
  onSave: (g: LearningGoal) => void;
  onCancel: () => void;
}) {
  const unlocks = useUnlocks();
  const [draft, setDraft] = useState<DraftItem[]>(() =>
    goal.items.map((i) => ({ kind: i.kind, target: String(i.target), unit: i.unit })),
  );
  const addRef = useRef<HTMLButtonElement>(null);
  // The kind just added from the menu: its target gets focus once the menu closes.
  const added = useRef<GoalKind | null>(null);

  const items: GoalItem[] = draft.map((d) => ({
    kind: d.kind,
    target: Number(d.target),
    ...(d.unit ? { unit: d.unit } : {}),
  }));
  const invalid = new Set(
    draft
      .filter((d, i) => d.target.trim() === "" || !validTarget(items[i].target))
      .map((d) => d.kind),
  );
  const addable = addableCategories(items, { pipeline: unlocks.can.pipeline });

  const patch = (kind: GoalKind, p: Partial<DraftItem>) =>
    setDraft((list) => list.map((d) => (d.kind === kind ? { ...d, ...p } : d)));
  const add = (kind: GoalKind) => {
    const item = newGoalItem(kind);
    added.current = kind;
    setDraft((list) => [...list, { kind, target: String(item.target), unit: item.unit }]);
  };
  // After a remove, focus moves to the Add button (there once something is removed).
  const focusAdd = useRef(false);
  useEffect(() => {
    if (!focusAdd.current) return;
    focusAdd.current = false;
    addRef.current?.focus();
  }, [draft]);
  const remove = (kind: GoalKind) => {
    focusAdd.current = true;
    setDraft((list) => list.filter((d) => d.kind !== kind));
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid.size === 0) onSave({ items });
      }}
    >
      {draft.length === 0 ? (
        <p className="rounded-lg bg-surface-2 px-3 py-3 text-[13px] text-muted-foreground">
          Nothing in your goal yet. Add what you want to aim for this week.
        </p>
      ) : (
        <GoalItemList
          draft={draft}
          invalid={invalid}
          onPatch={patch}
          onRemove={remove}
          onReorder={setDraft}
        />
      )}
      {addable.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={addRef} type="button" variant="outline" className="justify-self-start">
              <Plus /> {draft.length === 0 ? "Add a goal" : "Add"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            onCloseAutoFocus={(e) => {
              const kind = added.current;
              if (!kind) return;
              added.current = null;
              e.preventDefault();
              // After the menu has let go of the dialog (it hides the rest while open).
              setTimeout(() => document.getElementById(amountId(kind))?.focus(), 0);
            }}
          >
            {addable.map((kind) => {
              const category = goalCategory(kind);
              const Icon = category.icon;
              return (
                <DropdownMenuItem key={kind} onSelect={() => add(kind)}>
                  <Icon aria-hidden="true" /> {category.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={invalid.size > 0}>
          Save goal
        </Button>
      </DialogFooter>
    </form>
  );
}

/** "120 min", "60 pages" for items with units; just the number otherwise. */
function amountText(d: DraftItem): string {
  const category = goalCategory(d.kind);
  const t = d.target.trim() || "?";
  if (!category.units) return t;
  const unit = d.unit ?? category.units[0].value;
  return unit === "minutes" ? `${t} min` : `${t} ${unit}`;
}

/**
 * The editor's compact list, one line per item: grip (drag, or arrow keys) ·
 * name · amount (opens a popover with the target and unit) · remove.
 */
function GoalItemList({
  draft,
  invalid,
  onPatch,
  onRemove,
  onReorder,
}: {
  draft: DraftItem[];
  invalid: Set<GoalKind>;
  onPatch: (kind: GoalKind, p: Partial<DraftItem>) => void;
  onRemove: (kind: GoalKind) => void;
  onReorder: (next: DraftItem[]) => void;
}) {
  const rows = useRef(new Map<GoalKind, HTMLLIElement>());
  const [dragging, setDragging] = useState<GoalKind | null>(null);
  const [announce, setAnnounce] = useState("");

  const move = (kind: GoalKind, to: number) => {
    const from = draft.findIndex((d) => d.kind === kind);
    if (from < 0 || to < 0 || to >= draft.length || to === from) return;
    const next = [...draft];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onReorder(next);
    setAnnounce(`${goalCategory(kind).label} moved to position ${to + 1} of ${draft.length}.`);
  };

  /** The slot under the pointer: how many other rows have their middle above it. */
  const slotAt = (kind: GoalKind, y: number) =>
    draft.filter((d) => {
      if (d.kind === kind) return false;
      const r = rows.current.get(d.kind)?.getBoundingClientRect();
      return !!r && y > r.top + r.height / 2;
    }).length;

  return (
    <>
      <ul className="grid gap-1.5" aria-label="Goal items">
        {draft.map((d, i) => {
          const category = goalCategory(d.kind);
          const Icon = category.icon;
          const bad = invalid.has(d.kind);
          const units = category.units;
          return (
            <li
              key={d.kind}
              ref={(el) => {
                if (el) rows.current.set(d.kind, el);
                else rows.current.delete(d.kind);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border border-line bg-surface p-1",
                dragging === d.kind && "relative z-10 shadow-md ring-2 ring-ring",
              )}
            >
              <button
                type="button"
                className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-faint hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
                aria-label={`Move ${category.label}, ${i + 1} of ${draft.length}. Use the up and down arrow keys.`}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    move(d.kind, i + (e.key === "ArrowUp" ? -1 : 1));
                  }
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  // Keep getting moves while the pointer leaves the handle.
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  setDragging(d.kind);
                }}
                onPointerMove={(e) => {
                  if (dragging === d.kind) move(d.kind, slotAt(d.kind, e.clientY));
                }}
                onPointerUp={() => setDragging(null)}
                onPointerCancel={() => setDragging(null)}
              >
                <GripVertical className="size-4" aria-hidden="true" />
              </button>
              <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate pl-0.5 text-sm font-semibold">
                {category.label}
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id={amountId(d.kind)}
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-8 min-w-[4.5rem] shrink-0 tabular-nums",
                      bad && "border-bad text-bad",
                    )}
                    aria-label={`${category.label} target: ${amountText(d)}. Change`}
                    aria-invalid={bad || undefined}
                  >
                    {amountText(d)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="grid w-64 gap-3 p-3">
                  <div>
                    <p className="text-sm font-semibold">{category.label}</p>
                    <p className="text-[12px] leading-snug text-muted-foreground">
                      {category.hint}
                    </p>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={targetId(d.kind)}>Target this week</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={targetId(d.kind)}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={MAX_GOAL_TARGET}
                        step={1}
                        className="h-9 w-24"
                        value={d.target}
                        aria-invalid={bad || undefined}
                        onChange={(e) => onPatch(d.kind, { target: e.target.value })}
                      />
                      {!units && (
                        <span className="text-[12.5px] text-muted-foreground">
                          {category.words()}
                        </span>
                      )}
                    </div>
                    {bad && (
                      <p className="text-[12px] text-bad">
                        Use a whole number from 1 to {MAX_GOAL_TARGET.toLocaleString()}.
                      </p>
                    )}
                  </div>
                  {units && (
                    <div className="grid gap-1.5">
                      <span className="text-sm font-medium" id={`goal-${d.kind}-unit`}>
                        Count in
                      </span>
                      <div
                        role="radiogroup"
                        aria-labelledby={`goal-${d.kind}-unit`}
                        className="flex flex-wrap gap-1.5"
                      >
                        {units.map((u) => {
                          const on = (d.unit ?? units[0].value) === u.value;
                          return (
                            <button
                              key={u.value}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              className={cn(
                                "rounded-full border px-3 py-1 text-[12.5px] font-semibold focus-visible:outline-2 focus-visible:outline-ring",
                                on
                                  ? "border-primary bg-primary-soft text-primary-ink"
                                  : "border-line text-muted-foreground hover:bg-surface-2",
                              )}
                              onClick={() => onPatch(d.kind, { unit: u.value })}
                            >
                              {u.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground"
                aria-label={`Remove ${category.label}`}
                onClick={() => onRemove(d.kind)}
              >
                <X />
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {invalid.size > 0 && (
        <p className="-mt-2 text-[12px] text-bad">
          Check the {[...invalid].map((k) => goalCategory(k).label.toLowerCase()).join(" and ")}{" "}
          target: use a whole number from 1 to {MAX_GOAL_TARGET.toLocaleString()}.
        </p>
      )}
    </>
  );
}
