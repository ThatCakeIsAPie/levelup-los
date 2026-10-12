import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useEventsStore, type EventType, type CrmEvent } from "@/stores/eventsStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/events/")({ component: EventsPage });

const typeLabel: Record<EventType, string> = { conference: "Conference", team_meeting: "Team Meeting" };

function EventsPage() {
  const events = useEventsStore((s) => s.events);
  const all = useAttendanceStore((s) => s.attendances);
  const now = new Date().toISOString().slice(0, 10);
  const yr = now.slice(0, 4);
  const upcoming = events.filter((e) => e.date >= now && e.date.startsWith(yr)).sort((a, b) => a.date.localeCompare(b.date));
  const past = events.filter((e) => e.date < now).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <h1 className="text-sm font-semibold tracking-tight">Events</h1>
        <AddEventDialog />
      </header>
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Attendees</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow><TableCell colSpan={5} className="bg-muted text-xs font-semibold">Upcoming (this year)</TableCell></TableRow>
            {[...upcoming, null, ...past].map((e) => {
              if (!e) return <TableRow key="sep"><TableCell colSpan={5} className="bg-muted text-xs font-semibold">Past events</TableCell></TableRow>;
              const count = all.filter((a) => a.eventId === e.id).length;
              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <Link to="/events/$id" params={{ id: e.id }} className="font-medium hover:underline">{e.name}</Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{typeLabel[e.type]}</TableCell>
                  <TableCell className="text-sm">{e.date}</TableCell>
                  <TableCell className="text-sm">{e.location ?? "—"}</TableCell>
                  <TableCell className="text-right text-sm">{count}</TableCell>
                </TableRow>
              );
            })}
            {events.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No events yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AddEventDialog() {
  const add = useEventsStore((s) => s.add);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Omit<CrmEvent, "id">>({
    name: "",
    type: "conference",
    date: new Date().toISOString().slice(0, 10),
  });

  const submit = () => {
    if (!form.name.trim()) return;
    add(form);
    setForm({ name: "", type: "conference", date: new Date().toISOString().slice(0, 10) });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-3.5 w-3.5" /> Add event</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add event</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as EventType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="conference">Conference</SelectItem>
                  <SelectItem value="team_meeting">Team Meeting</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Location</Label>
            <Input value={form.location ?? ""} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
