import { Link } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import {
  DateBadge,
  EmptyState,
  SectionCard,
  SegmentedBar,
  ToneChip,
  type Tone,
} from "@/components/brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useAttendancesForEvent,
  useAttendancesForPerson,
  useUpcomingEvents,
  type Attendance,
  type CrmEvent,
} from "@/data";
import { attendanceStatus, dateRange, daysUntil, plural, ticketStats } from "./format";

function Countdown({ event, compact }: { event: CrmEvent; compact?: boolean }) {
  const n = daysUntil(event.date);
  const label = n <= 0 ? "NOW" : n === 1 ? "DAY" : "DAYS";
  return (
    <span
      className={cn(
        "inline-grid place-items-center rounded-[10px] bg-white/10 text-center",
        compact ? "min-w-11 px-1.5 py-1" : "min-w-[52px] px-2 py-1.5",
      )}
      aria-label={n <= 0 ? "Happening now" : `In ${plural(n, "day")}`}
    >
      {n > 0 && (
        <b
          className={cn(
            "block font-extrabold leading-tight tabular-nums",
            compact ? "text-base" : "text-xl",
          )}
        >
          {n}
        </b>
      )}
      <small className="text-[10px] font-semibold tracking-wide text-event-muted">{label}</small>
    </span>
  );
}

const SKY_BTN = "bg-sky text-navy hover:bg-sky/90";
const GHOST_BTN = "border border-white/25 bg-transparent text-event-fg hover:bg-white/10";

/** Navy "next event" card. Leaders see team ticket progress; candidates see their own status. */
export function NextEventCard({
  event,
  candidate,
  viewerId,
  compact,
}: {
  event: CrmEvent | undefined;
  candidate: boolean;
  viewerId: string;
  compact?: boolean;
}) {
  if (!event) {
    return (
      <SectionCard title="Next event">
        <EmptyState
          className="py-6"
          icon={<CalendarDays />}
          title="No upcoming events"
          body="Add your next meeting or conference to see a countdown and ticket progress here."
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/events">Go to events</Link>
            </Button>
          }
        />
      </SectionCard>
    );
  }
  return candidate ? (
    <CandidateEvent event={event} viewerId={viewerId} compact={compact} />
  ) : (
    <TeamEvent event={event} compact={compact} />
  );
}

function TeamEvent({ event, compact }: { event: CrmEvent; compact?: boolean }) {
  const rows = useAttendancesForEvent(event.id);
  const s = ticketStats(rows);
  const bar = (
    <SegmentedBar
      total={Math.max(1, s.invited)}
      className="bg-white/15"
      segments={[
        { value: s.bought, className: "bg-sky", label: "Tickets bought" },
        { value: s.plannedThisWeek, className: "bg-amber", label: "Plan to buy this week" },
      ]}
    />
  );
  const meta = [dateRange(event), event.location, `${s.invited} invited`]
    .filter(Boolean)
    .join(" · ");

  if (compact) {
    return (
      <Link
        to="/events/$id"
        params={{ id: event.id }}
        className="grid gap-2 rounded-xl bg-event p-3 text-event-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold">{event.name}</span>
            <span className="block truncate text-[11.5px] text-event-muted">{meta}</span>
          </span>
          <Countdown event={event} compact />
        </span>
        {s.invited > 0 && bar}
        <span className="text-[11.5px] text-event-muted">
          {s.invited === 0
            ? "No one from your team is on the list yet"
            : `${s.bought} of ${s.invited} have tickets · ${s.needTicket} to go`}
        </span>
      </Link>
    );
  }

  return (
    <SectionCard variant="event" title={event.name} action={<Countdown event={event} />}>
      <p className="-mt-1.5 text-[12.5px] text-muted-foreground">{meta}</p>
      {s.invited === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          No one from your team is on the list yet.
        </p>
      ) : (
        <div className="grid gap-1.5">
          <div className="flex justify-between text-[12.5px]">
            <span>Tickets bought</span>
            <b className="tabular-nums">
              {s.bought} of {s.invited}
            </b>
          </div>
          {bar}
          <div className="text-[11.5px] text-muted-foreground">
            {s.plannedThisWeek > 0
              ? `${s.plannedThisWeek} plan to buy this week`
              : "No one plans to buy this week"}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {s.needTicket > 0 && (
          <Button asChild size="sm" className={SKY_BTN}>
            <Link to="/events/$id" params={{ id: event.id }}>
              {s.needTicket} need a ticket
            </Link>
          </Button>
        )}
        <Button asChild size="sm" className={GHOST_BTN}>
          <Link to="/events/$id" params={{ id: event.id }}>
            Open event
          </Link>
        </Button>
      </div>
    </SectionCard>
  );
}

function CandidateEvent({
  event,
  viewerId,
  compact,
}: {
  event: CrmEvent;
  viewerId: string;
  compact?: boolean;
}) {
  const mine = useAttendancesForPerson(viewerId);
  const status = attendanceStatus(mine.find((a) => a.eventId === event.id));
  const meta = [dateRange(event), event.location].filter(Boolean).join(" · ");
  return (
    <SectionCard
      variant="event"
      title={event.name}
      action={<Countdown event={event} compact={compact} />}
      className={cn(compact && "rounded-xl p-3 sm:px-3")}
    >
      <p className="-mt-1.5 text-[12.5px] text-muted-foreground">{meta}</p>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <ToneChip tone={status.tone}>{status.label}</ToneChip>
        {status.detail && <span className="text-muted-foreground">{status.detail}</span>}
      </div>
      <div>
        <Button asChild size="sm" className={SKY_BTN}>
          <Link to="/events/$id" params={{ id: event.id }}>
            Open event
          </Link>
        </Button>
      </div>
    </SectionCard>
  );
}

/** Candidate: upcoming events with their own ticket status. */
export function MyEventsCard({ viewerId }: { viewerId: string }) {
  const upcoming = useUpcomingEvents();
  const mine = useAttendancesForPerson(viewerId);
  const byEvent = new Map(mine.map((a) => [a.eventId, a]));
  // Events they're on first, then the rest, soonest first within each group.
  const list = [...upcoming]
    .sort((a, b) => Number(byEvent.has(b.id)) - Number(byEvent.has(a.id)))
    .slice(0, 4);
  return (
    <SectionCard
      title="Your events"
      action={
        <Link to="/events" className="text-primary hover:underline">
          All events
        </Link>
      }
    >
      {list.length === 0 ? (
        <EmptyState
          className="py-6"
          icon={<CalendarDays />}
          title="No upcoming events"
          body="When your team plans a meeting or conference, it shows up here."
        />
      ) : (
        <div>
          {list.map((e) => {
            const st = attendanceStatus(byEvent.get(e.id));
            return (
              <div
                key={e.id}
                className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3.5 border-t border-line py-3 first:border-t-0 first:pt-0.5"
              >
                <DateBadge date={e.date} />
                <div className="min-w-0">
                  <Link
                    to="/events/$id"
                    params={{ id: e.id }}
                    className="block truncate rounded-sm text-[13.5px] font-bold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {e.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <ToneChip tone={st.tone}>{st.label}</ToneChip>
                    <span>
                      {st.detail ?? [dateRange(e), e.location].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
