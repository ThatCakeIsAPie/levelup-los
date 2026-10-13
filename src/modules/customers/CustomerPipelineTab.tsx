import { useState, type ReactNode } from "react";
import { ArrowRight, Columns3, Plus, Users } from "lucide-react";
import { PageHeader, SectionCard } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CUSTOMER_BOARD,
  CUSTOMER_MILESTONE_LABEL,
  localDate,
  monthOf,
  useCustomerActivity,
  useCustomerBoard,
  useCustomerFunnel,
  useCustomerSummary,
  usePipelineScopes,
  type BoardDef,
  type CustomerBand,
  type CustomerFunnel,
  type PipelineBoard,
  type PipelineScope,
} from "@/data";
import { BoardView } from "@/modules/pipeline/Board";
import { Kpis, type KpiItem } from "@/modules/pipeline/BoardTab";
import { CustomizeStepsDialog } from "@/modules/pipeline/CustomizeStepsDialog";
import { pct, plural } from "@/modules/pipeline/format";
import { CustomerCardSheet } from "./CustomerCardSheet";
import { ListEntryDialog, type EntryDialogMode } from "./ListEntryDialog";
import { useCustomerMove } from "./useCustomerMove";

const PAGE = "grid w-full min-w-0 content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]";

const KPI: KpiItem[] = [
  { m: "contact", label: "Contacts", short: "Contacts", milestone: "Contact" },
  { m: "first_meeting", label: "First meetings", short: "Meetings", milestone: "First meeting" },
  {
    m: "first_sale",
    label: "First sales",
    short: "Sales",
    milestone: "First sale",
    highlight: true,
  },
  { m: "on_ditto", label: "On Ditto", short: "Ditto", milestone: "On Ditto" },
];

const SCOPE_LABEL: Partial<Record<string, string>> = { mine: "Just my list" };

/**
 * The customer pipeline: this month's milestones, conversions, then the board
 * (same board as the recruiting pipeline, with the customer layout).
 */
export function CustomerPipelineTab({ tabs }: { tabs: ReactNode }) {
  const scopes = usePipelineScopes();
  const [scope, setScope] = useState<PipelineScope>("team");
  const month = monthOf(localDate());
  const board = useCustomerBoard(scope, month);
  const activity = useCustomerActivity(scope, month);
  const summary = useCustomerSummary(scope);
  const funnel = useCustomerFunnel(scope, 90);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [entryDialog, setEntryDialog] = useState<EntryDialogMode | null>(null);

  return (
    <div className={PAGE}>
      <PageHeader
        title="Customers"
        subtitle={`${plural(summary.inProgress, "person", "people")} in progress · ${plural(summary.customers, "customer")} · ${summary.onDitto} on Ditto`}
        actions={
          <>
            {scopes.length > 2 && (
              <Select value={scope} onValueChange={(v) => setScope(v as PipelineScope)}>
                <SelectTrigger
                  className="h-9 w-auto min-w-0 max-w-[13rem] gap-1.5 text-[13px] font-semibold"
                  aria-label="Whose customer pipeline"
                >
                  <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {scopes.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {SCOPE_LABEL[s.value] ?? s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" className="h-9" onClick={() => setStepsOpen(true)}>
              <Columns3 /> <span className="hidden sm:inline">Customize steps</span>
              <span className="sm:hidden">Steps</span>
            </Button>
            <Button size="sm" className="h-9" onClick={() => setEntryDialog({ kind: "board" })}>
              <Plus /> <span className="hidden sm:inline">Add someone</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </>
        }
      />
      {tabs}
      {activity && funnel && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)] lg:gap-4">
          <div className="grid content-start gap-1.5">
            <h2 className="text-[12.5px] font-bold text-muted-foreground">This month</h2>
            <Kpis activity={activity} month={month} items={KPI} />
          </div>
          <Conversions funnel={funnel} />
        </div>
      )}
      {board && (
        <CustomerBoard
          board={board}
          month={month}
          onEdit={(entryId) => setEntryDialog({ kind: "edit", entryId })}
        />
      )}
      <CustomizeStepsDialog open={stepsOpen} onOpenChange={setStepsOpen} kind="customer" />
      <ListEntryDialog mode={entryDialog} onOpenChange={(o) => !o && setEntryDialog(null)} />
    </div>
  );
}

function CustomerBoard({
  board,
  month,
  onEdit,
}: {
  board: PipelineBoard<CustomerBand>;
  month: string;
  onEdit: (entryId: string) => void;
}) {
  const { move, dialog } = useCustomerMove(board.columns);
  return (
    <BoardView
      board={board as unknown as PipelineBoard<string>}
      month={month}
      def={CUSTOMER_BOARD as BoardDef<string>}
      move={move}
      sheet={({ card, open, onOpenChange }) => (
        <CustomerCardSheet
          card={card}
          columns={board.columns}
          open={open}
          onOpenChange={onOpenChange}
          onMove={move}
          onEdit={onEdit}
        />
      )}
    >
      {dialog}
    </BoardView>
  );
}

/** Milestone-to-milestone conversions over the last 90 days. */
function Conversions({ funnel }: { funnel: CustomerFunnel }) {
  return (
    <SectionCard title="Conversions · last 90 days">
      <ol className="grid grid-cols-4 gap-1 text-center">
        {(["contact", "first_meeting", "first_sale", "on_ditto"] as const).map((m, i) => {
          const rate = i > 0 ? funnel.rates[i - 1] : null;
          return (
            <li key={m} className="relative grid content-start gap-0.5">
              {rate && (
                <span
                  className="absolute top-1.5 -left-2 flex items-center text-faint"
                  aria-hidden="true"
                >
                  <ArrowRight className="size-3" />
                </span>
              )}
              <b className="text-lg font-extrabold tabular-nums">{funnel.counts[m]}</b>
              <span className="truncate text-[11px] text-muted-foreground">
                {CUSTOMER_MILESTONE_LABEL[m]}
              </span>
              {rate && (
                <span className="text-[11px] font-bold text-primary-ink">
                  {pct(rate.pct)}
                  <span className="sr-only"> of the step before</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[11px] text-faint">
        Rates show from {plural(10, "name")} at a step, so small numbers don&rsquo;t mislead.
      </p>
    </SectionCard>
  );
}
