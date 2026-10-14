import { useState } from "react";
import { toast } from "sonner";
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
import {
  MILESTONE_LABEL,
  TRANSITIONS,
  setConversionTargets,
  setTeamGoal,
  validGoal,
  validTarget,
  type ConversionTargets,
  type TeamSettingsView,
  type TransitionKey,
} from "@/data";

/**
 * Your team's first-meeting goal and conversion targets. Values you don't set
 * come from your upline; "Use upline's" clears yours.
 */
export function TeamGoalsDialog({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: TeamSettingsView;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Team goals</DialogTitle>
          <DialogDescription>
            For you and your team. Leaders under you use these until they set their own.
          </DialogDescription>
        </DialogHeader>
        {open && <GoalsForm settings={settings} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function GoalsForm({ settings, onDone }: { settings: TeamSettingsView; onDone: () => void }) {
  const [goal, setGoal] = useState(String(settings.mg1Goal));
  const [targets, setTargets] = useState<Record<TransitionKey, string>>({
    contactToMeeting: String(settings.targets.contactToMeeting),
    meetingToPlan: String(settings.targets.meetingToPlan),
    planToRegistered: String(settings.targets.planToRegistered),
  });
  const goalN = Number(goal);
  const t = Object.fromEntries(
    Object.entries(targets).map(([k, v]) => [k, Number(v)]),
  ) as unknown as ConversionTargets;
  const valid = validGoal(goalN) && Object.values(t).every(validTarget);
  const ownGoal = settings.goalFromId === settings.personId;
  const ownTargets = settings.targetsFromId === settings.personId;
  const upline = settings.inherited.from ?? "the app";

  const save = () => {
    if (!valid) return;
    const sameGoal = goalN === settings.mg1Goal;
    const sameTargets = (Object.keys(t) as TransitionKey[]).every(
      (k) => t[k] === settings.targets[k],
    );
    if (!sameGoal || ownGoal) setTeamGoal(goalN);
    if (!sameTargets || ownTargets) setConversionTargets(t);
    toast.success("Team goals saved");
    onDone();
  };
  const useUpline = () => {
    setTeamGoal(null);
    setConversionTargets(null);
    toast.success(`Using ${upline === "the app" ? "the default" : `${upline}'s`} goals`);
    onDone();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="tg-goal">First meetings (MG1) a month</Label>
        <Input
          id="tg-goal"
          type="number"
          inputMode="numeric"
          min={1}
          className="w-32"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
        <p className="text-[11.5px] text-muted-foreground">
          80 a month is the activity needed for the 25% level after about six months.
        </p>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Conversion targets</legend>
        {TRANSITIONS.map(({ key, from, to }) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <Label htmlFor={`tg-${key}`} className="text-[13px] font-normal">
              {MILESTONE_LABEL[from]} → {MILESTONE_LABEL[to]}
            </Label>
            <span className="flex items-center gap-1.5">
              <Input
                id={`tg-${key}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                className="w-20 text-right"
                value={targets[key]}
                onChange={(e) => setTargets((s) => ({ ...s, [key]: e.target.value }))}
              />
              <span className="text-[13px] text-muted-foreground">%</span>
            </span>
          </div>
        ))}
      </fieldset>
      {!valid && (
        <p className="text-[12px] text-bad">
          Use whole numbers: a goal of 1 or more, targets 1–100%.
        </p>
      )}
      <DialogFooter className="gap-2 sm:justify-between">
        {(ownGoal || ownTargets) && (
          <Button type="button" variant="outline" onClick={useUpline}>
            Use {upline === "the app" ? "defaults" : `${upline}'s`}
          </Button>
        )}
        <Button type="submit" disabled={!valid}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
