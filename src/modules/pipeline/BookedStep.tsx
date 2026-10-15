import { useState } from "react";
import { CalendarClock, CalendarX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { bookingLabel, type BoardKind, type BookingView } from "@/data";
import { CancelStepDialog } from "./CancelStepDialog";
import { bookingText, bookingTone } from "./format";

/**
 * The booked next step at the top of a card sheet ("MG1 · today 7pm") with
 * Cancel (asks why); a step that is gone says so and asks to rebook.
 */
export function BookedStep({
  board,
  cardId,
  name,
  booking,
  onCancelled,
}: {
  board: BoardKind;
  cardId: string;
  name: string;
  booking: BookingView | null;
  onCancelled?: () => void;
}) {
  const [cancel, setCancel] = useState(false);
  if (!booking) return null;
  if (booking.removed || !booking.column)
    return (
      <div className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-[12.5px] text-warn-ink">
        <CalendarX className="mt-px size-4 shrink-0" aria-hidden="true" />
        <span>
          <b>Next step removed.</b> The step it was booked into isn&rsquo;t on the board any more.
          Pick another below.
        </span>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-[13px] font-semibold",
          bookingTone(booking),
        )}
      >
        <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{bookingText(booking)}</span>
        {booking.due === "overdue" && <span className="sr-only">(overdue)</span>}
      </span>
      <Button type="button" size="sm" variant="ghost" onClick={() => setCancel(true)}>
        Cancel step
      </Button>
      <CancelStepDialog
        open={cancel}
        onOpenChange={setCancel}
        board={board}
        cardId={cardId}
        name={name}
        stepLabel={bookingLabel(booking.column)}
        onDone={onCancelled}
      />
    </div>
  );
}
