import { useVisibleAttendances } from "@/data";
import { useEventsStore } from "@/stores/eventsStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@tanstack/react-router";

export function HelpingFor({ personId }: { personId: string }) {
  const all = useVisibleAttendances();
  const attendances = all.filter((a) => a.helperId === personId);
  const getEvent = useEventsStore((s) => s.getById);
  const getPerson = usePeopleStore((s) => s.getById);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
          Helping for ({attendances.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {attendances.length === 0 ? (
          <p className="text-xs text-muted-foreground">Not currently helping anyone.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {attendances.map((a) => {
              const ev = getEvent(a.eventId);
              const p = getPerson(a.personId);
              return (
                <li key={a.id} className="flex items-center justify-between">
                  <span>
                    {p && (
                      <Link
                        to="/people/$id"
                        params={{ id: p.id }}
                        className="font-medium hover:underline"
                      >
                        {p.name}
                      </Link>
                    )}
                    {ev && <span className="text-xs text-muted-foreground"> · {ev.name}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a.hasTicket ? "Ticket ✓" : a.desireToAttend === "yes" ? "Desire" : "Tracking"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
