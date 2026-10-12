import { useMemo } from "react";
import { useAttendancesForEvent } from "@/data";
import { usePeopleStore } from "@/stores/peopleStore";
import { getUpcomingFollowUps, getRiskFlags } from "@/lib/selectors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { parseDate } from "@/lib/dates";

export function AttentionPanel({ eventId }: { eventId: string }) {
  const attendances = useAttendancesForEvent(eventId);
  const getPerson = usePeopleStore((s) => s.getById);

  const items = useMemo(() => {
    const followUps = getUpcomingFollowUps(attendances, 7);
    const risky = attendances.filter((a) => {
      const f = getRiskFlags(a);
      return f.red.length || f.yellow.length;
    });
    const ids = new Set<string>();
    const merged: { a: (typeof attendances)[number]; reason: string }[] = [];
    followUps.forEach((a) => {
      if (ids.has(a.id)) return;
      ids.add(a.id);
      const next = a.followUpDate ?? a.plannedPurchaseDate!;
      merged.push({ a, reason: `Due ${format(parseDate(next), "MMM d")}` });
    });
    risky.forEach((a) => {
      if (ids.has(a.id)) return;
      ids.add(a.id);
      const f = getRiskFlags(a);
      merged.push({ a, reason: [...f.red, ...f.yellow][0] });
    });
    return merged;
  }, [attendances]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
          Needs attention this week ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">All clear.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {items.slice(0, 8).map(({ a, reason }) => {
              const p = getPerson(a.personId);
              return (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  {p ? (
                    <Link
                      to="/people/$id"
                      params={{ id: p.id }}
                      className="font-medium hover:underline"
                    >
                      {p.name}
                    </Link>
                  ) : (
                    <span>—</span>
                  )}
                  <span className="text-xs text-muted-foreground">{reason}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
