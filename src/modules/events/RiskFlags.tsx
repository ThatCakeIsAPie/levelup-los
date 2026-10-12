import { getRiskFlags } from "@/lib/selectors";
import type { Attendance } from "@/stores/attendanceStore";
import { AlertTriangle, AlertCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function RiskBadge({ attendance }: { attendance: Attendance }) {
  const { red, yellow } = getRiskFlags(attendance);
  if (!red.length && !yellow.length) return null;
  const reasons = [...red, ...yellow];
  const Icon = red.length ? AlertCircle : AlertTriangle;
  const color = red.length ? "text-destructive" : "text-amber-600 dark:text-amber-400";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex ${color}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="text-xs">
          {reasons.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
