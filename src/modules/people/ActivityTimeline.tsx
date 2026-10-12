import { useShallow } from "zustand/react/shallow";
import { useActivityStore } from "@/stores/activityStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEventsStore } from "@/stores/eventsStore";
import { format, formatDistanceToNow } from "date-fns";

const KIND_LABEL: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
  stage_changed: "Stage changed",
  assigned_event: "Assigned to event",
  ticket_purchased: "Ticket purchased",
  marked_attended: "Attended",
  marked_no_show: "No-show",
  note: "Note",
};

export function ActivityTimeline({ personId }: { personId: string }) {
  const events = useActivityStore(useShallow((s) => s.forPerson(personId)));
  const getEvent = useEventsStore((s) => s.getById);

  if (!events.length) {
    return <p className="text-xs text-muted-foreground">No activity yet.</p>;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
          Activity timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <ol className="relative space-y-3 border-l border-border pl-4">
          {events.slice(0, 30).map((e) => {
            const ev = e.relatedEventId ? getEvent(e.relatedEventId) : undefined;
            return (
              <li key={e.id} className="relative">
                <span className="absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-full bg-primary" />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-medium">{KIND_LABEL[e.kind] ?? e.kind}</span>
                  {ev && <span className="text-xs text-muted-foreground">on {ev.name}</span>}
                  <span
                    className="ml-auto text-[11px] text-muted-foreground"
                    title={format(new Date(e.timestamp), "PPpp")}
                  >
                    {formatDistanceToNow(new Date(e.timestamp), { addSuffix: true })}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {e.summary} · by {e.actorName}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
