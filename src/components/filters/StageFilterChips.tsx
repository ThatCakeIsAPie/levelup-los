import { STAGE_CHIP_CLASS, STAGE_LABEL, STAGE_SOLID_CLASS } from "@/components/brand";
import type { BizClass } from "@/data";
import { cn } from "@/lib/utils";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Multi-select stage chips: "All" plus one chip per stage, each with a count.
 * Several stages can be on at once (Apprentice + IBO); none on = everyone.
 * Used by the People list and the event attendee views.
 */
export function StageFilterChips<S extends BizClass>({
  stages,
  value,
  onChange,
  counts,
  total,
  label = "Stage",
  className,
}: {
  /** The chips to show, in order. */
  stages: readonly S[];
  /** Stages switched on (empty = all). */
  value: readonly S[];
  onChange: (next: S[]) => void;
  counts: Partial<Record<S, number>>;
  /** Count on the "All" chip. */
  total: number;
  label?: string;
  className?: string;
}) {
  const allOn = value.length === 0;
  const toggle = (s: S) => {
    const set = new Set(value);
    if (set.has(s)) set.delete(s);
    else set.add(s);
    // Every stage on is the same as "All".
    onChange(set.size === stages.length ? [] : stages.filter((x) => set.has(x)));
  };
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      <button
        type="button"
        aria-pressed={allOn}
        onClick={() => onChange([])}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
          allOn
            ? "border-foreground bg-foreground text-background"
            : "border-line text-muted-foreground hover:border-foreground/30 hover:text-foreground",
          FOCUS,
        )}
      >
        All
        <span className={cn("tabular-nums", allOn ? "opacity-80" : "text-faint")}>{total}</span>
      </button>
      {stages.map((s) => {
        const on = value.includes(s);
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(s)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
              on
                ? cn("border-transparent", STAGE_CHIP_CLASS[s])
                : "border-line text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              FOCUS,
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                STAGE_SOLID_CLASS[s],
                on && "ring-1 ring-current/40",
              )}
              aria-hidden="true"
            />
            {STAGE_LABEL[s]}
            <span className={cn("tabular-nums", on ? "opacity-80" : "text-faint")}>
              {counts[s] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
