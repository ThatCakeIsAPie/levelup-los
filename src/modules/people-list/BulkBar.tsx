import { useState } from "react";
import { CalendarClock, CalendarPlus, Check, Download, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  assignToEvent,
  bulkUpdateAttendances,
  localDate,
  logContact,
  useUpcomingEvents,
  useVisibleAttendances,
} from "@/data";
import { exportRowsCsv } from "./exportCsv";
import { plural, shortDate, type PersonRow, type Segment } from "./model";

/** Sticky bar shown while people are selected. */
export function BulkBar({
  rows,
  segment,
  onClear,
}: {
  rows: PersonRow[];
  segment: Segment;
  onClear: () => void;
}) {
  const [dialog, setDialog] = useState<"event" | "followup" | null>(null);
  const n = rows.length;
  const customers = segment === "customers";

  const checkInAll = () => {
    rows.forEach((r) => logContact({ personId: r.person.id }));
    toast.success(
      customers
        ? `Contact logged for ${plural(n, "customer")}`
        : `Check-in logged for ${plural(n, "person", "people")}`,
    );
    onClear();
  };

  const action = "h-9 px-2.5 text-[12.5px] sm:px-3 [&>span]:hidden sm:[&>span]:inline";

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky bottom-3 z-20 mt-3 flex items-center gap-1.5 rounded-card border border-line bg-surface px-2.5 py-2 shadow-[0_10px_30px_rgba(10,21,37,.18)] sm:gap-2 sm:px-3"
    >
      <span className="mr-auto whitespace-nowrap pl-1 text-[13px] font-bold tabular-nums">
        {n} selected
      </span>
      <Button
        size="sm"
        variant="soft"
        className={action}
        onClick={checkInAll}
        aria-label={customers ? "Log contact" : "Check in"}
      >
        <Check aria-hidden="true" />
        <span>{customers ? "Log contact" : "Check in"}</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={action}
        onClick={() => setDialog("event")}
        aria-label="Add to event"
      >
        <CalendarPlus aria-hidden="true" />
        <span>Add to event</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={action}
        onClick={() => setDialog("followup")}
        aria-label="Set follow-up date"
      >
        <CalendarClock aria-hidden="true" />
        <span>Set follow-up</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={action}
        onClick={() => exportRowsCsv(rows, customers ? "customers-selected" : "people-selected")}
        aria-label="Export selected as CSV"
      >
        <Download aria-hidden="true" />
        <span>Export</span>
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-9"
        onClick={onClear}
        aria-label="Clear selection"
      >
        <X />
      </Button>

      <AssignDialog
        open={dialog === "event"}
        onOpenChange={(o) => setDialog(o ? "event" : null)}
        rows={rows}
        onDone={onClear}
      />
      <FollowUpDialog
        open={dialog === "followup"}
        onOpenChange={(o) => setDialog(o ? "followup" : null)}
        rows={rows}
        onDone={onClear}
      />
    </div>
  );
}

function AssignDialog({
  open,
  onOpenChange,
  rows,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: PersonRow[];
  onDone: () => void;
}) {
  const events = useUpcomingEvents();
  const attendances = useVisibleAttendances();
  const [eventId, setEventId] = useState("");
  const event = events.find((e) => e.id === eventId);
  const already = event
    ? rows.filter((r) =>
        attendances.some((a) => a.eventId === eventId && a.personId === r.person.id),
      ).length
    : 0;

  const submit = () => {
    if (!event) return;
    rows.forEach((r) => assignToEvent(event.id, r.person.id));
    const added = rows.length - already;
    toast.success(
      added
        ? `Added ${plural(added, "person", "people")} to ${event.name}`
        : `Everyone was already on ${event.name}`,
      already && added
        ? { description: `${already} ${already === 1 ? "was" : "were"} already on the roster.` }
        : undefined,
    );
    setEventId("");
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {plural(rows.length, "person", "people")} to an event</DialogTitle>
          <DialogDescription>They join the event roster with no ticket yet.</DialogDescription>
        </DialogHeader>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">There are no upcoming events.</p>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="bulk-event">Event</Label>
            <Select value={eventId} onValueChange={setEventId}>
              <SelectTrigger id="bulk-event">
                <SelectValue placeholder="Choose an upcoming event" />
              </SelectTrigger>
              <SelectContent>
                {events.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name} · {shortDate(e.date)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {already > 0 && (
              <p className="text-xs text-muted-foreground">
                {already === rows.length
                  ? rows.length === 1
                    ? "They're already on this event."
                    : "Everyone selected is already on this event."
                  : `${already} of them ${already === 1 ? "is" : "are"} already on it and will be skipped.`}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!event || already === rows.length}>
            Add to event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FollowUpDialog({
  open,
  onOpenChange,
  rows,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: PersonRow[];
  onDone: () => void;
}) {
  const attendances = useVisibleAttendances();
  const upcoming = useUpcomingEvents();
  const [date, setDate] = useState("");
  const upcomingIds = new Set(upcoming.map((e) => e.id));
  const ids = new Set(rows.map((r) => r.person.id));
  const targets = attendances.filter((a) => ids.has(a.personId) && upcomingIds.has(a.eventId));
  const peopleWithRows = new Set(targets.map((a) => a.personId)).size;
  const without = rows.length - peopleWithRows;

  const submit = () => {
    if (!date || !targets.length) return;
    bulkUpdateAttendances(
      targets.map((a) => a.id),
      { followUpDate: date },
    );
    toast.success(
      `Follow-up set for ${plural(peopleWithRows, "person", "people")} on ${shortDate(date)}`,
      without
        ? { description: `${plural(without, "person is", "people are")} not on an upcoming event.` }
        : undefined,
    );
    setDate("");
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set a follow-up date</DialogTitle>
          <DialogDescription>
            Applies to each person's upcoming events.
            {without > 0 &&
              ` ${plural(without, "person isn't", "people aren't")} on an upcoming event, so they'll be skipped.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="bulk-followup">Follow up on</Label>
          <Input
            id="bulk-followup"
            type="date"
            min={localDate()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!date || targets.length === 0}>
            Set follow-up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
