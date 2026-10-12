import { useMemo } from "react";
import { useVisibleAttendances, useVisibleTeam } from "@/data";
import { getEventFunnel } from "@/lib/selectors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function EventFunnel({ eventId }: { eventId: string }) {
  const attendances = useVisibleAttendances();
  const peopleCount = useVisibleTeam().length;
  const f = useMemo(
    () => getEventFunnel(eventId, attendances, peopleCount),
    [eventId, attendances, peopleCount],
  );

  const stages: { key: keyof typeof f; label: string }[] = [
    { key: "potential", label: "Potential" },
    { key: "desire", label: "Desire" },
    { key: "dateCommitted", label: "Date" },
    { key: "ticket", label: "Ticket" },
    { key: "attended", label: "Attended" },
  ];

  const max = f.potential || 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
          Conversion funnel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {stages.map((s, i) => {
          const v = f[s.key];
          const pct = Math.round((v / max) * 100);
          const prev = i === 0 ? null : f[stages[i - 1].key];
          const stepPct = prev && prev > 0 ? Math.round((v / prev) * 100) : null;
          return (
            <div key={s.key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium">{s.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {v}
                  {stepPct !== null && (
                    <span className="ml-2 text-[10px]">({stepPct}% of prior)</span>
                  )}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-muted">
                <div
                  className="h-full rounded bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
