import { Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PipelineScope, ScopeOption } from "@/data";

const SEGMENTS: { value: "mine" | "team"; label: string }[] = [
  { value: "mine", label: "Just mine" },
  { value: "team", label: "Whole business" },
];

/**
 * Whose pipeline: a two-way toggle between your own prospects and your whole
 * business, plus a picker for a downline leader's team when there are any.
 * Hidden when the viewer has nobody under them (both views would be the same).
 */
export function ScopeToggle({
  scopes,
  scope,
  onScope,
  label = "Whose pipeline",
}: {
  scopes: ScopeOption[];
  scope: PipelineScope;
  onScope: (scope: PipelineScope) => void;
  label?: string;
}) {
  const team = scopes.find((s) => s.value === "team");
  const leaders = scopes.filter((s) => s.value.startsWith("leader:"));
  if (!team || (team.owners.size <= 1 && leaders.length === 0)) return null;
  const leader = scope.startsWith("leader:") ? scope : undefined;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div
        role="radiogroup"
        aria-label={label}
        className="flex h-9 shrink-0 items-center gap-0.5 rounded-lg border border-input bg-surface p-0.5"
      >
        {SEGMENTS.map((s) => {
          const on = scope === s.value;
          return (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onScope(s.value)}
              className={cn(
                "h-full rounded-md px-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                on
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {leaders.length > 0 && (
        <Select value={leader ?? ""} onValueChange={(v) => onScope(v as PipelineScope)}>
          <SelectTrigger
            className={cn(
              "h-9 w-auto min-w-0 max-w-[11rem] gap-1.5 text-[13px] font-semibold",
              leader && "border-primary",
            )}
            aria-label="A leader's team"
          >
            <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <SelectValue placeholder="Teams" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {leaders.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
