import { useState, type ReactNode } from "react";
import { addDays, format } from "date-fns";
import { toast } from "sonner";
import {
  EVENT_TYPE_INFO,
  EVENT_TYPES,
  MAX_TICKET_URL,
  addEvent,
  allowsVirtual,
  cleanTicketUrl,
  eventFormat,
  localDate,
  parseDate,
  updateEvent,
  type CrmEvent,
  type EventFormat,
  type EventType,
} from "@/data";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OptionGrid } from "@/components/log/parts";
import { Segmented } from "./Segmented";
import { EVENT_TYPE_ICON, MODE_ICON } from "./typeIcons";
import { ActingForBadge } from "@/modules/settings/TeamSettingsCards";

type Draft = Omit<CrmEvent, "id">;

const blank = (): Draft => ({
  name: EVENT_TYPE_INFO.night_owls.label,
  type: "night_owls",
  date: localDate(),
  format: "in_person",
});

const TYPE_OPTIONS = EVENT_TYPES.map((t) => ({
  value: t,
  label: EVENT_TYPE_INFO[t].label,
  hint: EVENT_TYPE_INFO[t].hint,
  icon: EVENT_TYPE_ICON[t],
}));

/** Weekly copies when creating ("Repeat every week"): 2 to 12 in all. */
const MAX_WEEKS = 12;

/**
 * Create (no `event`) or edit (with `event`) an event: type, name, in person
 * and/or virtual (where the type allows it), dates, location and notes. A new
 * event can repeat weekly (Night Owls). Controlled open state so it can be
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
    return { ...rest, format: eventFormat(event) };
  });
  const [touched, setTouched] = useState(false);
  // The name follows the type until the user types their own.
  const [autoName, setAutoName] = useState(!event);
  const [repeat, setRepeat] = useState(false);
  const [weeks, setWeeks] = useState("4");
  const set = (patch: Partial<Draft>) => setForm((f) => ({ ...f, ...patch }));

  const pickType = (type: EventType) =>
    set({
      type,
      format: allowsVirtual(type) ? (form.format ?? "in_person") : "in_person",
      ...(autoName ? { name: EVENT_TYPE_INFO[type].label } : {}),
    });

  const weekCount = Math.min(MAX_WEEKS, Math.max(2, Math.round(Number(weeks)) || 2));
  const nameError = touched && !form.name.trim() ? "Give the event a name." : null;
  const dateError = !form.date ? "Pick a start date." : null;
  const endError =
    form.endDate && form.date && form.endDate < form.date
      ? "The end date can't be before the start date."
      : null;
  const ticketUrl = cleanTicketUrl(form.ticketUrl);
  const ticketBad = !!form.ticketUrl?.trim() && !ticketUrl;
  const ticketError =
    touched && ticketBad ? "Paste a web link, like https://venmo.com/u/your-name." : null;

  const submit = () => {
    setTouched(true);
    if (!form.name.trim() || dateError || endError || ticketBad) return;
    const clean: Draft = {
      ...form,
      name: form.name.trim(),
      endDate: form.endDate && form.endDate !== form.date ? form.endDate : undefined,
      location: form.location?.trim() || undefined,
      notes: form.notes?.trim() || undefined,
      ticketUrl: ticketUrl ?? undefined,
      format: eventFormat(form),
    };
    if (event) {
      updateEvent(event.id, clean);
      toast.success("Event updated");
      onDone();
      return;
    }
    const created = addEvent(clean);
    if (repeat) {
      const shift = (d: string | undefined, w: number) =>
        d ? format(addDays(parseDate(d), 7 * w), "yyyy-MM-dd") : undefined;
      for (let w = 1; w < weekCount; w++)
        addEvent({ ...clean, date: shift(clean.date, w)!, endDate: shift(clean.endDate, w) });
      toast.success(`${created.name} created for the next ${weekCount} weeks`);
    } else {
      toast.success(`${created.name} created`);
    }
    onDone(created);
  };

  const virtualOk = allowsVirtual(form.type);
  const info = EVENT_TYPE_INFO[form.type];

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
        {/* Deputies edit on their leader's behalf (src/data/team). */}
        <ActingForBadge className="w-fit" />
      </DialogHeader>

      <OptionGrid<EventType>
        label="Type of event"
        options={TYPE_OPTIONS}
        value={form.type}
        onChange={pickType}
      />

      <div className="grid gap-1.5">
        <Label htmlFor="ev-name">Name</Label>
        <Input
          id="ev-name"
          value={form.name}
          aria-invalid={!!nameError}
          aria-describedby={nameError ? "ev-name-err" : undefined}
          onChange={(e) => {
            setAutoName(false);
            set({ name: e.target.value });
          }}
          placeholder={info.label}
        />
        {nameError && (
          <p id="ev-name-err" className="text-xs text-bad">
            {nameError}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label id="ev-format-label">How people join</Label>
        {virtualOk ? (
          <Segmented<EventFormat>
            label="How people join"
            value={form.format}
            onChange={(v) => v && set({ format: v })}
            options={[
              { value: "in_person", label: "In person", icon: MODE_ICON.in_person },
              { value: "virtual", label: "Virtual", icon: MODE_ICON.virtual },
              { value: "both", label: "Both" },
            ]}
          />
        ) : (
          <p className="text-[12.5px] text-muted-foreground">{info.label} is in person only.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="ev-start">{info.travel ? "Start date" : "Date"}</Label>
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

      {!event && (
        <div className="grid gap-2 rounded-lg bg-surface-2 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Checkbox id="ev-repeat" checked={repeat} onCheckedChange={(v) => setRepeat(!!v)} />
            <Label htmlFor="ev-repeat" className="text-[13px] font-medium">
              Repeat every week
            </Label>
          </div>
          {repeat && (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
              <Label htmlFor="ev-weeks" className="text-[12.5px] font-normal">
                For
              </Label>
              <Input
                id="ev-weeks"
                type="number"
                inputMode="numeric"
                min={2}
                max={MAX_WEEKS}
                className="h-8 w-16"
                value={weeks}
                onChange={(e) => setWeeks(e.target.value)}
              />
              <span>weeks, starting on the date above</span>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="ev-loc">{form.format === "virtual" ? "Link or where" : "Location"}</Label>
        <Input
          id="ev-loc"
          value={form.location ?? ""}
          onChange={(e) => set({ location: e.target.value })}
          placeholder={
            form.format === "virtual"
              ? "Zoom"
              : form.format === "both"
                ? "Dallas office and Zoom"
                : "Dallas, TX"
          }
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ev-ticket">Ticket link</Label>
        <Input
          id="ev-ticket"
          type="url"
          inputMode="url"
          autoComplete="off"
          maxLength={MAX_TICKET_URL}
          value={form.ticketUrl ?? ""}
          onChange={(e) => set({ ticketUrl: e.target.value })}
          placeholder="https://… or venmo.com/u/…"
          aria-invalid={!!ticketError || undefined}
          aria-describedby="ev-ticket-hint"
          onBlur={() => form.ticketUrl?.trim() && setTouched(true)}
        />
        <p
          id="ev-ticket-hint"
          className={ticketError ? "text-xs text-bad" : "text-xs text-muted-foreground"}
        >
          {ticketError ??
            "Where people buy a ticket: the team's ticket page, a Venmo link… Optional. People get a Buy ticket button that goes straight there."}
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ev-notes">Notes</Label>
        <Textarea
          id="ev-notes"
          value={form.notes ?? ""}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder={
            info.travel ? "Travel details, agenda, what to bring" : "Agenda, what to bring"
          }
        />
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          {event ? "Save changes" : repeat ? `Create ${weekCount} events` : "Create event"}
        </Button>
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
