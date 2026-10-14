import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useUpcomingEvents } from "@/data";
import { dateRange, relativeDay } from "@/modules/dashboard/format";

/** Pick an upcoming event to post as an event card (RSVP + Add to calendar). */
export function EventPostDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (eventId: string) => void;
}) {
  const events = useUpcomingEvents();
  const [id, setId] = useState<string>("");
  const chosen = id || events[0]?.id || "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-card">
        <DialogHeader>
          <DialogTitle>Event post</DialogTitle>
          <DialogDescription>
            People answer Going, Maybe or Bought ticket right in the chat, and it's saved to the
            event's attendance.
          </DialogDescription>
        </DialogHeader>
        {events.length === 0 ? (
          <EmptyState title="No upcoming events" body="Create an event first, then post it here." />
        ) : (
          <div
            className="grid max-h-[50dvh] gap-1.5 overflow-y-auto"
            role="radiogroup"
            aria-label="Event"
          >
            {events.map((e) => (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={chosen === e.id}
                onClick={() => setId(e.id)}
                className={cn(
                  "grid grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring",
                  chosen === e.id && "border-primary bg-primary-soft hover:bg-primary-soft",
                )}
              >
                <span className="grid size-8 place-items-center rounded-[9px] bg-event text-event-fg">
                  <CalendarDays className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-bold">{e.name}</span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    {dateRange(e)} · {relativeDay(e.date)}
                    {e.location ? ` · ${e.location}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!chosen}
            onClick={() => {
              onPick(chosen);
              onOpenChange(false);
            }}
          >
            Attach event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
