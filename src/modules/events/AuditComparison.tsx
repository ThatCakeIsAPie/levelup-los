import { useShallow } from "zustand/react/shallow";
import { useMemo, useState } from "react";
import { useEventsStore, type CrmEvent } from "@/stores/eventsStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { useVisibleAttendances, useVisiblePeople } from "@/data";
import { getAuditDelta, attendanceStatusLabel } from "@/lib/selectors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

function statusBadge(label: string) {
  const map: Record<string, string> = {
    Attended: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    "No-Show": "bg-destructive/15 text-destructive",
    Ticket: "bg-primary/15 text-primary",
    Desire: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    Out: "bg-muted text-muted-foreground",
    Tracked: "bg-muted text-muted-foreground",
    "—": "text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${map[label] ?? "bg-muted"}`}
    >
      {label}
    </span>
  );
}

export function AuditComparison({ eventId }: { eventId: string }) {
  const current = useEventsStore((s) => s.getById(eventId));
  const allEvents = useEventsStore((s) => s.events);
  const auto = useEventsStore(useShallow((s) => s.getComparisonEvents(eventId)));
  const attendances = useVisibleAttendances();
  const addAttendance = useAttendanceStore((s) => s.add);
  const people = useVisiblePeople();

  const otherEvents = useMemo(
    () => allEvents.filter((e) => e.id !== eventId),
    [allEvents, eventId],
  );
  const [priorId, setPriorId] = useState<string | undefined>(auto.prior?.id);
  const [lastYearId, setLastYearId] = useState<string | undefined>(auto.lastYear?.id);

  const prior = otherEvents.find((e) => e.id === priorId);
  const lastYear = otherEvents.find((e) => e.id === lastYearId);
  const eventIds = [prior?.id, lastYear?.id, current?.id].filter(Boolean) as string[];
  // Hooks must run before the early return below.
  const rows = useMemoDelta(eventIds, attendances, people);

  if (!current) return null;

  const count = (e?: CrmEvent) => (e ? attendances.filter((a) => a.eventId === e.id).length : 0);
  const currentCount = count(current);
  const priorCount = count(prior);
  const lastYearCount = count(lastYear);

  const returningFromLast = lastYear
    ? rows.filter((r) => r.byEvent[lastYear.id] && r.byEvent[current.id]).length
    : 0;
  const retention = lastYearCount ? Math.round((returningFromLast / lastYearCount) * 100) : 0;
  const yoy = lastYearCount
    ? Math.round(((currentCount - lastYearCount) / lastYearCount) * 100)
    : 0;

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Picker label="Prior event" value={priorId} onChange={setPriorId} events={otherEvents} />
        <Picker
          label="Same event last year"
          value={lastYearId}
          onChange={setLastYearId}
          events={otherEvents}
        />
        <div />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryStat label="Current" value={currentCount} sub={current.name} />
        <SummaryStat label="Prior" value={priorCount} sub={prior?.name ?? "—"} />
        <SummaryStat label="Last year" value={lastYearCount} sub={lastYear?.name ?? "—"} />
        <SummaryStat
          label="Retention / YoY"
          value={`${retention}% · ${yoy >= 0 ? "+" : ""}${yoy}%`}
          sub="vs. last year"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
            Per-person comparison
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                {lastYear && <TableHead>{lastYear.name}</TableHead>}
                {prior && <TableHead>{prior.name}</TableHead>}
                <TableHead>{current.name}</TableHead>
                <TableHead className="w-32 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const inCurrent = !!r.byEvent[current.id];
                return (
                  <TableRow key={r.personId}>
                    <TableCell>
                      <Link
                        to="/people/$id"
                        params={{ id: r.personId }}
                        className="font-medium hover:underline"
                      >
                        {r.personName}
                      </Link>
                    </TableCell>
                    {lastYear && (
                      <TableCell>
                        {statusBadge(attendanceStatusLabel(r.byEvent[lastYear.id]))}
                      </TableCell>
                    )}
                    {prior && (
                      <TableCell>
                        {statusBadge(attendanceStatusLabel(r.byEvent[prior.id]))}
                      </TableCell>
                    )}
                    <TableCell>
                      {statusBadge(attendanceStatusLabel(r.byEvent[current.id]))}
                    </TableCell>
                    <TableCell className="text-right">
                      {!inCurrent && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const a = addAttendance(current.id, r.personId);
                            useAttendanceStore.getState().update(a.id, { desireToAttend: "maybe" });
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" /> Add
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No comparable attendees yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Picker({
  label,
  value,
  onChange,
  events,
}: {
  label: string;
  value?: string;
  onChange: (v?: string) => void;
  events: CrmEvent[];
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value ?? "none"} onValueChange={(v) => onChange(v === "none" ? undefined : v)}>
        <SelectTrigger className="h-8">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">— None —</SelectItem>
          {events.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name} ({e.date})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// Memoize delta computation locally
function useMemoDelta(
  eventIds: string[],
  attendances: ReturnType<typeof useAttendanceStore.getState>["attendances"],
  people: ReturnType<typeof usePeopleStore.getState>["people"],
) {
  return useMemo(
    () => getAuditDelta(eventIds, attendances, people),
    [eventIds.join(","), attendances, people],
  );
}
