import { Flag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MAX_CARD_NOTE,
  NO_BOOKING,
  defaultBookingDate,
  type Booking,
  type PipelineColumn,
} from "@/data";

const NONE = "none";

/**
 * "Next step": the column the card moves into next (grouped by band,
 * milestones marked), the day (tomorrow by default) and an optional time.
 * The same on both boards and in "Add prospect".
 */
export function BookingFields({
  id,
  columns,
  bands,
  value,
  onChange,
}: {
  /** Prefix for the field ids. */
  id: string;
  /** The columns the card can book (after its current one on its owner's board). */
  columns: PipelineColumn<string>[];
  bands: readonly { id: string; label: string }[];
  value: Booking;
  onChange: (b: Booking) => void;
}) {
  // A booking whose column is gone (or no longer ahead) shows as "pick again".
  const known = !!value.nextColumn && columns.some((c) => c.id === value.nextColumn);
  const pick = (col: string) => {
    if (col === NONE) onChange(NO_BOOKING);
    else
      onChange({
        nextColumn: col,
        nextStepDate: value.nextStepDate || defaultBookingDate(),
        nextStepTime: value.nextStepTime,
      });
  };
  return (
    <div className="grid gap-2.5">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-column`} className="text-[12px] text-muted-foreground">
          Next step
        </Label>
        <Select value={known ? value.nextColumn! : NONE} onValueChange={pick}>
          <SelectTrigger id={`${id}-column`} className="w-full">
            <SelectValue placeholder="Not booked" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={NONE}>
              <span className="text-muted-foreground">Not booked</span>
            </SelectItem>
            {bands
              .filter((b) => columns.some((c) => c.band === b.id))
              .map((b) => (
                <SelectGroup key={b.id}>
                  <SelectLabel className="text-[10px] uppercase tracking-[.08em] text-faint">
                    {b.label}
                  </SelectLabel>
                  {columns
                    .filter((c) => c.band === b.id)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.kind === "milestone" ? (
                          <span className="flex items-center gap-1.5 font-semibold">
                            <Flag className="size-3.5 text-amber-strong" aria-hidden="true" />
                            {c.label}
                            <span className="sr-only"> (milestone)</span>
                          </span>
                        ) : (
                          <span>{c.label}</span>
                        )}
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
          </SelectContent>
        </Select>
      </div>
      {known && (
        <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2.5">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-date`} className="text-[12px] text-muted-foreground">
              Day
            </Label>
            <Input
              id={`${id}-date`}
              type="date"
              required
              className="min-w-0"
              value={value.nextStepDate ?? ""}
              onChange={(e) => onChange({ ...value, nextStepDate: e.target.value || null })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-time`} className="text-[12px] text-muted-foreground">
              Time (optional)
            </Label>
            <Input
              id={`${id}-time`}
              type="time"
              className="min-w-0"
              value={value.nextStepTime ?? ""}
              onChange={(e) => onChange({ ...value, nextStepTime: e.target.value || null })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** The card's free-text note. */
export function NoteField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-[12px] text-muted-foreground">
        Note
      </Label>
      <Textarea
        id={id}
        value={value}
        maxLength={MAX_CARD_NOTE}
        rows={2}
        placeholder="Anything to remember (only you and your upline see it)"
        onChange={(e) => onChange(e.target.value)}
      />
      {value.length > MAX_CARD_NOTE - 50 && (
        <span className="text-right text-[11px] text-muted-foreground">
          {value.length}/{MAX_CARD_NOTE}
        </span>
      )}
    </div>
  );
}
