import { SegmentedBar } from "@/components/brand";
import { usePipelineAccess, type PipelineBoard } from "@/data";
import { cn } from "@/lib/utils";
import { inPipeline } from "./format";

/** Segment fills, in band order. */
const FILLS = ["bg-sky", "bg-primary", "bg-amber"];

/**
 * How many people are in the pipeline right now: every card from the first
 * meeting on (the milestone column and the steps after it) up to the last
 * milestone, which doesn't count ("Registered", "On Ditto"). Not contacted
 * yet, Contact made and the not-now columns don't count either.
 */
export function InPipelineCard({
  board,
  bands,
  until,
}: {
  board: PipelineBoard<string>;
  /** The bands that count, in board order, with their labels. */
  bands: { id: string; label: string }[];
  /** The milestone that ends it ("Registered"). */
  until: string;
}) {
  const { personId } = usePipelineAccess();
  const now = inPipeline(
    board,
    bands.map((b) => b.id),
    personId,
  );
  const label = (band: string) => bands.find((b) => b.id === band)?.label ?? band;
  return (
    <section className="grid gap-3 rounded-card border border-line bg-card px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-6 sm:px-[18px]">
      <div className="flex items-baseline gap-2.5">
        <b className="text-[28px] font-extrabold leading-none tabular-nums">{now.total}</b>
        <div className="grid">
          <h2 className="text-sm font-bold">
            In your pipeline now
            {now.mixed && <span className="font-bold text-primary-ink"> · {now.mine} yours</span>}
          </h2>
          <p className="text-[12px] text-muted-foreground">From the first meeting until {until}</p>
        </div>
      </div>
      <div className="grid gap-1.5">
        <SegmentedBar
          segments={now.byBand.map((b, i) => ({
            value: b.count,
            className: FILLS[i % FILLS.length],
            label: label(b.band),
          }))}
        />
        <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-muted-foreground">
          {now.byBand.map((b, i) => (
            <li key={b.band} className="flex items-center gap-1.5">
              <i
                className={cn("block size-2 rounded-full", FILLS[i % FILLS.length])}
                aria-hidden="true"
              />
              <b className="font-bold text-foreground tabular-nums">{b.count}</b> {label(b.band)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
