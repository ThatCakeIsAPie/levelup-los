import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarX2, ChevronLeft, MapPin, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DateBadge, EmptyState, SectionCard, StatStrip, ToneChip } from "@/components/brand";
import { LogButton } from "@/components/log/LogSheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  removeEvent,
  useAttendancesForEvent,
  useCurrentUser,
  useEvent,
  useSharedCosts,
  type Attendance,
  type CrmEvent,
} from "@/data";
import { cn } from "@/lib/utils";
import { AttendeeEditSheet } from "@/modules/events/AttendeeEditSheet";
import { AttendeesTab, type AttendeeFilter } from "@/modules/events/AttendeesTab";
import { AttentionPanel } from "@/modules/events/AttentionPanel";
import { AuditComparison } from "@/modules/events/AuditComparison";
import { EventFormDialog } from "@/modules/events/EventFormDialog";
import { EventFunnel } from "@/modules/events/EventFunnel";
import { EventLogistics } from "@/modules/events/EventLogistics";
import { EventDetailsPanel, RosterMix } from "@/modules/events/EventMetricsPanel";
import { MyPlanCard } from "@/modules/events/MyPlanCard";
import {
  EVENT_TYPE_LABEL,
  canManageEvents,
  eventTiming,
  formatEventRange,
  timingLabel,
} from "@/modules/events/lib";

type TabKey = "overview" | "attendees" | "travel" | "compare";
const TABS: readonly TabKey[] = ["overview", "attendees", "travel", "compare"];

/**
 * `?tab=attendees&filter=no-ticket` opens the Attendees tab showing only the
 * people who still need a ticket (used by the Dashboard and Events list).
 */
interface EventSearch {
  tab?: TabKey;
  filter?: AttendeeFilter;
}

export const Route = createFileRoute("/events/$id")({
  validateSearch: (search: Record<string, unknown>): EventSearch => ({
    tab: TABS.includes(search.tab as TabKey) ? (search.tab as TabKey) : undefined,
    filter: search.filter === "no-ticket" ? "no-ticket" : undefined,
  }),
  head: () => ({ meta: [{ title: "Event — LevelUp LOS" }] }),
  component: EventDetail,
});

function EventDetail() {
  const { id } = Route.useParams();
  const event = useEvent(id);
  const rows = useAttendancesForEvent(id);
  const user = useCurrentUser();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // The tab lives in the URL so links (and Back) can open a specific tab.
  const setSearch = (next: (prev: EventSearch) => EventSearch) =>
    navigate({ search: next, replace: true, resetScroll: false });
  const setTab = (t: TabKey) =>
    setSearch((prev) => ({
      tab: t === "overview" ? undefined : t,
      filter: t === "attendees" ? prev.filter : undefined,
    }));
  // Keep the id while the sheet animates closed so its content doesn't blank out.
  const [edit, setEdit] = useState<{ id: string | null; open: boolean }>({
    id: null,
    open: false,
  });

  if (!event) {
    return (
      <div className="grid gap-5 px-4 py-5 lg:px-[26px] lg:py-[22px]">
        <BackLink />
        <EmptyState
          icon={<CalendarX2 />}
          title="Event not found"
          body="It may have been deleted, or the link is wrong."
          action={
            <Button asChild variant="outline">
              <Link to="/events">Back to events</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const timing = eventTiming(event);
  const finished = timing.kind === "past";
  const candidate = user.role === "candidate";
  // Candidates only get Overview and Tickets and travel.
  const tab: TabKey =
    candidate && (search.tab === "attendees" || search.tab === "compare")
      ? "overview"
      : (search.tab ?? "overview");
  const editing = rows.find((a) => a.id === edit.id);
  const openEdit = (attendanceId: string) => setEdit({ id: attendanceId, open: true });

  return (
    <div className="grid gap-5 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <div className="grid gap-2">
        <BackLink />
        <Hero event={event} manage={canManageEvents(user.role)} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="grid gap-4">
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:px-0">
          <TabsList className="h-auto w-max gap-0.5 bg-surface-2 p-1">
            <TabsTrigger value="overview" className="px-3 py-1.5 text-[13px] sm:px-3.5">
              Overview
            </TabsTrigger>
            {!candidate && (
              <TabsTrigger value="attendees" className="px-3 py-1.5 text-[13px] sm:px-3.5">
                Attendees
                <span className="ml-1.5 rounded-full bg-track px-1.5 text-[11px] tabular-nums">
                  {rows.length}
                </span>
              </TabsTrigger>
            )}
            <TabsTrigger value="travel" className="px-3 py-1.5 text-[13px] sm:px-3.5">
              <span className="sm:hidden">Travel</span>
              <span className="hidden sm:inline">Tickets and travel</span>
            </TabsTrigger>
            {!candidate && (
              <TabsTrigger value="compare" className="px-3 py-1.5 text-[13px] sm:px-3.5">
                Compare
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-0">
          {candidate ? (
            <CandidateOverview event={event} rows={rows} finished={finished} />
          ) : (
            <Overview event={event} rows={rows} finished={finished} onEdit={openEdit} />
          )}
        </TabsContent>
        {!candidate && (
          <TabsContent value="attendees" className="mt-0">
            <AttendeesTab
              event={event}
              rows={rows}
              finished={finished}
              onEdit={openEdit}
              filter={search.filter}
              onClearFilter={() => setSearch((prev) => ({ ...prev, filter: undefined }))}
            />
          </TabsContent>
        )}
        <TabsContent value="travel" className="mt-0">
          <EventLogistics event={event} rows={rows} />
        </TabsContent>
        {!candidate && (
          <TabsContent value="compare" className="mt-0">
            <AuditComparison event={event} />
          </TabsContent>
        )}
      </Tabs>

      {!candidate && (
        <AttendeeEditSheet
          attendance={editing}
          open={edit.open}
          onOpenChange={(o) => setEdit((e) => ({ ...e, open: o }))}
          finished={finished}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/events"
      className="inline-flex w-fit items-center gap-1 rounded-sm text-[12.5px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <ChevronLeft className="size-3.5" aria-hidden="true" />
      Events
    </Link>
  );
}

/** Title card: navy while the event is ahead (like the list's feature card), plain once it's over. */
function Hero({ event, manage }: { event: CrmEvent; manage: boolean }) {
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const costCount = useSharedCosts(event.id).length;
  const t = eventTiming(event);
  const navy = t.kind !== "past";

  return (
    <SectionCard variant={navy ? "event" : "default"} className="gap-0 sm:py-5">
      <div className="flex items-start gap-3 sm:gap-4">
        <DateBadge date={event.date} className={cn("sm:w-14", navy && "bg-white/10")} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] font-extrabold leading-tight lg:text-[22px]">{event.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted-foreground">
            <span>{formatEventRange(event)}</span>
            {event.location && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden="true" />
                  {event.location}
                </span>
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ToneChip tone="neutral" className={navy ? "bg-white/10 text-event-fg" : undefined}>
              {EVENT_TYPE_LABEL[event.type]}
            </ToneChip>
            <ToneChip
              tone={
                t.kind === "past" ? "neutral" : t.kind === "now" || t.days <= 7 ? "warn" : "info"
              }
            >
              {timingLabel(t)}
            </ToneChip>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {navy && t.kind === "upcoming" && (
            <div
              className="hidden min-w-[60px] place-items-center rounded-[10px] bg-white/10 px-2 py-1.5 text-center sm:grid"
              aria-hidden="true"
            >
              <b className="text-[22px] font-extrabold leading-tight tabular-nums">{t.days}</b>
              <small className="text-[10px] font-semibold tracking-[0.04em] text-muted-foreground">
                {t.days === 1 ? "DAY" : "DAYS"}
              </small>
            </div>
          )}
          <LogButton
            className={cn(
              "hidden lg:inline-flex",
              navy && "bg-sky text-navy hover:bg-sky/90 focus-visible:ring-offset-event",
            )}
          />
          {manage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Event actions"
                  className={cn(navy && "text-event-fg hover:bg-white/10 hover:text-event-fg")}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                  <Pencil /> Edit event
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setDeleteOpen(true)}
                  className="text-bad focus:bg-bad-soft focus:text-bad"
                >
                  <Trash2 /> Delete event
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {event.notes && (
        <p
          className={cn(
            "mt-3 border-t pt-3 text-[13px] text-muted-foreground",
            navy ? "border-white/15" : "border-line",
          )}
        >
          {event.notes}
        </p>
      )}

      <EventFormDialog open={editOpen} onOpenChange={setEditOpen} event={event} />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {event.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The event disappears for everyone on the team, together with its roster, travel plans
              and shared costs{costCount > 0 ? " (including sandbox payments)" : ""}. This can't be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                removeEvent(event.id);
                toast.success(`${event.name} deleted`);
                navigate({ to: "/events" });
              }}
            >
              Delete event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}

function Overview({
  event,
  rows,
  finished,
  onEdit,
}: {
  event: CrmEvent;
  rows: Attendance[];
  finished: boolean;
  onEdit: (attendanceId: string) => void;
}) {
  const wantToGo = rows.filter((a) => a.desireToAttend === "yes").length;
  const tickets = rows.filter((a) => a.hasTicket).length;
  const planned = rows.filter((a) => !a.hasTicket && a.plannedPurchaseDate).length;
  const attended = rows.filter((a) => a.attended === true).length;

  return (
    <div className="grid gap-4">
      <StatStrip
        items={[
          { value: rows.length, label: "Invited" },
          { value: wantToGo, label: "Want to go" },
          { value: tickets, label: "Have a ticket" },
          finished
            ? { value: `${attended} of ${tickets}`, label: "Attended of expected" }
            : { value: tickets + planned, label: "Expected (tickets + planned)" },
        ]}
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <AttentionPanel event={event} rows={rows} onEdit={onEdit} />
          <EventFunnel rows={rows} finished={finished} />
        </div>
        <div className="grid gap-4">
          <MyPlanCard eventId={event.id} rows={rows} finished={finished} />
          <RosterMix rows={rows} />
          <EventDetailsPanel rows={rows} />
        </div>
      </div>
    </div>
  );
}

function CandidateOverview({
  event,
  rows,
  finished,
}: {
  event: CrmEvent;
  rows: Attendance[];
  finished: boolean;
}) {
  const mine = rows.length > 0;
  return (
    <div className="grid max-w-2xl gap-4">
      <MyPlanCard eventId={event.id} rows={rows} finished={finished} />
      {finished && !mine && (
        <EmptyState
          icon={<CalendarX2 />}
          title="You weren't on this event"
          body="Ask your sponsor about the next one."
        />
      )}
    </div>
  );
}
