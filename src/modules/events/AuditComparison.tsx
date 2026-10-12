import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { GitCompareArrows, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  EmptyState,
  PersonAvatar,
  SectionCard,
  StatStrip,
  ToneChip,
  useIsDesktop,
} from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  assignToEvent,
  effectiveBizClass,
  parseDate,
  updateAttendance,
  useEvents,
  useVisibleAttendances,
  type Attendance,
  type CrmEvent,
} from "@/data";
import { usePeopleMap } from "./hooks";
import { attendanceStatus, comparisonEvents } from "./lib";

interface DeltaRow {
  personId: string;
  name: string;
  byEvent: Record<string, Attendance | undefined>;
}

/**
 * Compare this event's roster with the previous event of the same type and
 * the same event about a year ago: totals, retention, and a per-person grid
 * with a one-tap "Invite" for people missing from this event.
 */
export function AuditComparison({ event }: { event: CrmEvent }) {
  const events = useEvents();
  const attendances = useVisibleAttendances();
  const people = usePeopleMap();
  const desktop = useIsDesktop();
  const auto = useMemo(() => comparisonEvents(event, events), [event, events]);
  const others = useMemo(
    () => [...events].filter((e) => e.id !== event.id).reverse(),
    [events, event.id],
  );
  const [priorId, setPriorId] = useState<string | undefined>(auto.prior?.id);
  const [lastYearId, setLastYearId] = useState<string | undefined>(auto.lastYear?.id);
  const prior = others.find((e) => e.id === priorId);
  const lastYear = others.find((e) => e.id === lastYearId);
  const uniqueCols = useMemo(() => {
    const cols = [lastYear, prior, event].filter((e): e is CrmEvent => !!e);
    // Same event picked twice: show it once.
    return cols.filter((e, i) => cols.findIndex((x) => x.id === e.id) === i);
  }, [lastYear, prior, event]);

  const rows = useMemo<DeltaRow[]>(() => {
    const ids = new Set(uniqueCols.map((e) => e.id));
    const personIds = new Set(attendances.filter((a) => ids.has(a.eventId)).map((a) => a.personId));
    return [...personIds]
      .map((pid) => ({
        personId: pid,
        name: people.get(pid)?.name ?? "Unknown person",
        byEvent: Object.fromEntries(
          uniqueCols.map((e) => [
            e.id,
            attendances.find((a) => a.eventId === e.id && a.personId === pid),
          ]),
        ),
      }))
      .sort((a, b) => {
        // People missing from this event first: they're the ones to invite.
        const am = a.byEvent[event.id] ? 1 : 0;
        const bm = b.byEvent[event.id] ? 1 : 0;
        return am - bm || a.name.localeCompare(b.name);
      });
  }, [attendances, people, event.id, uniqueCols]);

  const count = (e?: CrmEvent) => (e ? attendances.filter((a) => a.eventId === e.id).length : 0);
  const currentCount = count(event);
  const lastYearCount = count(lastYear);
  const priorCount = count(prior);
  const returning = lastYear
    ? rows.filter((r) => r.byEvent[lastYear.id] && r.byEvent[event.id]).length
    : 0;
  const retention = lastYearCount ? Math.round((returning / lastYearCount) * 100) : null;
  const change = lastYearCount
    ? Math.round(((currentCount - lastYearCount) / lastYearCount) * 100)
    : null;
  const missing = rows.filter((r) => !r.byEvent[event.id]).length;

  const invite = (r: DeltaRow) => {
    const a = assignToEvent(event.id, r.personId);
    updateAttendance(a.id, { desireToAttend: "maybe" });
    toast.success(`${r.name} added as a maybe`);
  };

  return (
    <div className="grid gap-4">
      <SectionCard title="Compare with">
        <div className="grid gap-3 sm:grid-cols-2">
          <EventPicker
            id="cmp-prior"
            label="Previous event"
            value={priorId}
            onChange={setPriorId}
            events={others}
          />
          <EventPicker
            id="cmp-ly"
            label="Same event last year"
            value={lastYearId}
            onChange={setLastYearId}
            events={others}
          />
        </div>
      </SectionCard>

      <StatStrip
        items={[
          { value: currentCount, label: "On this event" },
          {
            value: prior ? priorCount : "–",
            label: prior ? `Previous: ${prior.name}` : "No previous event",
          },
          {
            value: lastYear ? lastYearCount : "–",
            label: lastYear ? `Last year: ${lastYear.name}` : "No event last year",
          },
          {
            value: retention === null ? "–" : `${retention}%`,
            label: "Back from last year",
          },
          {
            value: change === null ? "–" : `${change > 0 ? "+" : ""}${change}%`,
            label: "Roster vs last year",
          },
        ]}
      />

      <SectionCard
        title="Person by person"
        action={
          missing > 0 ? (
            <span className="font-normal text-muted-foreground">
              {missing} not on this event yet
            </span>
          ) : undefined
        }
      >
        {uniqueCols.length < 2 ? (
          <EmptyState
            icon={<GitCompareArrows />}
            title="Pick an event to compare with"
            body="Choose a previous event or last year's event above to see who came back."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<GitCompareArrows />}
            title="Nobody to compare yet"
            body="None of the people you can see were on these events."
          />
        ) : desktop ? (
          <div className="-mx-4 overflow-x-auto sm:-mx-[18px]">
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow className="border-line hover:bg-transparent">
                  <TableHead className="pl-4 sm:pl-[18px]">Person</TableHead>
                  {uniqueCols.map((e) => (
                    <TableHead key={e.id} className="min-w-[140px]">
                      <span className="block truncate">
                        {e.id === event.id ? "This event" : e.name}
                      </span>
                      <span className="block text-[11px] font-normal text-faint">
                        {format(parseDate(e.date), "MMM d, yyyy")}
                      </span>
                    </TableHead>
                  ))}
                  <TableHead className="w-28 pr-4 text-right sm:pr-[18px]">
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const p = people.get(r.personId);
                  return (
                    <TableRow key={r.personId} className="border-line">
                      <TableCell className="pl-4 sm:pl-[18px]">
                        <div className="flex items-center gap-2.5">
                          <PersonAvatar
                            name={r.name}
                            stage={p ? effectiveBizClass(p) : undefined}
                            size="sm"
                          />
                          <Link
                            to="/people/$id"
                            params={{ id: r.personId }}
                            className="truncate rounded-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            {r.name}
                          </Link>
                        </div>
                      </TableCell>
                      {uniqueCols.map((e) => {
                        const st = attendanceStatus(r.byEvent[e.id]);
                        return (
                          <TableCell key={e.id}>
                            {r.byEvent[e.id] ? (
                              <ToneChip tone={st.tone}>{st.label}</ToneChip>
                            ) : (
                              <span className="text-xs text-faint">Not on it</span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="pr-4 text-right sm:pr-[18px]">
                        {!r.byEvent[event.id] && (
                          <Button size="sm" variant="soft" onClick={() => invite(r)}>
                            <Plus /> Invite
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <ul>
            {rows.map((r) => {
              const p = people.get(r.personId);
              return (
                <li
                  key={r.personId}
                  className="grid gap-2 border-t border-line py-3 first:border-t-0 first:pt-0"
                >
                  <div className="flex items-center gap-2.5">
                    <PersonAvatar
                      name={r.name}
                      stage={p ? effectiveBizClass(p) : undefined}
                      size="sm"
                    />
                    <Link
                      to="/people/$id"
                      params={{ id: r.personId }}
                      className="min-w-0 flex-1 truncate rounded-sm text-[13px] font-semibold hover:underline"
                    >
                      {r.name}
                    </Link>
                    {!r.byEvent[event.id] && (
                      <Button size="sm" variant="soft" onClick={() => invite(r)}>
                        <Plus /> Invite
                      </Button>
                    )}
                  </div>
                  <dl className="grid gap-1 pl-[34px] text-xs">
                    {uniqueCols.map((e) => {
                      const st = attendanceStatus(r.byEvent[e.id]);
                      return (
                        <div key={e.id} className="flex items-center justify-between gap-2">
                          <dt className="min-w-0 truncate text-muted-foreground">
                            {e.id === event.id ? "This event" : e.name}
                          </dt>
                          <dd>
                            {r.byEvent[e.id] ? (
                              <ToneChip tone={st.tone}>{st.label}</ToneChip>
                            ) : (
                              <span className="text-faint">Not on it</span>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function EventPicker({
  id,
  label,
  value,
  onChange,
  events,
}: {
  id: string;
  label: string;
  value?: string;
  onChange: (v?: string) => void;
  events: CrmEvent[];
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value ?? "none"} onValueChange={(v) => onChange(v === "none" ? undefined : v)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          {events.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name} · {format(parseDate(e.date), "MMM d, yyyy")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
