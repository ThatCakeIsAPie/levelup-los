/**
 * Log sheet ↔ pipeline board. "Booked a meeting" moves the prospect's card to
 * the column picked here (the next one by default); "Showed the plan" moves it
 * to First plan. Both write the same moves as the board, so nothing is
 * counted twice.
 */
import { Kanban } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MILESTONES, MILESTONE_LABEL, type ProspectPipeline } from "@/data";
import { Field } from "./parts";
import { boardOptions, boardTarget } from "./pipelineMove";

export function BoardMoveField({
  pipeline,
  pick,
  onPick,
}: {
  pipeline: ProspectPipeline | null;
  pick: string;
  onPick: (v: string) => void;
}) {
  const options = boardOptions(pipeline);
  if (!pipeline?.onBoard || options.length === 0) return null;
  const value = boardTarget(pipeline, pick) ?? "none";
  return (
    <Field label="On the board" htmlFor="log-board-move">
      <Select value={value} onValueChange={onPick}>
        <SelectTrigger id="log-board-move">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Don&rsquo;t move (stays at {pipeline.column?.label})</SelectItem>
          {MILESTONES.map((m) => {
            const cols = options.filter((c) => c.band === m);
            if (!cols.length) return null;
            return (
              <SelectGroup key={m}>
                <SelectLabel className="text-[10px] uppercase tracking-[.08em] text-faint">
                  {MILESTONE_LABEL[m]}
                </SelectLabel>
                {cols.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    Move to {c.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** One-line note: what logging this does on the board. */
export function BoardNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
      <Kanban className="size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}
