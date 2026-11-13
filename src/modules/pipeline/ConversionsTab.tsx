import { Fragment, useState } from "react";
import { ArrowRight, Lightbulb, Settings2, ThumbsUp, UserPlus } from "lucide-react";
import { PersonAvatar, Sensitive } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  MILESTONES,
  MIN_SAMPLE,
  TRANSITIONS,
  useStageNames,
  type BandBreakdown,
  type HotspotRow,
  type PipelineConversions,
  type RateTone,
  type TeamSettingsView,
  type TransitionKey,
  type StageNames,
  type TransitionStat,
  useCurrentUser,
} from "@/data";
import { RequestStatsDialog } from "./StatsSharing";
import { TeamGoalsDialog } from "./TeamGoalsDialog";

const TONE_TEXT: Record<RateTone, string> = {
  good: "text-good",
  warn: "text-warn-ink",
  bad: "text-bad",
};
const TONE_CELL: Record<RateTone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn-ink",
  bad: "bg-bad-soft text-bad",
};

/** A transition as a short label ("Contact → First meeting"), with the viewer's stage names. */
const transitionLabel = (names: StageNames, key: TransitionKey): string => {
  const t = TRANSITIONS.find((x) => x.key === key)!;
  return `${names.name(t.from)} → ${names.name(t.to)}`;
};

/** What happened to people at a transition, in words that hold for any stage name. */
const verbs = (names: StageNames, key: TransitionKey): { did: string; lost: string } => {
  const to = names.name(TRANSITIONS.find((x) => x.key === key)!.to);
  return { did: `reached ${to}`, lost: `stopped before ${to}` };
};

/** Conversions tab: where people drop off, inside your steps, and whose process needs help. */
export function ConversionsTab({
  conv,
  settings,
}: {
  conv: PipelineConversions;
  settings: TeamSettingsView;
}) {
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <section className="grid min-w-0 content-start gap-3 rounded-card border border-line bg-card px-4 py-4 sm:px-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Where people drop off</h2>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <i className="inline-block h-3 w-0.5 bg-amber-strong" aria-hidden="true" /> Target
          </span>
        </div>
        <Funnel conv={conv} />
        <Notice conv={conv} />
        <div className="grid gap-2">
          {conv.breakdowns.map((b) => (
            <StepSplit key={b.band} b={b} />
          ))}
        </div>
        <p className="text-[11.5px] text-muted-foreground">
          Targets{" "}
          {settings.targetsFrom
            ? `set by ${settings.targetsFrom === "You" ? "you" : settings.targetsFrom}`
            : "are the defaults"}
          .{" "}
          {settings.canEdit ? (
            <button
              type="button"
              onClick={() => setGoalsOpen(true)}
              className="rounded-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              Change team goals
            </button>
          ) : (
            "Each leader sets them for their own team."
          )}
        </p>
      </section>

      <section className="grid min-w-0 content-start gap-3 rounded-card border border-line bg-card px-4 py-4 sm:px-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Hotspots by team member</h2>
          <span className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <Legend tone="good" label="At target" />
            <Legend tone="warn" label="Within 5 pts" />
            <Legend tone="bad" label="5+ pts below" />
          </span>
        </div>
        <Hotspots conv={conv} />
        <p className="text-[12px] text-muted-foreground">
          Tap a cell to see the numbers behind it. Only your own row and your downline&rsquo;s are
          shown; crosslines see each other only if they share. Fewer than {MIN_SAMPLE} people at a
          step shows &ldquo;–&rdquo;.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setRequestOpen(true)}>
            <UserPlus /> Request someone&rsquo;s stats
          </Button>
          {settings.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => setGoalsOpen(true)}>
              <Settings2 /> Targets
            </Button>
          )}
        </div>
      </section>
      {settings.canEdit && (
        <TeamGoalsDialog open={goalsOpen} onOpenChange={setGoalsOpen} settings={settings} />
      )}
      <RequestStatsDialog open={requestOpen} onOpenChange={setRequestOpen} />
    </div>
  );
}

function Legend({ tone, label }: { tone: RateTone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i
        className={cn("inline-block size-2.5 rounded-[3px]", TONE_CELL[tone])}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function Funnel({ conv }: { conv: PipelineConversions }) {
  const names = useStageNames("recruiting");
  const top = Math.max(1, conv.counts.contact);
  return (
    <div className="grid gap-1" role="list" aria-label="Funnel by milestone">
      {MILESTONES.map((m, i) => {
        const stat = i > 0 ? conv.stats[i - 1] : null;
        const n = conv.counts[m];
        // Where the bar would end if the step before were exactly on target.
        const tick = stat ? (stat.fromCount * stat.target) / 100 / top : null;
        return (
          <Fragment key={m}>
            {stat && (
              <FunnelStep
                stat={stat}
                names={names}
                hot={conv.gap?.key === stat.key}
                referrals={conv.referralSources[i - 1] ?? 0}
              />
            )}
            <div
              role="listitem"
              className="grid grid-cols-[84px_minmax(0,1fr)_44px] items-center gap-2.5 text-[12.5px] lg:grid-cols-[96px_minmax(0,1fr)_44px]"
            >
              <span className="truncate font-semibold" title={names.name(m)}>
                {names.name(m)}
              </span>
              <div className="relative h-[22px] overflow-hidden rounded-md bg-surface-2">
                <i
                  className={cn(
                    "block h-full rounded-md",
                    m === "registered" ? "bg-good" : "bg-progress",
                  )}
                  style={{ width: `${(n / top) * 100}%` }}
                />
                {tick !== null && (
                  <span
                    className="absolute inset-y-0 w-0.5 bg-amber-strong"
                    style={{ left: `${Math.min(99.5, tick * 100)}%` }}
                    aria-hidden="true"
                  />
                )}
              </div>
              <b className="text-right font-extrabold tabular-nums">{n}</b>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function FunnelStep({
  stat,
  names,
  hot,
  referrals,
}: {
  stat: TransitionStat;
  names: StageNames;
  hot: boolean;
  /** Of those who stopped here, how many passed on names (Referral source). */
  referrals: number;
}) {
  const v = verbs(names, stat.key);
  return (
    <div
      className={cn(
        "ml-[94px] flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-l-2 py-[3px] pl-2.5 text-[11.5px] lg:ml-[106px]",
        hot ? "rounded-r-lg border-bad bg-bad-soft" : "border-line",
      )}
    >
      <span className={cn("font-bold", stat.tone && TONE_TEXT[stat.tone])}>
        {stat.pct === null ? `Too few to rate` : `${stat.pct}% ${v.did}`}
      </span>
      <em className="not-italic text-muted-foreground">
        target {stat.target}%{hot ? " · biggest gap" : ""}
      </em>
      {stat.lost > 0 && (
        <small className="text-[11px] text-muted-foreground">
          {stat.lost} {v.lost}
          {referrals > 0 && (
            <span className="font-semibold text-primary-ink"> · {referrals} passed on names</span>
          )}
        </small>
      )}
    </div>
  );
}

function Notice({ conv }: { conv: PipelineConversions }) {
  const names = useStageNames("recruiting");
  if (!conv.gap) {
    const rated = conv.stats.some((s) => s.pct !== null);
    return (
      <div className="flex gap-2.5 rounded-lg bg-good-soft px-3 py-2.5 text-[12.5px]">
        <ThumbsUp className="mt-0.5 size-4 shrink-0 text-good" aria-hidden="true" />
        <div>
          {rated
            ? "Every conversion is at or above target. Keep the activity up."
            : `Not enough activity in this period to compare with targets yet.`}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5 rounded-lg bg-warn-soft px-3 py-2.5 text-[12.5px] text-foreground">
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
      <div>
        <b>
          Biggest gap: {names.name(conv.gap.from)} → {names.name(conv.gap.to)}.
        </b>{" "}
        {conv.tip}
      </div>
    </div>
  );
}

function StepSplit({ b }: { b: BandBreakdown }) {
  const names = useStageNames("recruiting");
  if (b.items.length < 2 && !b.cohort) return null;
  return (
    <div className="grid gap-1.5 rounded-lg border border-line px-3 py-2.5 text-[12px]">
      <b>Inside your steps after {names.name(b.band)}</b>
      {b.cohort === 0 ? (
        <span className="text-muted-foreground">
          Nobody reached {names.name(b.band)} in this period.
        </span>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {b.items.map((it) => (
              <Fragment key={it.column.id}>
                <span className="rounded-[7px] bg-surface-2 px-2 py-0.5 font-semibold">
                  {it.column.kind === "milestone" ? names.name(it.column.band) : it.column.label}{" "}
                  <em className="ml-0.5 font-extrabold not-italic text-muted-foreground">
                    {it.count}
                  </em>
                </span>
                <ArrowRight className="size-3 text-faint" aria-hidden="true" />
              </Fragment>
            ))}
            <span className="rounded-[7px] bg-surface-2 px-2 py-0.5 font-semibold">
              {names.name(b.next.milestone)}{" "}
              <em className="ml-0.5 font-extrabold not-italic text-muted-foreground">
                {b.next.count}
              </em>
            </span>
          </div>
          {b.worst && (
            <small className="text-[11.5px] text-muted-foreground">
              {b.worst.stalled} of {b.worst.of} stalled at{" "}
              {b.worst.column.kind === "milestone"
                ? names.name(b.worst.column.band)
                : b.worst.column.label}
              , the biggest drop inside this band.
            </small>
          )}
        </>
      )}
    </div>
  );
}

function Hotspots({ conv }: { conv: PipelineConversions }) {
  const names = useStageNames("recruiting");
  const me = useCurrentUser().personId;
  const [all, setAll] = useState(false);
  // People with too little activity for any rate fold away until asked for.
  const rated = conv.rows.filter((r) => r.personId === me || r.stats.some((s) => s.pct !== null));
  const quiet = conv.rows.length - rated.length;
  const rows = all ? conv.rows : rated;
  const team: HotspotRow = {
    personId: "team",
    name: "Team",
    stage: undefined,
    counts: conv.counts,
    stats: conv.stats,
    shared: false,
  };
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div
        role="table"
        aria-label="Conversion rates by team member"
        className="grid min-w-[300px] grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] items-center gap-[5px] text-[12.5px]"
      >
        <div role="row" className="contents">
          <span role="columnheader" />
          {TRANSITIONS.map((t) => (
            <span
              key={t.key}
              role="columnheader"
              className="pb-1 text-center text-[10.5px] font-bold leading-tight text-muted-foreground lg:text-[11px]"
            >
              {transitionLabel(names, t.key)}
              <small className="block font-semibold text-faint">
                target {conv.targets[t.key]}%
              </small>
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <HotRow key={r.personId} row={r} names={names} />
        ))}
        {quiet > 0 && (
          <button
            type="button"
            onClick={() => setAll((v) => !v)}
            className="col-span-4 justify-self-start rounded-sm py-1 text-[12px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {all ? "Show fewer" : `Show ${quiet} more with too little activity to rate`}
          </button>
        )}
        {conv.rows.length === 0 && (
          <p className="col-span-4 py-2 text-[12px] text-faint">No activity in this period yet.</p>
        )}
        <HotRow row={team} names={names} total />
        {conv.sharedRows.length > 0 && (
          <>
            <span className="col-span-4 pt-2 text-[11px] font-bold uppercase tracking-[.08em] text-faint">
              Shared with you
            </span>
            {conv.sharedRows.map((r) => (
              <HotRow key={r.personId} row={r} names={names} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function HotRow({ row, names, total }: { row: HotspotRow; names: StageNames; total?: boolean }) {
  return (
    <div role="row" className="contents">
      <span
        role="rowheader"
        className={cn(
          "flex min-w-0 items-center gap-1.5 font-semibold",
          total && "border-t border-line pt-1.5 font-extrabold",
        )}
      >
        {!total && (
          <PersonAvatar
            name={row.name}
            stage={row.stage}
            size="sm"
            className="size-[18px] text-[8px]"
          />
        )}
        <span className="truncate">
          <Sensitive kind="name">{row.name}</Sensitive>
        </span>
      </span>
      {row.stats.map((s) => (
        <Cell key={s.key} stat={s} name={row.name} names={names} total={total} />
      ))}
    </div>
  );
}

function Cell({
  stat,
  name,
  names,
  total,
}: {
  stat: TransitionStat;
  name: string;
  names: StageNames;
  total?: boolean;
}) {
  const v = verbs(names, stat.key);
  const short = transitionLabel(names, stat.key);
  return (
    <span role="cell" className={cn(total && "pt-1.5")}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "w-full rounded-[7px] py-[7px] text-center font-extrabold tabular-nums focus-visible:outline-2 focus-visible:outline-ring",
              stat.tone ? TONE_CELL[stat.tone] : "bg-surface-2 text-faint",
              total && "outline outline-[1.5px] -outline-offset-[1.5px] outline-current",
            )}
            aria-label={`${name}, ${short}: ${stat.pct === null ? "not enough people" : `${stat.pct}%, target ${stat.target}%`}`}
          >
            {stat.pct === null ? "–" : `${stat.pct}%`}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 text-[12.5px]" align="center">
          <b className="block">
            <Sensitive kind="name">{name}</Sensitive>
          </b>
          <span className="text-muted-foreground">{short}</span>
          <p className="mt-1.5">
            {stat.toCount} of {stat.fromCount} {v.did}
            {stat.pct !== null ? ` (${stat.pct}%, target ${stat.target}%)` : ""}.
          </p>
          {stat.pct === null && (
            <p className="mt-1 text-muted-foreground">
              Fewer than {MIN_SAMPLE} people reached {names.name(stat.from)}, so there&rsquo;s no
              rate yet.
            </p>
          )}
        </PopoverContent>
      </Popover>
    </span>
  );
}
