import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { CalendarCheck, CalendarPlus, Pencil, Plus } from "lucide-react";
import {
  assignToEvent,
  getPersonShowRate,
  isUpcoming,
  localDate,
  openLog,
  setEventAttendance,
  updateAttendance,
  useCanManageEvents,
  usesTickets,
  eventModes,
  useCategoryOf,
  useAttendancesForPerson,
  useEvents,
  useVisibleAttendances,
  useVisiblePeople,
  useVisibleTeam,
  type Attendance,
  type AttendMode,
  type CrmEvent,
  type CrmPerson,
} from "@/data";
import {
  DateBadge,
  EmptyState,
  PersonAvatar,
  SectionCard,
  StageChip,
  ToneChip,
} from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AttendanceDialog } from "./AttendanceDialog";
import { Segmented } from "@/modules/events/Segmented";
import { attendanceToast, cameOptions, cameValue } from "@/modules/events/attendance";
import { PersonMissedCard } from "@/modules/events/MissedFollowUps";
import { EventFormDialog } from "@/modules/events/EventFormDialog";
import { attendanceChips, fmtDate, firstName, purchaseOverdue, TICKET_TYPE_LABEL } from "./format";

/** An attendance row with its event and whether the event's category uses tickets. */
type Row = { a: Attendance; ev: CrmEvent; tickets: boolean; modes: AttendMode[] };

/** This person's attendance rows joined with their events, soonest upcoming first then most recent past. */
function usePersonEventRows(personId: string) {
  const attendances = useAttendancesForPerson(personId);
  const events = useEvents();
  const categoryOf = useCategoryOf();
  return useMemo(() => {
    const today = localDate();
    const byId = new Map(events.map((e) => [e.id, e]));
    const rows: Row[] = [];
    for (const a of attendances) {
      const ev = byId.get(a.eventId);
      if (!ev) continue;
      const category = categoryOf(ev);
      rows.push({ a, ev, tickets: usesTickets(category), modes: eventModes(ev, category) });
    }
    const upcoming = rows
      .filter((r) => isUpcoming(r.ev, today))
      .sort((x, y) => x.ev.date.localeCompare(y.ev.date));
    const past = rows
      .filter((r) => !isUpcoming(r.ev, today))
      .sort((x, y) => y.ev.date.localeCompare(x.ev.date));
    const assigned = new Set(rows.map((r) => r.ev.id));
    const unassigned = events.filter((e) => !assigned.has(e.id));
    return { upcoming, past, unassigned, attendances, events };
  }, [attendances, events, categoryOf]);
}

type NextStep =
  { label: string; patch: Partial<Attendance>; done: string } | { label: string; dialog: true };

function nextStep({ a, ev, tickets }: Row, today = localDate()): NextStep | null {
  // Events without tickets get the one-tap attendance control instead.
  if (!tickets) return null;
  if (isUpcoming(ev, today)) {
    if (!a.hasTicket && a.desireToAttend !== "no")
      return { label: "Mark bought", patch: { hasTicket: true }, done: "Ticket marked as bought" };
    return null;
  }
  if (a.hasTicket && a.attended === undefined)
    return { label: "Mark attended", patch: { attended: true }, done: "Marked as attended" };
  if (!a.notes && a.attended !== true && (a.hasTicket || a.desireToAttend === "yes"))
    return { label: "Add note", dialog: true };
  return null;
}

/** Meta line under an event row: plan date, follow-up, helper, ticket type, notes. */
function RowMeta({
  row: { a, ev },
  names,
  detailed,
}: {
  row: Row;
  names: Map<string, string>;
  detailed?: boolean;
}) {
  const today = localDate();
  const upcoming = isUpcoming(ev, today);
  const bits: React.ReactNode[] = [];
  if (upcoming && !a.hasTicket && a.plannedPurchaseDate) {
    bits.push(
      purchaseOverdue(a, today) ? (
        <span key="plan" className="font-semibold text-bad">
          Planned to buy by {fmtDate(a.plannedPurchaseDate)}
        </span>
      ) : (
        <span key="plan">Plans to buy by {fmtDate(a.plannedPurchaseDate)}</span>
      ),
    );
  }
  if (a.hasTicket && a.mode) bits.push(<span key="type">{TICKET_TYPE_LABEL[a.mode]}</span>);
  if (upcoming && a.followUpDate)
    bits.push(<span key="fu">Follow up {fmtDate(a.followUpDate)}</span>);
  if (a.helperId)
    bits.push(<span key="helper">Helper {names.get(a.helperId) ?? "from your upline"}</span>);
  if (!detailed && !upcoming && a.notes)
    bits.push(
      <span key="notes" className="truncate">
        {a.notes}
      </span>,
    );
  return bits.length ? <>{bits}</> : null;
}

function EventRow({
  row,
  names,
  action,
  detailed,
}: {
  row: Row;
  names: Map<string, string>;
  action?: React.ReactNode;
  detailed?: boolean;
}) {
  const { a, ev, tickets } = row;
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[52px_minmax(0,1fr)_auto] sm:gap-x-3.5">
      <DateBadge date={ev.date} />
      <div className="min-w-0">
        <Link
          to="/events/$id"
          params={{ id: ev.id }}
          className="block truncate rounded-sm text-[13.5px] font-bold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {ev.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {attendanceChips(a, ev, tickets).map((c) => (
            <ToneChip key={c.label} tone={c.tone}>
              {c.label}
            </ToneChip>
          ))}
          <RowMeta row={row} names={names} detailed={detailed} />
        </div>
        {detailed && a.notes && (
          <p className="mt-1.5 break-words text-xs text-muted-foreground">{a.notes}</p>
        )}
      </div>
      {action ? (
        <div className="col-start-2 flex flex-wrap gap-2 sm:col-start-3 sm:justify-end">
          {action}
        </div>
      ) : (
        <span className="hidden sm:block" />
      )}
    </div>
  );
}

/**
 * Events without tickets: "Coming?" before the day, then "Were they there?"
 * (in person / virtual / not there) from the day of the event.
 */
function QuickAttend({ row: { a, ev, modes }, name }: { row: Row; name: string }) {
  const started = ev.date <= localDate();
  if (!started)
    return (
      <Segmented
        label={`Is ${name} coming to ${ev.name}?`}
        size="sm"
        allowEmpty
        className="w-full sm:w-auto"
        value={a.desireToAttend}
        onChange={(v) => updateAttendance(a.id, { desireToAttend: v })}
        options={[
          { value: "yes", label: "Coming" },
          { value: "maybe", label: "Maybe" },
          { value: "no", label: "Can't" },
        ]}
      />
    );
  return (
    <Segmented
      label={`Was ${name} at ${ev.name}?`}
      size="sm"
      allowEmpty
      className="w-full sm:w-auto"
      value={cameValue(a)}
      onChange={(v) => {
        const undo = setEventAttendance(
          ev.id,
          a.personId,
          v === undefined ? null : v === "no" ? false : v,
        );
        attendanceToast(firstName(name), ev.name, v, undo);
      }}
      options={cameOptions(modes)}
    />
  );
}

function useNameMap() {
  const people = useVisiblePeople();
  return useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
}

/** Helper candidates: visible business people other than this person. */
function useHelperOptions(personId: string) {
  const team = useVisibleTeam();
  return useMemo(
    () => team.filter((p) => p.id !== personId).sort((x, y) => x.name.localeCompare(y.name)),
    [team, personId],
  );
}

function StepButton({
  row,
  step,
  onDialog,
  primary,
}: {
  row: Row;
  step: NextStep;
  onDialog: () => void;
  primary?: boolean;
}) {
  return (
    <Button
      size="sm"
      variant={primary && !("dialog" in step) ? "default" : "outline"}
      onClick={() => {
        if ("dialog" in step) onDialog();
        else {
          updateAttendance(row.a.id, step.patch);
          toast.success(step.done, { description: row.ev.name });
        }
      }}
    >
      {step.label}
    </Button>
  );
}

/** Overview card: upcoming events plus the two most recent past ones. */
export function EventsCard({
  person,
  canEdit,
  onShowAll,
}: {
  person: CrmPerson;
  canEdit: boolean;
  onShowAll: () => void;
}) {
  const { upcoming, past, unassigned } = usePersonEventRows(person.id);
  const names = useNameMap();
  const helperOptions = useHelperOptions(person.id);
  const [editing, setEditing] = useState<Row | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const canCreate = useCanManageEvents() && canEdit;
  const rows = [...upcoming, ...past.slice(0, 2)];
  const hidden = upcoming.length + past.length - rows.length;

  return (
    <>
      <PersonMissedCard person={person} />
      <SectionCard
        title="Events"
        action={
          canEdit ? (
            <span className="flex items-center gap-3">
              {canCreate && (
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Create event
                </button>
              )}
              <button
                type="button"
                onClick={() => setAssignOpen(true)}
                className="rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                Assign to event
              </button>
            </span>
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={<CalendarPlus />}
            title="Not on any events yet"
            body={`Add ${firstName(person.name)} to an event to track tickets and attendance.`}
          />
        ) : (
          <div>
            {rows.map((row) => {
              const step = canEdit ? nextStep(row) : null;
              return (
                <div
                  key={row.a.id}
                  className="border-t border-line py-3 first:border-t-0 first:pt-0"
                >
                  <EventRow
                    row={row}
                    names={names}
                    action={
                      canEdit && !row.tickets ? (
                        <QuickAttend row={row} name={person.name} />
                      ) : step ? (
                        <StepButton
                          row={row}
                          step={step}
                          primary={isUpcoming(row.ev)}
                          onDialog={() => setEditing(row)}
                        />
                      ) : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
        {hidden > 0 && (
          <button
            type="button"
            onClick={onShowAll}
            className="w-fit rounded-sm text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Show {hidden} older {hidden === 1 ? "event" : "events"}
          </button>
        )}
        {editing && (
          <AttendanceDialog
            open
            onOpenChange={(o) => !o && setEditing(null)}
            attendance={editing.a}
            event={editing.ev}
            personName={person.name}
            helperOptions={helperOptions}
          />
        )}
        <AssignEventDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          person={person}
          events={unassigned}
        />
        {canCreate && (
          <CreateEventForPerson open={createOpen} onOpenChange={setCreateOpen} person={person} />
        )}
      </SectionCard>
    </>
  );
}

/** Phone overview: just the next upcoming event, with a full-width next step. */
export function NextEventCard({ person, canEdit }: { person: CrmPerson; canEdit: boolean }) {
  const { upcoming } = usePersonEventRows(person.id);
  const names = useNameMap();
  const row = upcoming[0];
  if (!row) return <PersonMissedCard person={person} />;
  const step = canEdit ? nextStep(row) : null;
  return (
    <>
      <PersonMissedCard person={person} />
      <SectionCard title="Next event">
        <EventRow
          row={row}
          names={names}
          action={
            canEdit && !row.tickets ? <QuickAttend row={row} name={person.name} /> : undefined
          }
        />
        {step && !("dialog" in step) && (
          <Button
            className="w-full"
            onClick={() => {
              updateAttendance(row.a.id, step.patch);
              toast.success(step.done, { description: row.ev.name });
            }}
          >
            {step.label === "Mark bought" ? "Mark ticket bought" : step.label}
          </Button>
        )}
      </SectionCard>
    </>
  );
}

/** Events tab: every assigned event with all fields editable, plus assigning and helping. */
export function EventsTab({ person, canEdit }: { person: CrmPerson; canEdit: boolean }) {
  const { upcoming, past, unassigned, attendances, events } = usePersonEventRows(person.id);
  const names = useNameMap();
  const helperOptions = useHelperOptions(person.id);
  const [editing, setEditing] = useState<Row | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const canCreate = useCanManageEvents() && canEdit;
  const rate = getPersonShowRate(person.id, attendances, events);
  const noShows = attendances.filter((a) => a.hasTicket && a.attended === false).length;
  const today = localDate();
  const upcomingUnassigned = unassigned.filter((e) => isUpcoming(e, today));

  const card = (row: Row) => {
    const step = canEdit ? nextStep(row, today) : null;
    return (
      <div
        key={row.a.id}
        className="rounded-card border border-line bg-card px-4 py-3.5 sm:px-[18px]"
      >
        <EventRow
          row={row}
          names={names}
          detailed
          action={
            canEdit ? (
              <>
                {!row.tickets && <QuickAttend row={row} name={person.name} />}
                {step && (
                  <StepButton
                    row={row}
                    step={step}
                    primary={isUpcoming(row.ev, today)}
                    onDialog={() => setEditing(row)}
                  />
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(row)}
                  aria-label={`Edit ${row.ev.name}`}
                >
                  <Pencil /> Edit
                </Button>
              </>
            ) : undefined
          }
        />
      </div>
    );
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          {attendances.length === 0
            ? "Not on any events yet."
            : [
                `On ${attendances.length} ${attendances.length === 1 ? "event" : "events"}`,
                rate.eligible
                  ? `attended ${rate.attended} of ${rate.eligible} past`
                  : "no past events yet",
                rate.eligible ? `${noShows} ${noShows === 1 ? "no-show" : "no-shows"}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => openLog({ tab: "attendance", personId: person.id })}
            >
              <CalendarCheck /> Log attendance
            </Button>
          )}
          {canCreate && (
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus /> Create event
            </Button>
          )}
          {canEdit && unassigned.length > 0 && (
            <Button size="sm" onClick={() => setAssignOpen(true)}>
              <CalendarPlus /> Assign to event
            </Button>
          )}
        </div>
      </div>

      <PersonMissedCard person={person} />

      {!canEdit && (
        <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12.5px] text-muted-foreground">
          Your sponsor keeps track of tickets. Let them know when you buy yours.
        </p>
      )}

      <EventGroup title="Upcoming">
        {upcoming.length ? (
          upcoming.map(card)
        ) : (
          <EmptyState
            title="No upcoming events"
            body={
              canEdit && upcomingUnassigned.length
                ? `Assign ${firstName(person.name)} to one of the ${upcomingUnassigned.length} upcoming events below.`
                : undefined
            }
          />
        )}
      </EventGroup>

      {past.length > 0 && <EventGroup title="Past">{past.map(card)}</EventGroup>}

      {canEdit && upcomingUnassigned.length > 0 && (
        <EventGroup title="Not on these upcoming events">
          <div className="rounded-card border border-line bg-card px-4 sm:px-[18px]">
            {upcomingUnassigned.map((e) => (
              <UnassignedRow key={e.id} event={e} person={person} />
            ))}
          </div>
        </EventGroup>
      )}

      <HelpingFor person={person} />

      {editing && (
        <AttendanceDialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          attendance={editing.a}
          event={editing.ev}
          personName={person.name}
          helperOptions={helperOptions}
        />
      )}
      <AssignEventDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        person={person}
        events={unassigned}
      />
      {canCreate && (
        <CreateEventForPerson open={createOpen} onOpenChange={setCreateOpen} person={person} />
      )}
    </div>
  );
}

/**
 * "Create event" from a profile: the usual event form, then this person is
 * added to the new event (the first one when it repeats weekly).
 */
function CreateEventForPerson({
  open,
  onOpenChange,
  person,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: CrmPerson;
}) {
  const navigate = useNavigate();
  return (
    <EventFormDialog
      open={open}
      onOpenChange={onOpenChange}
      onCreated={(e) => {
        assignToEvent(e.id, person.id);
        toast.success(`Added ${firstName(person.name)} to ${e.name}`, {
          action: {
            label: "Open event",
            onClick: () => void navigate({ to: "/events/$id", params: { id: e.id } }),
          },
        });
      }}
    />
  );
}

function EventGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2.5">
      <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function UnassignedRow({ event, person }: { event: CrmEvent; person: CrmPerson }) {
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-3 first:border-t-0 sm:grid-cols-[52px_minmax(0,1fr)_auto]">
      <DateBadge date={event.date} />
      <div className="min-w-0">
        <Link
          to="/events/$id"
          params={{ id: event.id }}
          className="block truncate rounded-sm text-[13.5px] font-bold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {event.name}
        </Link>
        {event.location && (
          <p className="truncate text-xs text-muted-foreground">{event.location}</p>
        )}
      </div>
      <Button
        size="sm"
        variant="soft"
        onClick={() => {
          assignToEvent(event.id, person.id);
          toast.success(`Added ${firstName(person.name)} to ${event.name}`);
        }}
      >
        Assign
      </Button>
    </div>
  );
}

/** Pick an event (upcoming first, then past) to add this person to. */
function AssignEventDialog({
  open,
  onOpenChange,
  person,
  events,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  person: CrmPerson;
  events: CrmEvent[];
}) {
  const today = localDate();
  const upcoming = events.filter((e) => isUpcoming(e, today));
  const past = events.filter((e) => !isUpcoming(e, today)).reverse();
  const pick = (e: CrmEvent) => {
    assignToEvent(e.id, person.id);
    toast.success(`Added ${firstName(person.name)} to ${e.name}`);
    onOpenChange(false);
  };
  const list = (items: CrmEvent[]) => (
    <div className="grid gap-1">
      {items.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => pick(e)}
          className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-lg p-1.5 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <DateBadge date={e.date} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold">{e.name}</span>
            {e.location && (
              <span className="block truncate text-xs text-muted-foreground">{e.location}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign {firstName(person.name)} to an event</DialogTitle>
          <DialogDescription>
            They'll show up on the event's list so you can track their ticket.
          </DialogDescription>
        </DialogHeader>
        {events.length === 0 ? (
          <EmptyState title="Already on every event" />
        ) : (
          <div className="grid gap-4">
            {upcoming.length > 0 && (
              <div className="grid gap-1.5">
                <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Upcoming
                </h3>
                {list(upcoming)}
              </div>
            )}
            {past.length > 0 && (
              <div className="grid gap-1.5">
                <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Past
                </h3>
                {list(past)}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** People this person is the event helper for (was "Helping for"). */
function HelpingFor({ person }: { person: CrmPerson }) {
  const all = useVisibleAttendances();
  const events = useEvents();
  const people = useVisiblePeople();
  const categoryOf = useCategoryOf();
  const rows = useMemo(() => {
    const evs = new Map(events.map((e) => [e.id, e]));
    const ppl = new Map(people.map((p) => [p.id, p]));
    return all
      .filter((a) => a.helperId === person.id)
      .map((a) => ({ a, ev: evs.get(a.eventId), p: ppl.get(a.personId) }))
      .filter((r): r is { a: Attendance; ev: CrmEvent; p: CrmPerson } => !!r.ev && !!r.p)
      .sort((x, y) => y.ev.date.localeCompare(x.ev.date));
  }, [all, events, people, person.id]);

  if (!rows.length) return null;
  return (
    <EventGroup title={`Helping ${rows.length} ${rows.length === 1 ? "person" : "people"}`}>
      <div className="rounded-card border border-line bg-card px-4 sm:px-[18px]">
        {rows.map(({ a, ev, p }) => {
          const chip = attendanceChips(a, ev, usesTickets(categoryOf(ev))).at(-1);
          return (
            <div
              key={a.id}
              className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-line py-2.5 text-[13px] first:border-t-0"
            >
              <PersonAvatar name={p.name} stage={p.bizClass} size="sm" />
              <div className="min-w-0">
                <Link
                  to="/people/$id"
                  params={{ id: p.id }}
                  className="rounded-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {p.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">{ev.name}</p>
              </div>
              <div className={cn("flex items-center gap-1.5")}>
                <StageChip stage={p.bizClass} className="hidden sm:inline-flex" />
                {chip && <ToneChip tone={chip.tone}>{chip.label}</ToneChip>}
              </div>
            </div>
          );
        })}
      </div>
    </EventGroup>
  );
}
