import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { CalendarClock, ClockAlert, Flame, MoveRight, Undo2 } from "lucide-react";
import { SectionCard, ToneChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  RECRUITING_BAND_LABEL,
  parseDate,
  restorePipelineCard,
  useProspectPipeline,
  type CrmPerson,
} from "@/data";
import { MoveMenu } from "@/modules/pipeline/moveCard";
import { useMoveCard } from "@/modules/pipeline/useMoveCard";
import { ageLong, nextStepText } from "@/modules/pipeline/format";

const LINK =
  "rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring";

/**
 * A prospect's place on the pipeline board and how they got there (also the
 * history of someone who registered). Nothing for people with no pipeline
 * history, or for candidates.
 */
export function PipelineCard({ person }: { person: CrmPerson }) {
  const p = useProspectPipeline(person.id);
  const { move, dialog } = useMoveCard(p?.columns ?? []);
  const [all, setAll] = useState(false);
  if (!p) return null;
  const history = all ? p.history : p.history.slice(0, 4);
  const next = p.card ? nextStepText(p.card.nextStep, p.card.nextStepDate) : null;

  return (
    <SectionCard
      title="Pipeline"
      action={
        <Link to="/pipeline" className={LINK}>
          Open board
        </Link>
      }
    >
      {p.onBoard && p.column && (
        <div className="grid gap-2 rounded-[10px] bg-surface-2 px-3.5 py-3">
          <span className="text-[10px] font-extrabold uppercase tracking-[.08em] text-faint">
            {RECRUITING_BAND_LABEL[p.column.band]}
          </span>
          <div className="flex flex-wrap items-center gap-2 text-[14px]">
            <b>{p.ownStep ?? p.column.label}</b>
            {p.card?.hot && (
              <ToneChip tone="bad" icon={Flame}>
                Hot
              </ToneChip>
            )}
            {p.stale && (
              <ToneChip tone="warn" icon={ClockAlert}>
                No movement in {ageLong(p.days)}
              </ToneChip>
            )}
          </div>
          <span className="text-[12px] text-muted-foreground">
            {p.days === 0 ? "Moved here today" : `Here for ${ageLong(p.days)}`}
          </span>
          {next && (
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-primary-ink">
              <CalendarClock className="size-3.5" aria-hidden="true" /> {next}
            </span>
          )}
          <MoveMenu
            columns={p.columns}
            current={p.column.id}
            align="start"
            onMove={(to) => move(person.id, person.name, to)}
          >
            <Button variant="soft" size="sm" className="justify-self-start">
              <MoveRight /> Move to…
            </Button>
          </MoveMenu>
        </div>
      )}
      {p.dropped && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-surface-2 px-3.5 py-3 text-[13px]">
          <span className="text-muted-foreground">Taken off the board for now.</span>
          <Button size="sm" variant="soft" onClick={() => restorePipelineCard(person.id)}>
            <Undo2 /> Put back
          </Button>
        </div>
      )}
      {history.length > 0 ? (
        <ol className="grid gap-1.5 text-[12.5px]" aria-label="Pipeline history">
          {history.map((h) => (
            <li key={h.id} className="flex items-baseline gap-2">
              <span
                className={
                  h.to === h.milestone
                    ? "size-2 shrink-0 translate-y-[-1px] rounded-full bg-amber-strong"
                    : "size-2 shrink-0 translate-y-[-1px] rounded-full bg-track"
                }
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <b className="font-semibold">{h.toLabel}</b>
                <span className="text-muted-foreground"> · by {h.by}</span>
              </span>
              <span className="shrink-0 text-[11.5px] text-faint">
                {format(parseDate(h.at), "MMM d")}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">
          Not moved yet: they started in Contact made.
        </p>
      )}
      {p.history.length > 4 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className={`${LINK} justify-self-start text-[12.5px] font-semibold`}
        >
          {all ? "Show less" : `Show all ${p.history.length}`}
        </button>
      )}
      {dialog}
    </SectionCard>
  );
}
