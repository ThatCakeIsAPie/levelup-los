import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  MAX_TICKET_URL,
  REPEAT_FREQS,
  addEvent,
  allowsVirtual,
  cleanTicketUrl,
  eventFormat,
  localDate,
  makeEventRepeat,
  repeatFits,
  repeatLabel,
  saveEventFollowing,
  updateEvent,
  useCategoryOf,
  useEventCategories,
  useEventSeries,
  type CrmEvent,
  type EventCategory,
  type EventFormat,
  type EventPatch,
  type RepeatChoice,
  type RepeatFreq,
} from "@/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Segmented } from "./Segmented";
import { MODE_ICON } from "./categoryIcons";
import { CategoryPicker } from "./CategoryPicker";
import { formatEventRange } from "./lib";
import { SeriesScopeDialog, type SeriesScope } from "./SeriesScopeDialog";
import { ActingForBadge } from "@/modules/settings/TeamSettingsCards";

import { sensitive } from "@/lib/sensitive";
type Draft = Omit<CrmEvent, "id">;

/** The fields of the form that an edit carries to the events that follow. */
const patchOf = (d: Draft): EventPatch => ({
  name: d.name,
  categoryId: d.categoryId,
  location: d.location,
  notes: d.notes,
  format: d.format,
  ticketUrl: d.ticketUrl,
  date: d.date,
  endDate: d.endDate,
});

/** A new event starts in the team's first category, named after it. */
const blank = (first: EventCategory | undefined): Draft => ({
  name: first?.name ?? "",
  categoryId: first?.id ?? "",
  date: localDate(),
  format: "in_person",
});

/**
 * Create (no `event`) or edit (with `event`) an event: category (with "+ New
 * category" for people who may plan events), name, in person and/or virtual
 * (where the category allows it), dates, whether and how it repeats, location
 * and notes. Saving a change to an occurrence of a repeating event asks "This
 * event" or "This and following events". Controlled open state so it can be
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
  const categories = useEventCategories();
  const categoryOf = useCategoryOf();
  const [form, setForm] = useState<Draft>(() => {
    if (!event) return blank(categories[0]);
    const { id: _id, ...rest } = event;
    return { ...rest, format: eventFormat(event, categoryOf(event)) };
  });
  const [touched, setTouched] = useState(false);
  // The name follows the category until the user types their own.
  const [autoName, setAutoName] = useState(!event);
  // Repeats and Ends (src/data/recurrence): the rule of the series this event belongs to, if any.
  const series = useEventSeries(event);
  const [freq, setFreq] = useState<RepeatFreq | "none">(series?.freq ?? "none");
  const [ends, setEnds] = useState<"never" | "on">(series?.endsOn ? "on" : "never");
  const [endsOn, setEndsOn] = useState(series?.endsOn ?? "");
  const [ask, setAsk] = useState<{ patch: EventPatch; repeat: RepeatChoice } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Draft>) => setForm((f) => ({ ...f, ...patch }));

  const pickCategory = (c: EventCategory) =>
    set({
      categoryId: c.id,
      format: allowsVirtual(c) ? (form.format ?? "in_person") : "in_person",
      ...(autoName ? { name: c.name } : {}),
    });
  const category = categoryOf(form.categoryId);
  const categoryError = touched && !form.categoryId ? "Pick a category." : null;

  // A multi-day event repeats only less often than it is long; the choices that don't fit are off.
  const fits = (f: RepeatFreq) => repeatFits(f, form.date, form.endDate);
  const repeatsOff = !REPEAT_FREQS.some(fits);
  const activeFreq: RepeatFreq | "none" = freq !== "none" && fits(freq) ? freq : "none";
  const endsBad = activeFreq !== "none" && ends === "on" && (!endsOn || endsOn < form.date);
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

  const submit = async () => {
    setTouched(true);
    if (!form.categoryId || !form.name.trim() || dateError || endError || ticketBad || endsBad)
      return;
    const clean: Draft = {
      ...form,
      name: form.name.trim(),
      endDate: form.endDate && form.endDate !== form.date ? form.endDate : undefined,
      location: form.location?.trim() || undefined,
      notes: form.notes?.trim() || undefined,
      ticketUrl: ticketUrl ?? undefined,
      format: eventFormat(form, category),
    };
    const rule =
      activeFreq === "none"
        ? null
        : { freq: activeFreq, endsOn: ends === "on" && endsOn ? endsOn : undefined };
    if (event?.seriesId) {
      // An occurrence of a repeating event: ask which events the change is for.
      const same =
        activeFreq === (series?.freq ?? "none") &&
        (rule?.endsOn ?? null) === (series?.endsOn ?? null);
      setAsk({
        patch: patchOf(clean),
        repeat: same ? undefined : rule ? { ...rule } : "none",
      });
      return;
    }
    setSaving(true);
    if (event) {
      updateEvent(event.id, clean);
      const made = rule ? await makeEventRepeat(event.id, rule) : null;
      setSaving(false);
      if (made && !made.ok) toast.error(made.error);
      else toast.success("Event updated");
      onDone();
      return;
    }
    const created = addEvent(clean);
    const made = rule ? await makeEventRepeat(created.id, rule) : null;
    setSaving(false);
    if (made && !made.ok) toast.error(made.error);
    toast.success(`${created.name} created`);
    onDone(created);
  };

  /** The answer to "This event" / "This and following events". */
  const choose = async (scope: SeriesScope) => {
    if (!event || !ask) return;
    setSaving(true);
    if (scope === "this") {
      updateEvent(event.id, ask.patch);
      setSaving(false);
      toast.success("Event updated");
    } else {
      const done = await saveEventFollowing(event.id, ask.patch, ask.repeat);
      setSaving(false);
      if (!done.ok) {
        toast.error(done.error);
        setAsk(null);
        return;
      }
      toast.success("Events updated");
    }
    setAsk(null);
    onDone();
  };

  const virtualOk = allowsVirtual(category);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
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

      <div className="grid gap-1">
        <CategoryPicker
          id="ev-category"
          value={form.categoryId}
          onChange={pickCategory}
          keepId={event?.categoryId}
        />
        {categoryError && <p className="text-xs text-bad">{categoryError}</p>}
      </div>

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
          placeholder={category.name}
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
          <p className="text-[12.5px] text-muted-foreground">
            {form.categoryId ? `${category.name} is in person only.` : "In person."}
          </p>
        )}
      </div>

      {/* min-w-0: native date inputs are wider than half a phone screen. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="ev-start">{category.usesTravel ? "Start date" : "Date"}</Label>
          <Input
            id="ev-start"
            type="date"
            className="min-w-0"
            value={form.date}
            onChange={(e) => set({ date: e.target.value })}
          />
          {dateError && <p className="text-xs text-bad">{dateError}</p>}
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="ev-end">
            End date <span className="font-normal text-faint">(optional)</span>
          </Label>
          <Input
            id="ev-end"
            type="date"
            className="min-w-0"
            min={form.date}
            value={form.endDate ?? ""}
            onChange={(e) => set({ endDate: e.target.value || undefined })}
          />
        </div>
      </div>
      {endError && <p className="-mt-2 text-xs text-bad">{endError}</p>}

      <div className="grid gap-1.5">
        <Label htmlFor="ev-repeats">Repeats</Label>
        <Select
          value={activeFreq}
          onValueChange={(v) => setFreq(v as RepeatFreq | "none")}
          disabled={repeatsOff && activeFreq === "none"}
        >
          <SelectTrigger id="ev-repeats">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Does not repeat</SelectItem>
            {REPEAT_FREQS.map((f) => (
              <SelectItem key={f} value={f} disabled={!fits(f)}>
                {repeatLabel(f, form.date || localDate())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {activeFreq !== "none" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="ev-ends">Ends</Label>
            <Select value={ends} onValueChange={(v) => setEnds(v as "never" | "on")}>
              <SelectTrigger id="ev-ends">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Never</SelectItem>
                <SelectItem value="on">On a date</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {ends === "on" && (
            <div className="grid min-w-0 content-end gap-1.5">
              <Input
                id="ev-ends-on"
                type="date"
                aria-label="Ends on"
                className="min-w-0"
                min={form.date}
                value={endsOn}
                aria-invalid={(touched && endsBad) || undefined}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="ev-loc">{form.format === "virtual" ? "Link or where" : "Location"}</Label>
        <Input
          id="ev-loc"
          {...sensitive("address")}
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
            category.usesTravel ? "Travel details, agenda, what to bring" : "Agenda, what to bring"
          }
        />
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {event ? "Save changes" : "Create event"}
        </Button>
      </DialogFooter>
      {event?.seriesId && (
        <SeriesScopeDialog
          open={!!ask}
          onOpenChange={(o) => !o && setAsk(null)}
          title={`Save changes to ${event.name}?`}
          description={formatEventRange(event)}
          thisDisabled={ask?.repeat !== undefined}
          busy={saving}
          onChoose={choose}
        />
      )}
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
