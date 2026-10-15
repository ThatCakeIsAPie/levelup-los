import { useState } from "react";
import { toast } from "sonner";
import { Flag, Gauge } from "lucide-react";
import {
  GROWTH_MILESTONES,
  localDate,
  markMilestoneReached,
  setMonthPv,
  useChatPeople,
  useCurrentUser,
  useMonthPv,
  type CrmPerson,
  type GrowthMilestoneCode,
  type GrowthPath,
} from "@/data";
import { useIsDesktop } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { firstName } from "@/modules/people/format";
import { monthName, pv, reachedLong, reachedShort } from "./format";

export type CoachTarget = { tab: "pv" } | { tab: "mark"; code?: GrowthMilestoneCode };

/** The last 12 calendar months, this one first ("YYYY-MM"). */
function recentMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) =>
    localDate(new Date(now.getFullYear(), now.getMonth() - i, 1)).slice(0, 7),
  );
}

/**
 * The upline's tools for a downline's growth path: set their PV for a month
 * (from the Amway app; replaces what's logged) and mark a milestone by hand
 * (a permanent one counts as reached; for a live or monthly one it records
 * when they first hit it, history only). Both record who made the change.
 * Right side sheet on desktop, bottom sheet on phones.
 */
export function CoachSheet({
  person,
  path,
  target,
  open,
  formKey,
  onOpenChange,
}: {
  person: CrmPerson;
  path: GrowthPath;
  /** What to show (kept while the sheet animates closed). */
  target: CoachTarget | null;
  open: boolean;
  /** Changes each time the sheet is opened, so the forms start fresh. */
  formKey: number;
  onOpenChange: (open: boolean) => void;
}) {
  const desktop = useIsDesktop();
  const name = firstName(person.name);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn(
          "flex flex-col gap-0 p-0",
          desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-card pb-safe",
        )}
      >
        {!desktop && (
          <span
            className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line"
            aria-hidden="true"
          />
        )}
        <SheetHeader className="border-b border-line px-5 pt-3.5 pb-3 text-left lg:pt-4">
          <SheetTitle className="text-base font-extrabold">Update {name}'s path</SheetTitle>
          <SheetDescription className="text-[12.5px]">
            Changes are saved with your name, so {name}'s other uplines can see who made them.
          </SheetDescription>
        </SheetHeader>
        {target && (
          <CoachForms
            key={formKey}
            person={person}
            path={path}
            target={target}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CoachForms({
  person,
  path,
  target,
  onDone,
}: {
  person: CrmPerson;
  path: GrowthPath;
  target: CoachTarget;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<CoachTarget["tab"]>(target.tab);
  const tabs = [
    { value: "pv" as const, label: "Monthly PV", icon: Gauge },
    { value: "mark" as const, label: "Mark a milestone", icon: Flag },
  ];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3.5 pb-5">
      <div
        role="radiogroup"
        aria-label="What to update"
        className="mb-4 grid grid-cols-2 gap-1 rounded-[10px] bg-surface-2 p-[3px]"
      >
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring",
              tab === t.value && "bg-card text-foreground shadow-sm",
            )}
          >
            <t.icon className="size-4" aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>
      {tab === "pv" ? (
        <PvForm person={person} onDone={onDone} />
      ) : (
        <MarkForm
          person={person}
          path={path}
          initial={target.tab === "mark" ? target.code : undefined}
          onDone={onDone}
        />
      )}
    </div>
  );
}

function PvForm({ person, onDone }: { person: CrmPerson; onDone: () => void }) {
  const months = recentMonths();
  const [month, setMonth] = useState(months[0]);
  const current = useMonthPv(person.id, month);
  const people = useChatPeople();
  const me = useCurrentUser();
  const [value, setValue] = useState("");
  const name = firstName(person.name);
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(n) && n >= 0;
  const setBy = current.override?.setBy;
  const who = setBy === me.personId ? "you" : setBy ? people.get(setBy)?.name : undefined;

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        if (setMonthPv(person.id, month, n)) {
          toast.success(`${name}'s ${monthName(month)} PV is now ${pv(n)}`);
          onDone();
        } else toast.error("Only an upline can set this.");
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="coach-month" className="text-xs font-semibold">
          Month
        </Label>
        <Select
          value={month}
          onValueChange={(m) => {
            setMonth(m);
            setValue("");
          }}
        >
          <SelectTrigger id="coach-month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {months.map((m) => (
              <SelectItem key={m} value={m}>
                {monthName(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <dl className="grid gap-1 rounded-xl bg-surface-2 px-3.5 py-3 text-[12.5px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Logged from sales</dt>
          <dd className="font-bold tabular-nums">{pv(current.logged)} PV</dd>
        </div>
        {current.override && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              Set by {who ?? "an upline"} on {reachedShort(current.override.setAt.slice(0, 10))}
            </dt>
            <dd className="font-bold tabular-nums">{pv(current.override.pv)} PV</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t border-line pt-1">
          <dt className="font-semibold">Counts toward milestones</dt>
          <dd className="font-extrabold tabular-nums">{pv(current.pv)} PV</dd>
        </div>
      </dl>

      <div className="grid gap-1.5">
        <Label htmlFor="coach-pv" className="text-xs font-semibold">
          {name}'s PV for {monthName(month)} (from the Amway app)
        </Label>
        <Input
          id="coach-pv"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={value}
          placeholder={current.override ? String(current.override.pv) : String(current.logged)}
          onChange={(e) => setValue(e.target.value)}
        />
        <p className="text-[11.5px] text-muted-foreground">
          It replaces what's logged for that month.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!valid}>
          Save {monthName(month)} PV
        </Button>
        {current.override && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (setMonthPv(person.id, month, null)) {
                toast.success(`${name}'s ${monthName(month)} PV is back to the logged total`);
                onDone();
              }
            }}
          >
            Use the logged total
          </Button>
        )}
      </div>
    </form>
  );
}

function MarkForm({
  person,
  path,
  initial,
  onDone,
}: {
  person: CrmPerson;
  path: GrowthPath;
  initial?: GrowthMilestoneCode;
  onDone: () => void;
}) {
  const name = firstName(person.name);
  const fallback = path.next?.code ?? GROWTH_MILESTONES[GROWTH_MILESTONES.length - 1].code;
  const [code, setCode] = useState<GrowthMilestoneCode>(initial ?? fallback);
  const status = path.milestones.find((m) => m.code === code)!;
  const [date, setDate] = useState(status.mark?.reachedOn ?? localDate());
  const [note, setNote] = useState(status.mark?.note ?? "");
  const today = localDate();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
  // A mark makes a permanent milestone reached; for the others it's history.
  const history = status.hold !== "permanent";

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        if (markMilestoneReached(person.id, code, date, note)) {
          toast.success(
            history
              ? `Recorded when ${name} first hit ${status.label}`
              : `${status.label} marked as reached for ${name}`,
          );
          onDone();
        } else toast.error("Only an upline can mark this.");
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="coach-code" className="text-xs font-semibold">
          Milestone
        </Label>
        <Select
          value={code}
          onValueChange={(c) => {
            const next = c as GrowthMilestoneCode;
            const s = path.milestones.find((m) => m.code === next);
            setCode(next);
            setDate(s?.mark?.reachedOn ?? today);
            setNote(s?.mark?.note ?? "");
          }}
        >
          <SelectTrigger id="coach-code">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {path.milestones.map((m) => (
              <SelectItem key={m.code} value={m.code}>
                {m.label}
                {m.firstReachedOn && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {m.held && m.hold === "permanent"
                      ? `reached ${reachedShort(m.firstReachedOn)}`
                      : `${m.held ? "held · " : ""}first hit ${reachedShort(m.firstReachedOn)}`}
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {history && (
        <p className="rounded-xl bg-surface-2 px-3.5 py-3 text-[12.5px] text-muted-foreground">
          Record when {name} first hit {status.label}. It's kept as history and doesn't make it
          count now: {status.label} counts while {name}{" "}
          {status.hold === "live"
            ? "meets it with today's numbers"
            : "meets it this month or met it last month"}
          {status.hold === "monthly" ? " (set a month's PV for that)" : ""}.
        </p>
      )}
      {status.autoOn && (
        <p className="rounded-xl bg-surface-2 px-3.5 py-3 text-[12.5px] text-muted-foreground">
          The team's data already shows {name} {history ? "first hitting" : "reaching"}{" "}
          {status.label} on <b className="text-foreground">{reachedLong(status.autoOn)}</b>. A date
          marked by hand only counts when it's earlier.
        </p>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="coach-date" className="text-xs font-semibold">
          {history ? "First hit on" : "Reached on"}
        </Label>
        <Input
          id="coach-date"
          type="date"
          max={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="coach-note" className="text-xs font-semibold">
          Note (optional)
        </Label>
        <Textarea
          id="coach-note"
          rows={2}
          value={note}
          placeholder="e.g. From before the app"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!valid}>
          {status.mark
            ? history
              ? "Save the date"
              : "Save the mark"
            : history
              ? "Record it"
              : "Mark as reached"}
        </Button>
        {status.mark && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (markMilestoneReached(person.id, code, null)) {
                toast.success(`Removed the hand mark for ${status.label}`);
                onDone();
              }
            }}
          >
            Remove the mark
          </Button>
        )}
      </div>
    </form>
  );
}
