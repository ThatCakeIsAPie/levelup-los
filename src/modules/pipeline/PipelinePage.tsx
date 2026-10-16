import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarDays, Columns3, Kanban, Plus, Target } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  PIPELINE_PERIODS,
  localDate,
  monthName,
  monthOf,
  usePipelineAccess,
  usePipelineActivity,
  usePipelineBoard,
  usePipelineColumns,
  usePipelineConversions,
  usePipelineMonths,
  usePipelineScope,
  usePipelineScopes,
  useTeamSettings,
  type PeriodDays,
  type PipelineScope,
} from "@/data";
import { BoardTab } from "./BoardTab";
import { ownCards } from "./format";
import { ConversionsTab } from "./ConversionsTab";
import { ScopeToggle } from "./ScopeToggle";
import { CustomizeStepsDialog } from "./CustomizeStepsDialog";
import { AddProspectDialog } from "./AddProspectDialog";
import { StatRequestsPanel } from "./StatsSharing";
import { TeamGoalsDialog } from "./TeamGoalsDialog";

export type PipelineTab = "board" | "conversions";

const PAGE = "grid w-full min-w-0 content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]";

const PERIOD_LABEL: Record<PeriodDays, string> = {
  30: "Last 30 days",
  90: "Last 90 days",
  180: "Last 6 months",
  365: "Last 12 months",
};

/**
 * Pipeline: Board (this month's activity against the goal, then the board)
 * and Conversions (where people drop off, per-person hotspots). Candidates
 * get an explanation instead.
 */
export function PipelinePage({
  tab,
  onTab,
}: {
  tab: PipelineTab;
  onTab: (tab: PipelineTab) => void;
}) {
  const access = usePipelineAccess();
  if (!access.enabled) return <NoPipeline />;
  return <Pipeline tab={tab} onTab={onTab} />;
}

function Pipeline({ tab, onTab }: { tab: PipelineTab; onTab: (tab: PipelineTab) => void }) {
  const access = usePipelineAccess();
  const scopes = usePipelineScopes();
  const [scope, setScope] = useState<PipelineScope>("team");
  const current = monthOf(localDate());
  const [month, setMonth] = useState(current);
  const [period, setPeriod] = useState<PeriodDays>(90);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const months = usePipelineMonths();
  const opt = usePipelineScope(scope);
  const board = usePipelineBoard(scope, month);
  const activity = usePipelineActivity(scope, month);
  const conv = usePipelineConversions(scope, period);
  const settings = useTeamSettings(scope);
  const myColumns = usePipelineColumns(access.personId ?? undefined);
  const isThisMonth = month === current;
  const own = useMemo(
    () => (board && access.personId ? ownCards(board, access.personId) : null),
    [board, access.personId],
  );

  const who =
    scope === "team"
      ? "Your whole business"
      : scope === "mine"
        ? "Just your prospects"
        : (opt?.label ?? "");
  const subtitle =
    tab === "board"
      ? `${who} · ${monthName(month)} · ${board?.inProgress ?? 0} prospects in progress${own?.mixed ? ` · ${own.mine} yours` : ""}`
      : `${who} · ${PERIOD_LABEL[period].toLowerCase()} · ${conv?.counts.contact ?? 0} contacts made`;

  return (
    <div className={PAGE}>
      <PageHeader
        title="Pipeline"
        subtitle={subtitle}
        actions={
          <>
            <ScopeToggle scopes={scopes} scope={scope} onScope={setScope} />
            {tab === "board" ? (
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger
                  className="h-9 w-auto gap-1.5 text-[13px] font-semibold"
                  aria-label="Month"
                >
                  <CalendarDays
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...months].reverse().map((m) => (
                    <SelectItem key={m} value={m}>
                      {monthName(m)}
                      {m.slice(0, 4) !== current.slice(0, 4) ? ` ${m.slice(0, 4)}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select
                value={String(period)}
                onValueChange={(v) => setPeriod(Number(v) as PeriodDays)}
              >
                <SelectTrigger
                  className="h-9 w-auto gap-1.5 text-[13px] font-semibold"
                  aria-label="Period"
                >
                  <CalendarDays
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PIPELINE_PERIODS.map((p) => (
                    <SelectItem key={p} value={String(p)}>
                      {PERIOD_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {tab === "board" && (
              <>
                {settings?.canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => setGoalsOpen(true)}
                    aria-label="Team goals"
                  >
                    <Target /> <span className="hidden sm:inline">Goals</span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => setStepsOpen(true)}
                >
                  <Columns3 /> <span className="hidden sm:inline">Customize steps</span>
                  <span className="sm:hidden">Steps</span>
                </Button>
                <Button size="sm" className="h-9" variant="soft" onClick={() => setAddOpen(true)}>
                  <Plus /> <span className="hidden sm:inline">Add prospect</span>
                  <span className="sm:hidden">Add</span>
                </Button>
              </>
            )}
          </>
        }
      />

      <StatRequestsPanel />

      <div role="tablist" aria-label="Pipeline views" className="flex gap-1 border-b border-line">
        {(["board", "conversions"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => onTab(t)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "board" ? "Board" : "Conversions"}
          </button>
        ))}
      </div>

      {tab === "board"
        ? board &&
          activity && (
            <BoardTab board={board} activity={activity} month={month} isThisMonth={isThisMonth} />
          )
        : conv && settings && <ConversionsTab conv={conv} settings={settings} />}

      <CustomizeStepsDialog open={stepsOpen} onOpenChange={setStepsOpen} />
      <AddProspectDialog open={addOpen} onOpenChange={setAddOpen} columns={myColumns} />
      {settings?.canEdit && (
        <TeamGoalsDialog open={goalsOpen} onOpenChange={setGoalsOpen} settings={settings} />
      )}
    </div>
  );
}

/** Candidates: no pipeline yet, with what it is and where to go instead. */
function NoPipeline() {
  return (
    <div className={cn(PAGE, "mx-auto max-w-2xl")}>
      <PageHeader title="Pipeline" />
      <EmptyState
        icon={<Kanban />}
        title="Your pipeline starts when you register"
        body="Once you're an apprentice, the people you invite show up here as cards: from the first contact to their first meeting, the plan and registering. Until then, your sponsor keeps track with you."
        action={
          <Button asChild variant="soft">
            <Link to="/business">Back to My business</Link>
          </Button>
        }
      />
    </div>
  );
}
