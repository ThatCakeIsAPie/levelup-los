import type { Attendance } from "@/data";
import { SectionCard } from "@/components/brand";
import { cn } from "@/lib/utils";
import { STAGES, funnelCounts } from "./lib";

/**
 * Horizontal step chart. Each step counts people who reached it or went
 * further (so it never exceeds the step before), shown as a share of everyone
 * invited. The old version divided raw column counts by each other, which
 * produced numbers like "300% of prior".
 */
export function EventFunnel({ rows, finished }: { rows: Attendance[]; finished: boolean }) {
  const counts = funnelCounts(rows);
  const invited = counts.invited;

  return (
    <SectionCard title="Funnel">
      {invited === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          The funnel fills in once people are invited.
        </p>
      ) : (
        <ol className="grid gap-2.5">
          {STAGES.map((s, i) => {
            const value = counts[s.key];
            const pct = Math.round((value / invited) * 100);
            const prev = i > 0 ? counts[STAGES[i - 1].key] : null;
            const drop = prev !== null ? prev - value : 0;
            const pending = s.key === "attended" && !finished;
            return (
              <li key={s.key} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <span className={cn("size-2 rounded-full", s.dot)} aria-hidden="true" />
                    {s.funnelLabel}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {pending ? (
                      <span className="text-faint">After the event</span>
                    ) : (
                      <>
                        <b className="text-[13px] font-bold text-foreground">{value}</b>
                        {i > 0 && <span className="ml-1.5">{pct}%</span>}
                        {drop > 0 && (
                          <span className="ml-1.5 text-faint">
                            <span aria-hidden="true">−</span>
                            <span className="sr-only">down </span>
                            {drop}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </div>
                <div
                  className="h-2.5 overflow-hidden rounded-full bg-track"
                  role="img"
                  aria-label={
                    pending
                      ? `${s.funnelLabel}: after the event`
                      : `${s.funnelLabel}: ${value} of ${invited} invited, ${pct}%`
                  }
                >
                  {!pending && (
                    <span
                      className={cn("block h-full rounded-full", s.dot)}
                      style={{ width: `${Math.max(value > 0 ? 2 : 0, pct)}%` }}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {invited > 0 && (
        <p className="text-[11.5px] text-faint">
          Each step counts people who reached it or went further. Percentages are out of the{" "}
          {invited} invited; the small number is how many dropped off since the step before.
          Committed means a planned purchase date or a ticket.
        </p>
      )}
    </SectionCard>
  );
}
