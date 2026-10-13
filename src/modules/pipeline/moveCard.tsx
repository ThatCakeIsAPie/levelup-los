import type { ReactNode } from "react";
import { Check, MoveRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MILESTONES, MILESTONE_LABEL, type PipelineColumn } from "@/data";

/** "Move to…" menu: every column of the board, grouped by milestone band. */
export function MoveMenu({
  columns,
  current,
  onMove,
  children,
  align = "end",
}: {
  columns: PipelineColumn[];
  current: string;
  onMove: (to: string) => void;
  /** The trigger (rendered with asChild). */
  children: ReactNode;
  align?: "start" | "end";
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="max-h-[min(70dvh,var(--radix-dropdown-menu-content-available-height))] w-56 overflow-y-auto"
      >
        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
          <MoveRight className="size-3.5" aria-hidden="true" /> Move to…
        </DropdownMenuLabel>
        {MILESTONES.map((m) => (
          <DropdownMenuGroup key={m}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="pb-0.5 text-[10px] font-bold uppercase tracking-[.08em] text-faint">
              {MILESTONE_LABEL[m]}
            </DropdownMenuLabel>
            {columns
              .filter((c) => c.band === m)
              .map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  disabled={c.id === current}
                  onSelect={() => onMove(c.id)}
                  className="text-[13px]"
                >
                  <span className={c.kind === "milestone" ? "font-semibold" : "pl-2"}>
                    {c.label}
                  </span>
                  {c.id === current && <Check className="ml-auto size-3.5" aria-label="current" />}
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
