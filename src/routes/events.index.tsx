import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { AlertTriangle, CalendarDays, CalendarPlus, MapPin, Plus, Ticket } from "lucide-react";
import {
  DateBadge,
  EmptyState,
  PageHeader,
  SectionCard,
  SegmentedBar,
  ToneChip,
} from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  EVENT_TYPE_INFO,
  EVENT_TYPES,
  daysFromToday,
  isEventType,
  localDate,
  needsTicket,
  useCanManageEvents,
  useCurrentUser,
  useDoNotContactIds,
  usePastEvents,
  useUpcomingEvents,
  useVisibleAttendances,
  useVisiblePeople,
  type Attendance,
  type CrmEvent,
  type CrmPerson,
  type EventType,
  usesTickets,
} from "@/data";
import { cn } from "@/lib/utils";
import { AvatarStack } from "@/modules/events/AvatarStack";
import { EventFormTrigger } from "@/modules/events/EventFormDialog";
import {
  EVENT_TYPE_LABEL,
  attendanceStatus,
  attentionItems,
  eventTiming,
  formatEventRange,
  timingLabel,
} from "@/modules/events/lib";
import { EventFormatChip, EventTypeChip } from "@/modules/events/typeMeta";
import { EVENT_TYPE_ICON } from "@/modules/events/typeIcons";

/** `?type=night_owls` shows one type of event. */
interface EventsSearch {
  type?: EventType;
}

export const Route = createFileRoute("/events/")({
  validateSearch: (search: Record<string, unknown>): EventsSearch => ({
    type: isEventType(search.type) ? search.type : undefined,
  }),
  head: () => ({ meta: [{ title: "Events — LevelUp LOS" }] }),
  component: EventsPage,
});

interface EventSummary {
  event: CrmEvent;
  rows: Attendance[];
  people: CrmPerson[];
  invited: number;
  bought: number;
  planned: number;
  plannedThisWeek: number;
  /** Still need a ticket (no ticket, haven't said no): same rule as the Dashboard. */
  needTicket: number;
  attention: number;
  attended: number;
  /** Came virtually (of `attended`). */
  attendedVirtual: number;
  /** Said they're coming (events without tickets). */
  going: number;
  showRate: number | null;
  mine?: Attendance;
}

function useEventSummaries(events: CrmEvent[]): EventSummary[] {
  const all = useVisibleAttendances();
  const people = useVisiblePeople();
  const user = useCurrentUser();
  const skip = useDoNotContactIds();
  return useMemo(() => {
    const byId = new Map(people.map((p) => [p.id, p]));
    const today = localDate();
    const weekOut = daysFromToday(7);
    return events.map((event) => {
      const rows = all.filter((a) => a.eventId === event.id);
      const bought = rows.filter((a) => a.hasTicket).length;
      const plannedRows = rows.filter((a) => !a.hasTicket && a.plannedPurchaseDate);
      const eligible = rows.filter((a) => a.hasTicket || a.desireToAttend === "yes").length;
      const attended = rows.filter((a) => a.attended === true).length;
      // Avatars: ticket holders first, then everyone else on the roster.
      const ordered = [...rows].sort((a, b) => Number(b.hasTicket) - Number(a.hasTicket));
      return {
        event,
        rows,
        people: ordered.map((a) => byId.get(a.personId)).filter((p): p is CrmPerson => !!p),
        invited: rows.length,
        bought,
        planned: plannedRows.length,
        plannedThisWeek: plannedRows.filter(
          (a) => a.plannedPurchaseDate! >= today && a.plannedPurchaseDate! <= weekOut,
        ).length,
        needTicket: rows.filter(needsTicket).length,
        attention: attentionItems(event, rows, undefined, skip).length,
        attended,
        attendedVirtual: rows.filter((a) => a.attended === true && a.mode === "virtual").length,
        going: rows.filter((a) => a.desireToAttend === "yes").length,
        showRate: eligible ? Math.round((attended / eligible) * 100) : null,
        mine: rows.find((a) => a.personId === user.personId),
      };
    });
  }, [events, all, people, user.personId, skip]);
}

function EventsPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const { type } = Route.useSearch();
  const allUpcoming = useUpcomingEvents();
  const allPast = usePastEvents();
  const upcoming = useEventSummaries(
    useMemo(() => allUpcoming.filter((e) => !type || e.type === type), [allUpcoming, type]),
  );
  const past = useEventSummaries(
    useMemo(() => allPast.filter((e) => !type || e.type === type), [allPast, type]),
  );
  // Filter chips for the types that have events.
  const types = useMemo(() => {
    const have = new Set([...allUpcoming, ...allPast].map((e) => e.type));
    return EVENT_TYPES.filter((t) => have.has(t));
  }, [allUpcoming, allPast]);
  const manage = useCanManageEvents();
  const candidate = user.role === "candidate";

  // The next conference gets the navy feature card; the rest are regular cards.
  const featured = upcoming.find((s) => s.event.type === "conference");
  const others = upcoming.filter((s) => s !== featured);
  const kind = type ? EVENT_TYPE_INFO[type].plural.toLowerCase() : "events";

  const newEvent = (label = "New event") =>
    manage ? (
      <EventFormTrigger onCreated={(e) => navigate({ to: "/events/$id", params: { id: e.id } })}>
        {(open) => (
          <Button onClick={open}>
            <Plus /> {label}
          </Button>
        )}
      </EventFormTrigger>
    ) : null;

  return (
    <div className="grid gap-5 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <PageHeader
        title="Events"
        subtitle={`${upcoming.length} upcoming · ${past.length} past`}
        actions={newEvent()}
      />

      {types.length > 1 && <TypeFilter types={types} value={type} />}

      <section aria-labelledby="upcoming-h" className="grid gap-3">
        <h2 id="upcoming-h" className="text-sm font-bold">
          Upcoming
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={<CalendarPlus />}
            title={`No upcoming ${kind}`}
            body={
              manage
                ? "Add the next one so your team can see it and say they're coming."
                : "When your team adds the next one, it shows up here."
            }
            action={newEvent("Add an event")}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {featured && (
              <FeaturedCard s={featured} candidate={candidate} className="lg:col-span-2" />
            )}
            {others.map((s, i) => (
              // A lone card in the last row spans both columns instead of leaving a gap.
              <div
                key={s.event.id}
                className={
                  others.length % 2 === 1 && i === others.length - 1 ? "grid lg:col-span-2" : "grid"
                }
              >
                <UpcomingCard s={s} candidate={candidate} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="past-h" className="grid gap-3">
        <h2 id="past-h" className="text-sm font-bold">
          Past
        </h2>
        {past.length === 0 ? (
          <EmptyState
            icon={<CalendarDays />}
            title={`No past ${kind} yet`}
            body="Finished events move here with who came."
          />
        ) : (
          <SectionCard className="py-2 sm:py-2">
            <ul>
              {past.map((s) => (
                <PastRow key={s.event.id} s={s} candidate={candidate} />
              ))}
            </ul>
          </SectionCard>
        )}
      </section>
    </div>
  );
}

/** One chip per event type that has events, plus "All". Lives in the URL (`?type=`). */
function TypeFilter({ types, value }: { types: EventType[]; value?: EventType }) {
  const chip = (t: EventType | undefined, label: string) => {
    const Icon = t ? EVENT_TYPE_ICON[t] : null;
    const on = value === t;
    return (
      <Link
        key={t ?? "all"}
        to="/events"
        search={t ? { type: t } : {}}
        replace
        aria-current={on ? "page" : undefined}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          on
            ? "border-foreground bg-foreground text-background"
            : "border-line text-muted-foreground hover:text-foreground",
        )}
      >
        {Icon && <Icon className="size-3.5" aria-hidden="true" />}
        {label}
      </Link>
    );
  };
  return (
    <nav aria-label="Show one type of event" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <div className="flex w-max gap-1.5 lg:w-auto lg:flex-wrap">
        {chip(undefined, "All")}
        {types.map((t) => chip(t, EVENT_TYPE_INFO[t].plural))}
      </div>
    </nav>
  );
}

function MetaLine({ event, className }: { event: CrmEvent; className?: string }) {
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-muted-foreground",
        className,
      )}
    >
      <span>{formatEventRange(event)}</span>
      {event.location && (
        <>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" aria-hidden="true" />
            {event.location}
          </span>
        </>
      )}
    </p>
  );
}

/** Navy card for the next conference: countdown, ticket progress, who's going. */
function FeaturedCard({
  s,
  candidate,
  className,
}: {
  s: EventSummary;
  candidate: boolean;
  className?: string;
}) {
  const { event } = s;
  const t = eventTiming(event);
  return (
    <SectionCard variant="event" className={cn("relative gap-4", className)}>
      <div className="flex items-start gap-3">
        <DateBadge date={event.date} className="bg-white/10" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Next {EVENT_TYPE_LABEL[event.type].toLowerCase()}
          </p>
          <h3 className="text-[17px] font-extrabold leading-snug lg:text-lg">
            <Link
              to="/events/$id"
              params={{ id: event.id }}
              className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky"
            >
              {event.name}
            </Link>
          </h3>
          <MetaLine event={event} className="mt-0.5" />
        </div>
        <div
          className="grid min-w-[56px] shrink-0 place-items-center rounded-[10px] bg-white/10 px-2 py-1.5 text-center"
          aria-label={timingLabel(t)}
        >
          {t.kind === "upcoming" ? (
            <>
              <b className="text-xl font-extrabold leading-tight tabular-nums">{t.days}</b>
              <small className="text-[10px] font-semibold tracking-[0.04em] text-muted-foreground">
                {t.days === 1 ? "DAY" : "DAYS"}
              </small>
            </>
          ) : (
            <small className="text-[11px] font-bold">Now</small>
          )}
        </div>
      </div>

      {candidate ? (
        <CandidateStatus mine={s.mine} onNavy />
      ) : (
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
            <span>Tickets bought</span>
            <b className="tabular-nums">
              {s.bought} of {s.invited}
            </b>
          </div>
          <SegmentedBar
            className="bg-white/15"
            total={Math.max(s.invited, 1)}
            segments={[
              { value: s.bought, className: "bg-sky", label: "Bought" },
              { value: s.planned, className: "bg-amber", label: "Planned" },
            ]}
          />
          <p className="text-[11.5px] text-muted-foreground">
            {s.invited === 0
              ? "Nobody invited yet"
              : s.needTicket === 0
                ? "Everyone who's going has a ticket"
                : `${s.needTicket} still need a ticket${
                    s.plannedThisWeek ? ` · ${s.plannedThisWeek} plan to buy this week` : ""
                  }`}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {!candidate && <AvatarStack people={s.people} ringClassName="ring-white/35" />}
        {!candidate && s.attention > 0 && (
          <ToneChip tone="warn" icon={AlertTriangle}>
            {s.attention} need attention
          </ToneChip>
        )}
        {!candidate && s.needTicket > 0 && <NeedTicketLink s={s} onNavy />}
        <Button
          asChild
          size="sm"
          className="ml-auto bg-sky text-on-sky hover:bg-sky/90 focus-visible:ring-offset-event"
        >
          <Link to="/events/$id" params={{ id: event.id }}>
            Open event
          </Link>
        </Button>
      </div>
    </SectionCard>
  );
}

/** "N need a ticket": opens the Attendees tab filtered to them. */
function NeedTicketLink({ s, onNavy }: { s: EventSummary; onNavy?: boolean }) {
  return (
    <Button
      asChild
      size="sm"
      variant="outline"
      className={cn(
        "relative h-7 px-2.5 text-xs",
        onNavy && "border-white/25 bg-transparent text-event-fg hover:bg-white/10",
      )}
    >
      <Link
        to="/events/$id"
        params={{ id: s.event.id }}
        search={{ tab: "attendees", filter: "no-ticket" }}
      >
        <Ticket /> {s.needTicket} need a ticket
      </Link>
    </Button>
  );
}

function CandidateStatus({ mine, onNavy }: { mine?: Attendance; onNavy?: boolean }) {
  if (!mine)
    return (
      <p className={cn("text-[12.5px]", onNavy ? "text-event-muted" : "text-muted-foreground")}>
        You're not on the list yet. Open the event to let your sponsor know you want to go.
      </p>
    );
  const st = attendanceStatus(mine);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      <span className={onNavy ? "text-event-muted" : "text-muted-foreground"}>Your status</span>
      <ToneChip tone={st.tone}>{st.label}</ToneChip>
    </div>
  );
}

function UpcomingCard({ s, candidate }: { s: EventSummary; candidate: boolean }) {
  const { event } = s;
  const t = eventTiming(event);
  return (
    <SectionCard className="relative gap-3.5">
      <div className="flex items-start gap-3">
        <DateBadge date={event.date} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-bold leading-snug">
            <Link
              to="/events/$id"
              params={{ id: event.id }}
              className="rounded-sm after:absolute after:inset-0 after:rounded-card hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
            >
              {event.name}
            </Link>
          </h3>
          <MetaLine event={event} className="mt-0.5" />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <EventTypeChip type={event.type} />
            <EventFormatChip event={event} />
            <ToneChip tone={t.kind === "now" || t.days <= 7 ? "warn" : "info"}>
              {timingLabel(t)}
            </ToneChip>
          </div>
        </div>
      </div>

      {candidate ? (
        <CandidateStatus mine={s.mine} />
      ) : !usesTickets(event.type) ? (
        <p className="text-[12.5px] text-muted-foreground">
          {s.going > 0 ? (
            <>
              <b className="font-bold tabular-nums text-foreground">{s.going}</b> coming
            </>
          ) : (
            "Nobody has said they're coming yet."
          )}
        </p>
      ) : s.invited > 0 ? (
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className="text-muted-foreground">Tickets</span>
            <b className="tabular-nums">
              {s.bought} of {s.invited}
            </b>
          </div>
          <SegmentedBar
            total={s.invited}
            segments={[
              { value: s.bought, className: "bg-sky", label: "Bought" },
              { value: s.planned, className: "bg-amber", label: "Planned" },
            ]}
          />
        </div>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">Nobody invited yet.</p>
      )}

      {!candidate && (s.people.length > 0 || s.attention > 0 || s.needTicket > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <AvatarStack people={s.people} />
          {s.attention > 0 && (
            <ToneChip tone="warn" icon={AlertTriangle} className="relative">
              {s.attention} need attention
            </ToneChip>
          )}
          {usesTickets(event.type) && s.needTicket > 0 && <NeedTicketLink s={s} />}
        </div>
      )}
    </SectionCard>
  );
}

function PastRow({ s, candidate }: { s: EventSummary; candidate: boolean }) {
  const { event } = s;
  const t = eventTiming(event);
  const mine = candidate ? attendanceStatus(s.mine) : null;
  return (
    <li className="relative grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 border-t border-line py-3 first:border-t-0 sm:grid-cols-[44px_minmax(0,1fr)_auto]">
      <DateBadge date={event.date} className="w-11 py-1 [&>span:last-child]:text-base" />
      <div className="min-w-0">
        <Link
          to="/events/$id"
          params={{ id: event.id }}
          className="block truncate rounded-sm text-[13.5px] font-semibold after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-ring"
        >
          {event.name}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {EVENT_TYPE_LABEL[event.type]}
          {event.location ? ` · ${event.location}` : ""} · {timingLabel(t)}
        </p>
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:col-start-3 sm:justify-end">
        {mine ? (
          <ToneChip tone={mine.tone}>{s.mine ? mine.label : "Not on the list"}</ToneChip>
        ) : (
          <>
            <span className="text-muted-foreground">
              <b className="text-[13px] font-bold tabular-nums text-foreground">{s.attended}</b>{" "}
              came
              {s.attendedVirtual > 0 && ` · ${s.attendedVirtual} virtual`}
            </span>
            {usesTickets(event.type) && (
              <span className="text-muted-foreground">
                Show rate{" "}
                <b className="text-[13px] font-bold tabular-nums text-foreground">
                  {s.showRate === null ? "–" : `${s.showRate}%`}
                </b>
              </span>
            )}
          </>
        )}
      </div>
    </li>
  );
}
