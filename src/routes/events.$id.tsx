import { useShallow } from "zustand/react/shallow";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useEventsStore, type EventType } from "@/stores/eventsStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { useAttendanceStore, type Attendance, type DesireLevel, type TicketType } from "@/stores/attendanceStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Trash2, Download, UserX } from "lucide-react";
import { EventMetricsPanel } from "@/modules/events/EventMetricsPanel";
import { EventFunnel } from "@/modules/events/EventFunnel";
import { AttentionPanel } from "@/modules/events/AttentionPanel";
import { AttendeeKanban } from "@/modules/events/AttendeeKanban";
import { RiskBadge } from "@/modules/events/RiskFlags";
import { AuditComparison } from "@/modules/events/AuditComparison";
import { EventLogistics } from "@/modules/events/EventLogistics";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toCsv, downloadCsv } from "@/lib/csvExport";
import { toast } from "sonner";
import { differenceInDays, format } from "date-fns";

export const Route = createFileRoute("/events/$id")({ component: EventDetail });

const typeLabel: Record<EventType, string> = { conference: "Conference", team_meeting: "Team Meeting" };

function EventDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const event = useEventsStore((s) => s.getById(id));
  const updateEvent = useEventsStore((s) => s.update);
  const removeEvent = useEventsStore((s) => s.remove);
  const attendances = useAttendanceStore(useShallow((s) => s.forEvent(id)));

  if (!event) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Event not found.</p>
        <Link to="/events" className="text-sm underline">Back to events</Link>
      </div>
    );
  }

  const daysOut = differenceInDays(new Date(event.date), new Date());

  return (
    <TooltipProvider>
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <Link to="/events" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Events
        </Link>
        <span className="ml-2 text-sm font-semibold tracking-tight">{event.name}</span>
        <span className="text-xs text-muted-foreground">{typeLabel[event.type]} · {format(new Date(event.date), "MMM d, yyyy")}</span>
        <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${daysOut >= 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
          {daysOut >= 0 ? `${daysOut} days out` : `${Math.abs(daysOut)} days ago`}
        </span>
        <span className="ml-auto" />
        <Button variant="ghost" size="sm" onClick={() => { removeEvent(event.id); nav({ to: "/events" }); }}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      </header>

      <div className="border-b border-border px-4 py-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="grid gap-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={event.name} onChange={(e) => updateEvent(event.id, { name: e.target.value })} className="h-8" />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Type</Label>
            <Select value={event.type} onValueChange={(v) => updateEvent(event.id, { type: v as EventType })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="conference">Conference</SelectItem>
                <SelectItem value="team_meeting">Team Meeting</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Date</Label>
            <Input type="date" className="h-8" value={event.date} onChange={(e) => updateEvent(event.id, { date: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Location</Label>
            <Input className="h-8" value={event.location ?? ""} onChange={(e) => updateEvent(event.id, { location: e.target.value })} />
          </div>
        </div>
      </div>

      <Tabs defaultValue="attendees" className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 w-fit">
          <TabsTrigger value="attendees">Attendees ({attendances.length})</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="travel">Tickets, travel & costs</TabsTrigger>
        </TabsList>
        <TabsContent value="attendees" className="flex-1 overflow-auto">
          <div className="space-y-4 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <EventFunnel eventId={event.id} />
              <AttentionPanel eventId={event.id} />
            </div>
            <EventMetricsPanel eventId={event.id} />
            <AttendeesView eventId={event.id} attendances={attendances} />
          </div>
        </TabsContent>
        <TabsContent value="travel" className="flex-1 overflow-auto"><EventLogistics eventId={id} /></TabsContent>
        <TabsContent value="audit" className="flex-1 overflow-auto">
          <AuditComparison eventId={event.id} />
        </TabsContent>
      </Tabs>
    </div>
    </TooltipProvider>
  );
}

function AttendeesView({ eventId, attendances }: { eventId: string; attendances: Attendance[] }) {
  const [view, setView] = useState<"table" | "kanban">("table");
  const people = usePeopleStore((s) => s.people);
  const getById = usePeopleStore((s) => s.getById);
  const update = useAttendanceStore((s) => s.update);
  const bulkUpdate = useAttendanceStore((s) => s.bulkUpdate);
  const remove = useAttendanceStore((s) => s.remove);

  const exportCsv = () => {
    const rows = attendances.map((a) => {
      const p = getById(a.personId);
      const helper = a.helperId ? getById(a.helperId)?.name : "";
      return {
        Name: p?.name ?? "", Biz: p?.bizClass ?? "",
        Desire: a.desireToAttend ?? "", FollowUp: a.followUpDate ?? "",
        Ticket: a.hasTicket ? "Yes" : "", TicketType: a.ticketType ?? "",
        PlannedPurchase: a.plannedPurchaseDate ?? "", Helper: helper,
        Leadership: a.leadershipQualified ? "Yes" : "", Special: a.specialEventQualified ? "Yes" : "",
        Attended: a.attended === true ? "Yes" : a.attended === false ? "No" : "",
        Notes: a.notes ?? "",
      };
    });
    downloadCsv("attendees.csv", toCsv(rows));
    toast.success(`Exported ${rows.length} attendees`);
  };

  const bulkMarkNoShow = () => {
    const ids = attendances.filter((a) => a.hasTicket && a.attended !== true).map((a) => a.id);
    if (ids.length === 0) { toast.info("No ticketed attendees to mark"); return; }
    bulkUpdate(ids, { attended: false });
    toast.success(`Marked ${ids.length} as no-show`);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Track ticketing, follow-ups, and qualifications.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as "table" | "kanban")}>
            <TabsList className="h-8">
              <TabsTrigger value="table" className="h-7 px-3 text-xs">Table</TabsTrigger>
              <TabsTrigger value="kanban" className="h-7 px-3 text-xs">Kanban</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" variant="outline" onClick={bulkMarkNoShow}><UserX className="h-3.5 w-3.5" /> Bulk No-Show</Button>
          <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-3.5 w-3.5" /> Export CSV</Button>
          <AddAttendeeDialog eventId={eventId} existingPersonIds={attendances.map((a) => a.personId)} />
        </div>
      </div>

      {view === "kanban" ? (
        <AttendeeKanban eventId={eventId} />
      ) : (
        <AttendeeTable attendances={attendances} update={update} remove={remove} people={people} getById={getById} />
      )}
    </div>
  );
}

function AttendeeTable({ attendances, update, remove, people, getById }: {
  attendances: Attendance[];
  update: ReturnType<typeof useAttendanceStore.getState>["update"];
  remove: ReturnType<typeof useAttendanceStore.getState>["remove"];
  people: ReturnType<typeof usePeopleStore.getState>["people"];
  getById: ReturnType<typeof usePeopleStore.getState>["getById"];
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">!</TableHead>
            <TableHead>Person</TableHead>
            <TableHead>Biz</TableHead>
            <TableHead>Desire</TableHead>
            <TableHead>Follow-up</TableHead>
            <TableHead>Ticket</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Planned</TableHead>
            <TableHead>Helper</TableHead>
            <TableHead>Lead.</TableHead>
            <TableHead>Special</TableHead>
            <TableHead>Attended</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {attendances.map((a) => {
            const person = getById(a.personId);
            const bizLabel = person ? ({ ibo: "IBO", apprentice: "A", prospect: "P", customer: "Cust" } as const)[person.bizClass] : "—";
            return (
              <TableRow key={a.id}>
                <TableCell><RiskBadge attendance={a} /></TableCell>
                <TableCell className="font-medium whitespace-nowrap">
                  {person ? <Link to="/people/$id" params={{ id: person.id }} className="hover:underline">{person.name}</Link> : "—"}
                </TableCell>
                <TableCell className="text-xs font-mono">{bizLabel}</TableCell>
                <TableCell>
                  <Select value={a.desireToAttend ?? ""} onValueChange={(v) => update(a.id, { desireToAttend: v as DesireLevel })}>
                    <SelectTrigger className="h-8 w-[90px]"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes ✅</SelectItem>
                      <SelectItem value="no">No (Out)</SelectItem>
                      <SelectItem value="maybe">Maybe</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input type="date" className="h-8 w-[140px]" value={a.followUpDate ?? ""} onChange={(e) => update(a.id, { followUpDate: e.target.value })} />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox checked={a.hasTicket} onCheckedChange={(v) => update(a.id, { hasTicket: !!v })} />
                </TableCell>
                <TableCell>
                  <Select value={a.ticketType ?? ""} onValueChange={(v) => update(a.id, { ticketType: v as TicketType })} disabled={!a.hasTicket}>
                    <SelectTrigger className="h-8 w-[110px]"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_person">In person</SelectItem>
                      <SelectItem value="stream">Stream</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {!a.hasTicket ? (
                    <Input type="date" className="h-8 w-[140px]" value={a.plannedPurchaseDate ?? ""} onChange={(e) => update(a.id, { plannedPurchaseDate: e.target.value })} />
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  <Select value={a.helperId ?? "none"} onValueChange={(v) => update(a.id, { helperId: v === "none" ? null : v })}>
                    <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox checked={a.leadershipQualified} onCheckedChange={(v) => update(a.id, { leadershipQualified: !!v })} />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox checked={a.specialEventQualified} onCheckedChange={(v) => update(a.id, { specialEventQualified: !!v })} />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox checked={!!a.attended} onCheckedChange={(v) => update(a.id, { attended: !!v })} disabled={!a.hasTicket} />
                </TableCell>
                <TableCell>
                  <Input className="h-8 w-40" value={a.notes ?? ""} onChange={(e) => update(a.id, { notes: e.target.value })} />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(a.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
          {attendances.length === 0 && (
            <TableRow><TableCell colSpan={14} className="text-center text-sm text-muted-foreground">No attendees yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function AddAttendeeDialog({ eventId, existingPersonIds }: { eventId: string; existingPersonIds: string[] }) {
  const people = usePeopleStore((s) => s.people);
  const addPerson = usePeopleStore((s) => s.add);
  const addAttendance = useAttendanceStore((s) => s.add);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [personId, setPersonId] = useState<string>("");
  const [newName, setNewName] = useState("");

  const available = useMemo(
    () => people.filter((p) => !existingPersonIds.includes(p.id)),
    [people, existingPersonIds],
  );

  const submit = () => {
    if (mode === "existing") {
      if (!personId) return;
      addAttendance(eventId, personId);
    } else {
      if (!newName.trim()) return;
      const p = addPerson({ name: newName.trim(), bizClass: "prospect", sponsorId: null });
      addAttendance(eventId, p.id);
    }
    setPersonId(""); setNewName(""); setMode("existing"); setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-3.5 w-3.5" /> Add attendee</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add attendee</DialogTitle></DialogHeader>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "existing" | "new")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="existing">From roster</TabsTrigger>
            <TabsTrigger value="new">New person</TabsTrigger>
          </TabsList>
          <TabsContent value="existing" className="pt-3">
            <Label className="text-xs">Person</Label>
            <Select value={personId} onValueChange={setPersonId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="Pick a person" /></SelectTrigger>
              <SelectContent>
                {available.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                {available.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Everyone is already added.</div>}
              </SelectContent>
            </Select>
          </TabsContent>
          <TabsContent value="new" className="pt-3">
            <Label className="text-xs">Name</Label>
            <Input className="mt-1.5" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Will be added to roster as a prospect" />
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
