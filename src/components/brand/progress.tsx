import type { ReactNode } from "react";
import { format } from "date-fns";
import { parseDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Stacked horizontal bar on the track color. Each segment's width is
 * `value / total` (total defaults to the sum of values). Give each segment a
 * fill class, e.g. "bg-sky", "bg-amber", or a stage solid "bg-stage-ibo".
 */
export function SegmentedBar({
  segments,
  total,
  height = 8,
  className,
}: {
  segments: { value: number; className: string; label?: string }[];
  total?: number;
  height?: number;
  className?: string;
}) {
  const sum = total ?? segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const label = segments
    .filter((s) => s.label)
    .map((s) => `${s.label}: ${s.value}`)
    .join(", ");
  return (
    <div
      className={cn("flex w-full overflow-hidden rounded-full bg-track", className)}
      style={{ height }}
      role="img"
      aria-label={label || undefined}
    >
      {sum > 0 &&
        segments.map((s, i) => (
          <span
            key={i}
            className={cn("block h-full", s.className)}
            style={{ width: `${(Math.max(0, s.value) / sum) * 100}%` }}
            title={s.label ? `${s.label}: ${s.value}` : undefined}
          />
        ))}
    </div>
  );
}

/**
 * Circular progress (0..1) in sky on the track color, with the percentage (or
 * a custom `label`) in the middle.
 */
export function ProgressRing({
  value,
  size = 84,
  stroke,
  label,
  className,
  arcClassName = "stroke-sky",
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: ReactNode;
  className?: string;
  arcClassName?: string;
}) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const sw = stroke ?? Math.max(4, Math.round(size * 0.107));
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${Math.round(v * 100)}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={sw}
          className="stroke-track"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          className={cn(v === 0 && "hidden", arcClassName)}
        />
      </svg>
      <span
        className="absolute inset-0 grid place-items-center font-extrabold tabular-nums"
        style={{ fontSize: Math.max(11, Math.round(size * 0.21)) }}
      >
        {label ?? `${Math.round(v * 100)}%`}
      </span>
    </div>
  );
}

/** Stacked calendar badge: "NOV" over "7" for a "YYYY-MM-DD" date. */
export function DateBadge({ date, className }: { date: string; className?: string }) {
  const d = parseDate(date);
  return (
    <div
      className={cn(
        "grid w-[52px] shrink-0 rounded-[10px] bg-surface-2 py-1.5 text-center",
        className,
      )}
      aria-label={format(d, "MMMM d, yyyy")}
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {format(d, "MMM")}
      </span>
      <span className="text-lg font-extrabold leading-tight tabular-nums">{format(d, "d")}</span>
    </div>
  );
}
