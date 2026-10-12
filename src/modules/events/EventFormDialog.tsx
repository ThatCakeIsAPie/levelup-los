import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { addEvent, localDate, updateEvent, type CrmEvent, type EventType } from "@/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EVENT_TYPE_LABEL } from "./lib";

type Draft = Omit<CrmEvent, "id">;

const blank = (): Draft => ({ name: "", type: "conference", date: localDate() });

/**
 * Create (no `event`) or edit (with `event`) an event: name, type, start and
 * optional end date, location and notes. Controlled open state so it can be
 * opened from a button or a menu item.
 */
export function EventFormDialog({
  open,
  onOpenChange,
  event,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: CrmEvent;
  onCreated?: (e: CrmEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-card">
        {/* Remount on open so the fields start from the current values. */}
        {open && (
          <EventForm
            event={event}
            onDone={(created) => {
              onOpenChange(false);
              if (created) onCreated?.(created);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EventForm({
  event,
  onDone,
  onCancel,
}: {
  event?: CrmEvent;
  onDone: (created?: CrmEvent) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Draft>(() => {
    if (!event) return blank();
    const { id: _id, ...rest } = event;
    return rest;
  });
  const [touched, setTouched] = useState(false);
  const set = (patch: Partial<Draft>) => setForm((f) => ({ ...f, ...patch }));

  const nameError = touched && !form.name.trim() ? "Give the event a name." : null;
  const dateError = !form.date ? "Pick a start date." : null;
  const endError =
    form.endDate && form.date && form.endDate < form.date
      ? "The end date can't be before the start date."
      : null;

  const submit = () => {
    setTouched(true);
    if (!form.name.trim() || dateError || endError) return;
    const clean: Draft = {
      ...form,
      name: form.name.trim(),
      endDate: form.endDate && form.endDate !== form.date ? form.endDate : undefined,
      location: form.location?.trim() || undefined,
      notes: form.notes?.trim() || undefined,
    };
    if (event) {
      updateEvent(event.id, clean);
      toast.success("Event updated");
      onDone();
    } else {
      const created = addEvent(clean);
      toast.success(`${created.name} created`);
      onDone(created);
    }
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader className="text-left">
        <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
        <DialogDescription>
          {event
            ? "Changes show up for everyone on the team."
            : "Everyone on the team will see this event in their list."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="ev-name">Name</Label>
        <Input
          id="ev-name"
          value={form.name}
          autoFocus
          aria-invalid={!!nameError}
          aria-describedby={nameError ? "ev-name-err" : undefined}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Fall Leadership Weekend"
        />
        {nameError && (
          <p id="ev-name-err" className="text-xs text-bad">
            {nameError}
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ev-type">Type</Label>
        <Select value={form.type} onValueChange={(v) => set({ type: v as EventType })}>
          <SelectTrigger id="ev-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(EVENT_TYPE_LABEL) as EventType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {EVENT_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="ev-start">Start date</Label>
          <Input
            id="ev-start"
            type="date"
            value={form.date}
            onChange={(e) => set({ date: e.target.value })}
          />
          {dateError && <p className="text-xs text-bad">{dateError}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ev-end">
            End date <span className="font-normal text-faint">(optional)</span>
          </Label>
          <Input
            id="ev-end"
            type="date"
            min={form.date}
            value={form.endDate ?? ""}
            onChange={(e) => set({ endDate: e.target.value || undefined })}
          />
        </div>
      </div>
      {endError && <p className="-mt-2 text-xs text-bad">{endError}</p>}
      <div className="grid gap-1.5">
        <Label htmlFor="ev-loc">Location</Label>
        <Input
          id="ev-loc"
          value={form.location ?? ""}
          onChange={(e) => set({ location: e.target.value })}
          placeholder="Dallas, TX or Zoom"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ev-notes">Notes</Label>
        <Textarea
          id="ev-notes"
          value={form.notes ?? ""}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="Travel details, agenda, what to bring"
        />
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{event ? "Save changes" : "Create event"}</Button>
      </DialogFooter>
    </form>
  );
}

/** Small wrapper used where the trigger lives next to the dialog. */
export function EventFormTrigger({
  children,
  onCreated,
}: {
  children: (open: () => void) => ReactNode;
  onCreated?: (e: CrmEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {children(() => setOpen(true))}
      <EventFormDialog open={open} onOpenChange={setOpen} onCreated={onCreated} />
    </>
  );
}
