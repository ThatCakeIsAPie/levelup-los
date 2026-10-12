import { useState, type ReactNode } from "react";
import { Flame } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { openLog, setLearningGoal, type LearningGoal } from "@/data";
import type { MyLearning } from "./hooks";
import type { WeekTotals } from "./learning";

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

const GOAL_ROWS: { key: keyof WeekTotals & keyof LearningGoal; label: string }[] = [
  { key: "pages", label: "Pages" },
  { key: "podcasts", label: "Podcasts" },
  { key: "workshops", label: "Workshops" },
];

/** Desktop weekly goal card with an Edit dialog. */
export function GoalCard({ learning, personId }: { learning: MyLearning; personId: string }) {
  const [editing, setEditing] = useState(false);
  return (
    <SectionCard
      title="This week's goal"
      action={
        <button
          type="button"
          className="rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      }
    >
      <div className="flex items-center gap-4">
        <ProgressRing value={learning.progress} />
        <GoalRows learning={learning} className="flex-1" />
      </div>
      <GoalDialog
        open={editing}
        onOpenChange={setEditing}
        personId={personId}
        goal={learning.goal}
      />
    </SectionCard>
  );
}

function GoalRows({ learning, className }: { learning: MyLearning; className?: string }) {
  return (
    <dl className={cn("grid gap-1.5 text-[12.5px]", className)}>
      {GOAL_ROWS.map((r) => (
        <div key={r.key} className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="font-bold tabular-nums">
            {learning.totals[r.key]} / {learning.goal[r.key]}
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
  return (
    <>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(CARD_BUTTON, "grid min-w-0 content-start gap-2 rounded-xl p-3")}
        aria-label={`Weekly goal ${pct}% done. Open goal details`}
      >
        <span className="text-[12.5px] font-bold">Week goal</span>
        <span className="text-[22px] font-extrabold leading-none tabular-nums">{pct}%</span>
        <SegmentedBar total={1} segments={[{ value: learning.progress, className: "bg-sky" }]} />
        <span className="text-[11px] leading-snug text-faint">
          {learning.totals.pages} of {learning.goal.pages} pages
        </span>
      </button>
      <GoalDialog
        open={editing}
        onOpenChange={setEditing}
        personId={personId}
        goal={learning.goal}
        summary={<GoalRows learning={learning} className="rounded-lg bg-surface-2 px-3 py-2.5" />}
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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Weekly learning goal</DialogTitle>
          <DialogDescription>Targets for the last 7 days, counted from today.</DialogDescription>
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

function GoalForm({
  goal,
  onSave,
  onCancel,
}: {
  goal: LearningGoal;
  onSave: (g: LearningGoal) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Record<keyof LearningGoal, string>>({
    pages: String(goal.pages),
    podcasts: String(goal.podcasts),
    workshops: String(goal.workshops),
  });
  const parsed: LearningGoal = {
    pages: Number(draft.pages),
    podcasts: Number(draft.podcasts),
    workshops: Number(draft.workshops),
  };
  const valid = GOAL_ROWS.every(
    (r) =>
      draft[r.key].trim() !== "" &&
      Number.isInteger(parsed[r.key]) &&
      parsed[r.key] >= 0 &&
      parsed[r.key] <= 1000,
  );
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(parsed);
      }}
    >
      <div className="grid grid-cols-3 gap-3">
        {GOAL_ROWS.map((r) => (
          <div key={r.key} className="grid gap-1.5">
            <Label htmlFor={`goal-${r.key}`}>{r.label}</Label>
            <Input
              id={`goal-${r.key}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={1000}
              step={1}
              value={draft[r.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      {!valid && <p className="text-[12.5px] text-bad">Use whole numbers from 0 to 1000.</p>}
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid}>
          Save goal
        </Button>
      </DialogFooter>
    </form>
  );
}
