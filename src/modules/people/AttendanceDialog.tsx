import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  removeAttendance,
  updateAttendance,
  usesTickets,
  useEventCategory,
  type Attendance,
  type CrmEvent,
  type CrmPerson,
  type DesireLevel,
  type AttendMode,
} from "@/data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtDate } from "./format";
import { ClearableDate } from "@/modules/events/ClearableDate";

type AttendedValue = "unset" | "yes" | "no";

/** Edit every attendance field for one person at one event. */
export function AttendanceDialog({
  open,
  onOpenChange,
  attendance,
  event,
  personName,
  helperOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attendance: Attendance;
  event: CrmEvent;
  personName: string;
  helperOptions: CrmPerson[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-card sm:max-w-lg">
        {open && (
          <AttendanceForm
            attendance={attendance}
            event={event}
            personName={personName}
            helperOptions={helperOptions}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AttendanceForm({
  attendance: a,
  event,
  personName,
  helperOptions,
  onDone,
}: {
  attendance: Attendance;
  event: CrmEvent;
  personName: string;
  helperOptions: CrmPerson[];
  onDone: () => void;
}) {
  const [desire, setDesire] = useState<DesireLevel | "unset">(a.desireToAttend ?? "unset");
  const [hasTicket, setHasTicket] = useState(a.hasTicket);
  const [mode, setAttendMode] = useState<AttendMode | "unset">(a.mode ?? "unset");
  const [planned, setPlanned] = useState(a.plannedPurchaseDate ?? "");
  const [followUp, setFollowUp] = useState(a.followUpDate ?? "");
  const [helperId, setHelperId] = useState(a.helperId ?? "none");
  const [attended, setAttended] = useState<AttendedValue>(
    a.attended === true ? "yes" : a.attended === false ? "no" : "unset",
  );
  const [notes, setNotes] = useState(a.notes ?? "");
  const [leadership, setLeadership] = useState(a.leadershipQualified);
  const [special, setSpecial] = useState(a.specialEventQualified);
  const tickets = usesTickets(useEventCategory(event));
  const [confirmRemove, setConfirmRemove] = useState(false);

  // The current helper may be someone the viewer can't see (e.g. their upline).
  const helperKnown = helperId === "none" || helperOptions.some((p) => p.id === helperId);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    updateAttendance(a.id, {
      desireToAttend: desire === "unset" ? undefined : desire,
      hasTicket,
      mode: hasTicket && mode !== "unset" ? mode : undefined,
      plannedPurchaseDate: hasTicket ? a.plannedPurchaseDate : planned || undefined,
      followUpDate: followUp || undefined,
      helperId: helperId === "none" ? null : helperId,
      attended: hasTicket ? (attended === "unset" ? undefined : attended === "yes") : undefined,
      notes: notes.trim() || undefined,
      ...(tickets ? { leadershipQualified: leadership, specialEventQualified: special } : {}),
    });
    toast.success(`Saved ${event.name}`);
    onDone();
  };

  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{event.name}</DialogTitle>
        <DialogDescription>
          {personName} · {fmtDate(event.date, { year: true })}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Wants to go" htmlFor="att-desire">
          <Select value={desire} onValueChange={(v) => setDesire(v as DesireLevel | "unset")}>
            <SelectTrigger id="att-desire">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Not asked yet</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="maybe">Maybe</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Helper" htmlFor="att-helper">
          <Select value={helperId} onValueChange={setHelperId}>
            <SelectTrigger id="att-helper">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No helper</SelectItem>
              {!helperKnown && <SelectItem value={helperId}>Someone outside your team</SelectItem>}
              {helperOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
        <Label htmlFor="att-ticket" className="text-[13px] font-semibold">
          Ticket bought
        </Label>
        <Switch id="att-ticket" checked={hasTicket} onCheckedChange={setHasTicket} />
      </div>

      {hasTicket ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ticket type" htmlFor="att-type">
            <Select value={mode} onValueChange={(v) => setAttendMode(v as AttendMode | "unset")}>
              <SelectTrigger id="att-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Not set</SelectItem>
                <SelectItem value="in_person">In person</SelectItem>
                <SelectItem value="virtual">Virtual</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Attended" htmlFor="att-attended">
            <Select value={attended} onValueChange={(v) => setAttended(v as AttendedValue)}>
              <SelectTrigger id="att-attended">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Not marked</SelectItem>
                <SelectItem value="yes">Attended</SelectItem>
                <SelectItem value="no">No-show</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      ) : (
        <Field label="Plans to buy by" htmlFor="att-planned">
          <ClearableDate
            id="att-planned"
            label="plans to buy by date"
            value={planned || undefined}
            onChange={(v) => setPlanned(v ?? "")}
          />
        </Field>
      )}

      <Field label="Follow-up date" htmlFor="att-follow">
        <ClearableDate
          id="att-follow"
          label="follow-up date"
          value={followUp || undefined}
          onChange={(v) => setFollowUp(v ?? "")}
        />
      </Field>

      {tickets && (
        <div className="grid gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Qualifications</span>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[13px]">
            Leadership qualified
            <Switch checked={leadership} onCheckedChange={setLeadership} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[13px]">
            Qualified for the additional event
            <Switch checked={special} onCheckedChange={setSpecial} />
          </label>
        </div>
      )}

      <Field label="Notes" htmlFor="att-notes">
        <Textarea
          id="att-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything to remember for this event"
        />
      </Field>

      <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => setConfirmRemove(true)}
        >
          <Trash2 /> Remove
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </DialogFooter>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from {event.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes {personName}'s ticket, helper and notes for this event. You can add them
              to the event again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                removeAttendance(a.id);
                toast.success(`Removed from ${event.name}`);
                onDone();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-semibold text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
