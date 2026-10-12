import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { usePeopleStore, type BizClass, missingRequiredFields } from "@/stores/peopleStore";
import { useAttendancesForPerson, usePerson, useVisiblePeople } from "@/data";
import { useEventsStore } from "@/stores/eventsStore";
import { useAttendanceStore, type DesireLevel, type TicketType } from "@/stores/attendanceStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { ArrowLeft, Plus, Trash2, AlertCircle } from "lucide-react";
import { PipelineAndTags } from "@/modules/people/PipelineAndTags";
import { EngagementStats } from "@/modules/people/EngagementStats";
import { ActivityTimeline } from "@/modules/people/ActivityTimeline";
import { SponsorMiniTree } from "@/modules/people/SponsorMiniTree";
import { HelpingFor } from "@/modules/people/HelpingFor";
import { QuickActions } from "@/modules/people/QuickActions";
import { format } from "date-fns";

export const Route = createFileRoute("/people/$id")({
  head: () => ({ meta: [{ title: "Person — LevelUp LOS" }] }),
  component: PersonDetail,
});

const bizClassOptions: { value: BizClass; label: string }[] = [
  { value: "ibo", label: "IBO" },
  { value: "apprentice", label: "A (Apprentice)" },
  { value: "prospect", label: "P (Prospect)" },
  { value: "customer", label: "Customer" },
];

function PersonDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  // Non-visible ids behave as "not found" (src/data/access.ts).
  const person = usePerson(id);
  const people = useVisiblePeople();
  const update = usePeopleStore((s) => s.update);
  const remove = usePeopleStore((s) => s.remove);
  const events = useEventsStore((s) => s.events);
  const attendances = useAttendancesForPerson(id);
  const addAttendance = useAttendanceStore((s) => s.add);
  const updateAttendance = useAttendanceStore((s) => s.update);
  const removeAttendance = useAttendanceStore((s) => s.remove);

  if (!person) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Person not found.</p>
        <Link to="/people" className="text-sm underline">
          Back to people
        </Link>
      </div>
    );
  }

  const requiresIds = person.bizClass === "ibo" || person.bizClass === "apprentice";
  const missingIbo = requiresIds && !person.iboNumber?.trim();
  const missingLtd = requiresIds && !person.ltdNumber?.trim();
  const missing = missingRequiredFields(person);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <Link
          to="/people"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> People
        </Link>
        <span className="ml-2 text-sm font-semibold tracking-tight">{person.name}</span>
        {missing.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
            <AlertCircle className="h-3 w-3" /> Missing {missing.join(", ")}
          </span>
        )}
        {person.lastUpdatedAt && (
          <span className="ml-2 text-[11px] text-muted-foreground">
            Updated {format(new Date(person.lastUpdatedAt), "MMM d, yyyy p")}
          </span>
        )}
        <span className="ml-auto" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            remove(person.id);
            nav({ to: "/people" });
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <QuickActions person={person} />

        <div className="grid gap-4 md:grid-cols-2">
          <PipelineAndTags person={person} />
          <EngagementStats personId={person.id} />
        </div>

        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Details
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Name">
              <Input
                value={person.name}
                onChange={(e) => update(person.id, { name: e.target.value })}
              />
            </Field>
            <Field label="Biz Class">
              <Select
                value={person.bizClass}
                onValueChange={(v) => update(person.id, { bizClass: v as BizClass })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bizClassOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Location">
              <Input
                value={person.location ?? ""}
                onChange={(e) => update(person.id, { location: e.target.value })}
                placeholder="City, State"
              />
            </Field>

            <Field
              label={`IBO#${requiresIds ? " *" : ""}`}
              error={missingIbo ? "Required for IBOs and Apprentices" : undefined}
            >
              <Input
                value={person.iboNumber ?? ""}
                onChange={(e) => update(person.id, { iboNumber: e.target.value })}
              />
            </Field>
            <Field
              label={`LTD#${requiresIds ? " *" : ""}`}
              error={missingLtd ? "Required for IBOs and Apprentices" : undefined}
            >
              <Input
                value={person.ltdNumber ?? ""}
                onChange={(e) => update(person.id, { ltdNumber: e.target.value })}
              />
            </Field>
            <Field label="Joined date">
              <Input
                type="date"
                value={person.joinedDate ?? ""}
                onChange={(e) => update(person.id, { joinedDate: e.target.value })}
              />
            </Field>

            <Field label="Email">
              <Input
                value={person.email ?? ""}
                onChange={(e) => update(person.id, { email: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={person.phone ?? ""}
                onChange={(e) => update(person.id, { phone: e.target.value })}
              />
            </Field>
            <Field label="Sponsor">
              <Select
                value={person.sponsorId ?? "none"}
                onValueChange={(v) => update(person.id, { sponsorId: v === "none" ? null : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {people
                    .filter((p) => p.id !== person.id)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Notes">
            <Textarea
              value={person.notes ?? ""}
              onChange={(e) => update(person.id, { notes: e.target.value })}
            />
          </Field>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Event Attendance
          </h2>
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Desire</TableHead>
                  <TableHead className="text-center">Ticket</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Planned date</TableHead>
                  <TableHead>Follow-up</TableHead>
                  <TableHead>Helper</TableHead>
                  <TableHead className="text-center">Attended</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((ev) => {
                  const a = attendances.find((x) => x.eventId === ev.id);
                  if (!a) {
                    return (
                      <TableRow key={ev.id}>
                        <TableCell>
                          <Link
                            to="/events/$id"
                            params={{ id: ev.id }}
                            className="font-medium hover:underline"
                          >
                            {ev.name}
                          </Link>
                          <div className="text-xs text-muted-foreground">{ev.date}</div>
                        </TableCell>
                        <TableCell colSpan={8} className="text-xs text-muted-foreground">
                          Not assigned
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => addAttendance(ev.id, person.id)}
                          >
                            <Plus className="h-3.5 w-3.5" /> Assign
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  }
                  return (
                    <TableRow key={ev.id}>
                      <TableCell>
                        <Link
                          to="/events/$id"
                          params={{ id: ev.id }}
                          className="font-medium hover:underline"
                        >
                          {ev.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{ev.date}</div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={a.desireToAttend ?? ""}
                          onValueChange={(v) =>
                            updateAttendance(a.id, { desireToAttend: v as DesireLevel })
                          }
                        >
                          <SelectTrigger className="h-8 w-[100px]">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="yes">Yes ✅</SelectItem>
                            <SelectItem value="no">No ❌ (Out)</SelectItem>
                            <SelectItem value="maybe">Maybe</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={a.hasTicket}
                          onCheckedChange={(v) => updateAttendance(a.id, { hasTicket: !!v })}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={a.ticketType ?? ""}
                          onValueChange={(v) =>
                            updateAttendance(a.id, { ticketType: v as TicketType })
                          }
                          disabled={!a.hasTicket}
                        >
                          <SelectTrigger className="h-8 w-[120px]">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="in_person">In person</SelectItem>
                            <SelectItem value="stream">Stream</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {!a.hasTicket ? (
                          <Input
                            type="date"
                            className="h-8 w-[140px]"
                            value={a.plannedPurchaseDate ?? ""}
                            onChange={(e) =>
                              updateAttendance(a.id, { plannedPurchaseDate: e.target.value })
                            }
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          className="h-8 w-[140px]"
                          value={a.followUpDate ?? ""}
                          onChange={(e) => updateAttendance(a.id, { followUpDate: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={a.helperId ?? "none"}
                          onValueChange={(v) =>
                            updateAttendance(a.id, { helperId: v === "none" ? null : v })
                          }
                        >
                          <SelectTrigger className="h-8 w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— None —</SelectItem>
                            {people
                              .filter((p) => p.id !== person.id)
                              .map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={!!a.attended}
                          onCheckedChange={(v) => updateAttendance(a.id, { attended: !!v })}
                          disabled={!a.hasTicket}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-40"
                          value={a.notes ?? ""}
                          onChange={(e) => updateAttendance(a.id, { notes: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => removeAttendance(a.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {events.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-sm text-muted-foreground">
                      No events yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <SponsorMiniTree personId={person.id} />
          <HelpingFor personId={person.id} />
        </div>

        <ActivityTimeline personId={person.id} />
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
