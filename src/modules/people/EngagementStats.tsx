import { useAttendanceStore } from "@/stores/attendanceStore";
import { useEventsStore } from "@/stores/eventsStore";
import { getPersonShowRate } from "@/lib/selectors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function EngagementStats({ personId }: { personId: string }) {
  const attendances = useAttendanceStore((s) => s.attendances);
  const events = useEventsStore((s) => s.events);
  const rate = getPersonShowRate(personId, attendances, events);
  const personRows = attendances.filter((a) => a.personId === personId);
  const noShows = personRows.filter((a) => a.hasTicket && a.attended === false).length;
  const assigned = personRows.length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
          Engagement
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-4 gap-3 text-center">
        <Stat label="Show rate" value={`${rate.pct}%`} sub={`${rate.attended}/${rate.eligible}`} />
        <Stat label="Attended" value={rate.attended} />
        <Stat label="No-shows" value={noShows} />
        <Stat label="Tracked" value={assigned} />
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
