import { cn } from "@/lib/utils";
import { ToneChip } from "@/components/brand";
import {
  MILESTONE_LABEL,
  monthName,
  percentChange,
  shiftMonth,
  type MilestoneCode,
  type PipelineActivity,
  type PipelineBoard,
} from "@/data";
import { Board } from "./Board";
import { deltaText, plural } from "./format";

/** Board tab: this month's first meetings against the goal, milestone activity, then the board. */
export function BoardTab({
  board,
  activity,
  month,
  isThisMonth,
}: {
  board: PipelineBoard;
  activity: PipelineActivity;
  month: string;
  isThisMonth: boolean;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)] lg:gap-4">
        <GoalCard activity={activity} month={month} isThisMonth={isThisMonth} />
        <Kpis activity={activity} month={month} />
      </div>
      <Board board={board} month={month} />
    </div>
  );
}

function perDayText(perDay: number): string {
  if (perDay <= 0) return "";
  if (perDay >= 0.75) return `about ${Math.round(perDay)} a day`;
  return `about ${Math.max(1, Math.round(perDay * 7))} a week`;
}

function GoalCard({
  activity,
  month,
  isThisMonth,
}: {
  activity: PipelineActivity;
  month: string;
  isThisMonth: boolean;
}) {
  const count = activity.counts.first_meeting;
  const goal = activity.goal;
  const top = Math.max(goal ?? 0, ...activity.series.map((s) => s.count), 1) * 1.12;
  const pace = activity.pace;
  const note =
    goal === null
      ? "Your own prospects. The team goal counts your whole team."
      : pace
        ? pace.reached
          ? `Goal reached · ${count - goal} over`
          : `${pace.remaining} to go in ${plural(pace.daysLeft, "day")} · ${perDayText(pace.perDay)}`
        : count >= goal
          ? `Goal reached · ${count - goal} over`
          : `${goal - count} short of the goal`;
  return (
    <section className="grid content-start gap-3 rounded-card border border-line bg-card px-4 py-4 sm:px-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold">
          First meetings <span className="hidden sm:inline">(MG1) </span>
          {isThisMonth ? "this month" : `in ${monthName(month)}`}
        </h2>
        {goal !== null && (
          <ToneChip tone="info">
            Goal<span className="hidden sm:inline">:</span> {goal}
            <span className="hidden sm:inline"> a month</span>
          </ToneChip>
        )}
      </div>
      <div className="grid items-end gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div>
          <div className="text-[28px] font-extrabold leading-none tabular-nums lg:text-[34px]">
            {count}
            {goal !== null && (
              <span className="text-[16px] font-bold text-faint lg:text-[18px]"> / {goal}</span>
            )}
          </div>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">{note}</p>
          {activity.goalFrom && goal !== null && (
            <p className="text-[11px] text-faint">
              {activity.goalFrom === "You" ? "Your team goal" : `Goal set by ${activity.goalFrom}`}
            </p>
          )}
        </div>
        <Trend series={activity.series} goal={goal} top={top} />
      </div>
      {goal !== null && (
        <div
          className="h-2 overflow-hidden rounded-full bg-track"
          role="progressbar"
          aria-label="First meetings against the goal"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(count, goal)}
        >
          <span
            className="block h-full rounded-full bg-sky"
            style={{ width: `${Math.min(100, (count / goal) * 100)}%` }}
          />
        </div>
      )}
    </section>
  );
}

function Trend({
  series,
  goal,
  top,
}: {
  series: { key: string; count: number }[];
  goal: number | null;
  top: number;
}) {
  const label = series.map((s) => `${monthName(s.key, "short")} ${s.count}`).join(", ");
  return (
    <div
      className="relative hidden h-[76px] grid-cols-6 items-end gap-1.5 pt-1 sm:grid lg:gap-2"
      role="img"
      aria-label={`First meetings per month: ${label}${goal ? `; goal ${goal}` : ""}`}
    >
      {series.map((s, i) => (
        <div
          key={s.key}
          className="grid h-full grid-rows-[minmax(0,1fr)_auto] justify-items-center gap-0.5"
        >
          <span className="relative flex w-full max-w-[26px] items-end self-stretch">
            <i
              className={cn(
                "block w-full rounded-t",
                i === series.length - 1 ? "bg-sky" : "bg-track",
              )}
              style={{ height: `${(s.count / top) * 100}%` }}
            />
          </span>
          <small className="text-[10px] font-semibold text-faint">
            {monthName(s.key, "short")}
          </small>
        </div>
      ))}
      {goal !== null && (
        <div
          className="pointer-events-none absolute inset-x-0 top-1 bottom-[17px]"
          aria-hidden="true"
        >
          <div
            className="absolute inset-x-0 border-t-[1.5px] border-dashed border-amber-strong"
            style={{ bottom: `${(goal / top) * 100}%` }}
          >
            <span className="absolute -top-[15px] right-0 text-[10px] font-bold text-amber-strong">
              {goal}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

const KPI: { m: MilestoneCode; label: string; short: string }[] = [
  { m: "contact", label: "Contacts made", short: "Contacts" },
  { m: "first_meeting", label: "First meetings", short: "MG1s" },
  { m: "first_plan", label: "First plans", short: "Plans" },
  { m: "registered", label: "Registered", short: "Registered" },
];

function Kpis({ activity, month }: { activity: PipelineActivity; month: string }) {
  const prev = monthName(shiftMonth(month, -1), "short");
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:gap-2.5">
      {KPI.map(({ m, label, short }) => {
        const now = activity.counts[m];
        const change = percentChange(now, activity.previous[m]);
        return (
          <div
            key={m}
            className={cn(
              "grid min-w-0 content-start gap-0.5 rounded-xl border bg-card px-2 py-2 sm:rounded-card sm:px-3.5 sm:py-3",
              m === "first_meeting"
                ? "border-sky shadow-[inset_0_0_0_1px_var(--color-sky)]"
                : "border-line",
            )}
          >
            <b className="text-lg font-extrabold leading-tight tabular-nums sm:text-[22px] lg:text-2xl">
              {now}
            </b>
            <span className="truncate text-[10.5px] text-muted-foreground sm:text-[12px]">
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{label}</span>
              <span className="sr-only"> ({MILESTONE_LABEL[m]} reached)</span>
            </span>
            <em
              className={cn(
                "mt-0.5 truncate text-[10px] font-bold not-italic sm:mt-1 sm:text-[11px]",
                change === null || change === 0
                  ? "text-faint"
                  : change > 0
                    ? "text-good"
                    : "text-bad",
              )}
            >
              {change === 0 ? (
                `same as ${prev}`
              ) : (
                <>
                  {deltaText(change)}
                  <span className="hidden sm:inline"> vs {prev}</span>
                </>
              )}
            </em>
          </div>
        );
      })}
    </div>
  );
}
