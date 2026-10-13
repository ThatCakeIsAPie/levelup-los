import { AlertCircle, AlertTriangle } from "lucide-react";
import type { Attendance } from "@/data";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { riskReasons } from "./lib";

/** Small red/amber icon when a row has risk reasons (full text in a tooltip + for screen readers). */
export function RiskBadge({
  attendance,
  className,
  finished,
}: {
  attendance: Attendance;
  className?: string;
  /** Risks only matter before the event; past events show nothing. */
  finished?: boolean;
}) {
  const reasons = finished ? [] : riskReasons(attendance);
  if (!reasons.length) return null;
  const bad = reasons.some((r) => r.tone === "bad");
  const Icon = bad ? AlertCircle : AlertTriangle;
  const text = reasons.map((r) => r.label).join(". ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex shrink-0", bad ? "text-bad" : "text-warn", className)}>
          <Icon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">{text}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent aria-hidden="true" className="max-w-64">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
