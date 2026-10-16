import { useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarPlus,
  Check,
  Download,
  MoreHorizontal,
  Tag,
  Trash2,
  TrendingUp,
  UserRoundCog,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { STAGE_LABEL } from "@/components/brand";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  assignToEvent,
  bulkUpdateAttendances,
  localDate,
  logContact,
  removeAttendance,
  removeContact,
  removePerson,
  updatePeople,
  useUpcomingEvents,
  useVisibleAttendances,
  type CrmPerson,
} from "@/data";
import { toastWithUndo } from "@/components/log/quickLog";
import { exportRowsCsv } from "./exportCsv";
import {
  STAGE_KEYS,
  cleanTag,
  deletePlan,
  plural,
  shortDate,
  skippedNote,
  sponsorChangePlan,
  sponsorChoices,
  stageChangePlan,
  stagePatch,
  tagPlan,
  tagsInUse,
  uplineIdsOf,
  type PersonRow,
  type Plan,
  type Segment,
  type StageKey,
} from "./model";

type DialogKind = "event" | "followup" | "stage" | "sponsor" | "tag" | "delete";

const people = (n: number) => plural(n, "person", "people");

/** Sticky bar shown while people are selected. */
export function BulkBar({
  rows,
  segment,
  people: everyone,
  viewerId,
  shownCount,
  onSelectAll,
  onClear,
}: {
  rows: PersonRow[];
  segment: Segment;
  /** Everyone the viewer can see (for the sponsor and delete rules). */
  people: CrmPerson[];
  viewerId: string;
  /** How many people in the list can be selected. */
  shownCount: number;
  /** "Select all shown" (missing when they already are). */
  onSelectAll?: () => void;
  onClear: () => void;
}) {
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const n = rows.length;
  const customers = segment === "customers";
  const dialogProps = (kind: DialogKind) => ({
    open: dialog === kind,
    onOpenChange: (o: boolean) => setDialog(o ? kind : null),
    rows,
    onDone: onClear,
  });

  const checkInAll = () => {
    const ids = rows.map((r) => logContact({ personId: r.person.id }).id);
    toastWithUndo(
      customers
        ? `Contact logged for ${plural(n, "customer")}`
        : `Check-in logged for ${people(n)}`,
      () => ids.forEach(removeContact),
      { undoneMessage: n === 1 ? "Check-in removed" : "Check-ins removed" },
    );
    onClear();
  };

  const action = "h-9 px-2.5 text-[12.5px] sm:px-3 [&>span]:hidden sm:[&>span]:inline";

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky bottom-3 z-20 mt-3 flex items-center gap-1.5 rounded-card border border-line bg-surface px-2.5 py-2 shadow-[0_10px_30px_rgba(10,21,37,.18)] sm:gap-2 sm:px-3"
    >
      <span className="mr-auto flex min-w-0 items-baseline gap-2 pl-1">
        <span className="whitespace-nowrap text-[13px] font-bold tabular-nums">{n} selected</span>
        {onSelectAll && shownCount > n && (
          <button
            type="button"
            onClick={onSelectAll}
            className="hidden whitespace-nowrap rounded-sm text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring sm:inline"
          >
            Select all {shownCount}
          </button>
        )}
      </span>
      <Button
        size="sm"
        variant="soft"
        className={action}
        onClick={checkInAll}
        aria-label={customers ? "Log contact" : "Check in"}
      >
        <Check aria-hidden="true" />
        <span>{customers ? "Log contact" : "Check in"}</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={action}
        onClick={() => setDialog("event")}
        aria-label="Add to event"
      >
        <CalendarPlus aria-hidden="true" />
        <span>Add to event</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={action}
        onClick={() => exportRowsCsv(rows, customers ? "customers-selected" : "people-selected")}
        aria-label="Export selected as CSV"
      >
        <Download aria-hidden="true" />
        <span>Export</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className={action} aria-label="More actions">
            <MoreHorizontal aria-hidden="true" />
            <span>More</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-56">
          {!customers && (
            <>
              <DropdownMenuItem onSelect={() => setDialog("stage")}>
                <TrendingUp /> Change stage
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("sponsor")}>
                <UserRoundCog /> Change sponsor
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onSelect={() => setDialog("tag")}>
            <Tag /> Add a tag
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("followup")}>
            <CalendarClock /> Set follow-up date
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setDialog("delete")}
            className="text-bad focus:bg-bad-soft focus:text-bad"
          >
            <Trash2 /> Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="icon"
        variant="ghost"
        className="size-9"
        onClick={onClear}
        aria-label="Clear selection"
      >
        <X />
      </Button>

      <AssignDialog {...dialogProps("event")} />
      <FollowUpDialog {...dialogProps("followup")} />
      {!customers && <StageDialog {...dialogProps("stage")} everyone={everyone} />}
      {!customers && <SponsorDialog {...dialogProps("sponsor")} everyone={everyone} />}
      <TagDialog {...dialogProps("tag")} everyone={everyone} />
      <DeleteDialog
        {...dialogProps("delete")}
        everyone={everyone}
        viewerId={viewerId}
        customers={customers}
      />
    </div>
  );
}

interface DialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: PersonRow[];
  onDone: () => void;
}

/** "2 skipped (already an IBO)" under a dialog's choice, when some are left alone. */
function PlanNote({ plan }: { plan: Plan | null }) {
  const note = plan && skippedNote(plan);
  if (!plan || !note) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {plan.apply.length === 0
        ? `Nobody to change (${[...new Set(plan.skipped.map((s) => s.reason))].join(", ")}).`
        : `${note}.`}
    </p>
  );
}

function StageDialog({
  open,
  onOpenChange,
  rows,
  onDone,
  everyone,
}: DialogProps & { everyone: CrmPerson[] }) {
  const [to, setTo] = useState<StageKey | "">("");
  const plan = to ? stageChangePlan(rows, to, everyone) : null;

  const submit = () => {
    if (!to || !plan?.apply.length) return;
    const today = localDate();
    const undo = updatePeople(
      plan.apply.map((r) => ({ id: r.person.id, patch: stagePatch(r.person, to, today) })),
    );
    toastWithUndo(`${people(plan.apply.length)} moved to ${STAGE_LABEL[to]}`, undo, {
      description: skippedNote(plan),
      undoneMessage: "Stage change undone",
    });
    setTo("");
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change stage for {people(rows.length)}</DialogTitle>
          <DialogDescription>
            Someone made an apprentice without a start date starts their business today.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="bulk-stage">New stage</Label>
          <Select value={to} onValueChange={(v) => setTo(v as StageKey)}>
            <SelectTrigger id="bulk-stage">
              <SelectValue placeholder="Choose a stage" />
            </SelectTrigger>
            <SelectContent>
              {STAGE_KEYS.map((s) => (
                <SelectItem key={s} value={s}>
                  {STAGE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <PlanNote plan={plan} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!plan?.apply.length}>
            {plan?.apply.length ? `Change ${people(plan.apply.length)}` : "Change stage"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SponsorDialog({
  open,
  onOpenChange,
  rows,
  onDone,
  everyone,
}: DialogProps & { everyone: CrmPerson[] }) {
  const [sponsorId, setSponsorId] = useState("");
  const choices = useMemo(
    () =>
      sponsorChoices(
        everyone,
        rows.map((r) => r.person.id),
      ),
    [everyone, rows],
  );
  const sponsor = choices.find((p) => p.id === sponsorId);
  const plan = sponsor ? sponsorChangePlan(rows, sponsor.id, everyone) : null;

  const submit = () => {
    if (!sponsor || !plan?.apply.length) return;
    const undo = updatePeople(
      plan.apply.map((r) => ({ id: r.person.id, patch: { sponsorId: sponsor.id } })),
    );
    toastWithUndo(`${people(plan.apply.length)} moved under ${sponsor.name}`, undo, {
      description: skippedNote(plan),
      undoneMessage: "Sponsor change undone",
    });
    setSponsorId("");
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change sponsor for {people(rows.length)}</DialogTitle>
          <DialogDescription>
            Their own teams move with them. Nobody can be put under someone on their own team.
          </DialogDescription>
        </DialogHeader>
        {choices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There's nobody they could move under. Sponsors are apprentices and IBOs outside the
            selected people's teams.
          </p>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="bulk-sponsor">New sponsor</Label>
            <Select value={sponsorId} onValueChange={setSponsorId}>
              <SelectTrigger id="bulk-sponsor">
                <SelectValue placeholder="Choose an apprentice or IBO" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {choices.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <PlanNote plan={plan} />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!plan?.apply.length}>
            {plan?.apply.length ? `Move ${people(plan.apply.length)}` : "Change sponsor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TagDialog({
  open,
  onOpenChange,
  rows,
  onDone,
  everyone,
}: DialogProps & { everyone: CrmPerson[] }) {
  const [draft, setDraft] = useState("");
  const tag = cleanTag(draft);
  const suggestions = useMemo(() => tagsInUse(everyone).slice(0, 8), [everyone]);
  const plan = tag ? tagPlan(rows, tag) : null;

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!tag || !plan?.apply.length) return;
    const undo = updatePeople(
      plan.apply.map((r) => ({
        id: r.person.id,
        patch: { tags: [...(r.person.tags ?? []), tag] },
      })),
    );
    toastWithUndo(`Tagged ${people(plan.apply.length)} “${tag}”`, undo, {
      description: skippedNote(plan),
      undoneMessage: "Tag removed",
    });
    setDraft("");
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-card sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a tag to {people(rows.length)}</DialogTitle>
            <DialogDescription>Tags show on each profile and in the CSV export.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="bulk-tag">Tag</Label>
            <Input
              id="bulk-tag"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Fall weekend"
              maxLength={40}
              autoComplete="off"
            />
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1" aria-label="Tags in use">
                {suggestions.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDraft(t)}
                    aria-pressed={t === tag}
                    className="rounded-full border border-line px-2.5 py-0.5 text-[12px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-transparent aria-pressed:bg-primary-soft aria-pressed:text-primary-ink"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            <PlanNote plan={plan} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!plan?.apply.length}>
              Add tag
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  open,
  onOpenChange,
  rows,
  onDone,
  everyone,
  viewerId,
  customers,
}: DialogProps & { everyone: CrmPerson[]; viewerId: string; customers: boolean }) {
  const plan = useMemo(
    () => deletePlan(rows, uplineIdsOf(everyone, viewerId)),
    [rows, everyone, viewerId],
  );
  const count = plan.apply.length;
  const who = customers ? plural(count, "customer") : people(count);

  const submit = () => {
    plan.apply.forEach((r) => removePerson(r.person.id));
    toast.success(`Deleted ${who}`, { description: skippedNote(plan) });
    onDone();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100%-2rem)] rounded-card">
        <AlertDialogHeader>
          <AlertDialogTitle>{count ? `Delete ${who}?` : "Nobody to delete"}</AlertDialogTitle>
          <AlertDialogDescription>
            {count
              ? customers
                ? "Their sales history and event spots go with them. This can't be undone."
                : "Anyone they sponsor and any customers they have move up to their sponsor. Their event spots and travel plans go with them. This can't be undone."
              : "You can't delete yourself or anyone above you."}
            {count > 0 && skippedNote(plan) ? ` ${skippedNote(plan)}.` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {count > 0 && count <= 6 && (
          <ul className="grid gap-0.5 text-[13px]">
            {plan.apply.map((r) => (
              <li key={r.person.id} className="truncate">
                {r.person.name}
              </li>
            ))}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {count > 0 && (
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={submit}
            >
              Delete {who}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AssignDialog({ open, onOpenChange, rows, onDone }: DialogProps) {
  const events = useUpcomingEvents();
  const attendances = useVisibleAttendances();
  const [eventId, setEventId] = useState("");
  const event = events.find((e) => e.id === eventId);
  const already = event
    ? rows.filter((r) =>
        attendances.some((a) => a.eventId === eventId && a.personId === r.person.id),
      ).length
    : 0;

  const submit = () => {
    if (!event) return;
    const on = new Set(attendances.filter((a) => a.eventId === event.id).map((a) => a.personId));
    const added = rows
      .filter((r) => !on.has(r.person.id))
      .map((r) => assignToEvent(event.id, r.person.id).id);
    if (added.length)
      toastWithUndo(
        `Added ${people(added.length)} to ${event.name}`,
        () => added.forEach(removeAttendance),
        {
          description: already
            ? `${already} ${already === 1 ? "was" : "were"} already on the list.`
            : undefined,
          undoneMessage: "Removed from the event",
        },
      );
    else toast.success(`Everyone was already on ${event.name}`);
    setEventId("");
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {people(rows.length)} to an event</DialogTitle>
          <DialogDescription>They join the event's list with no ticket yet.</DialogDescription>
        </DialogHeader>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">There are no upcoming events.</p>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="bulk-event">Event</Label>
            <Select value={eventId} onValueChange={setEventId}>
              <SelectTrigger id="bulk-event">
                <SelectValue placeholder="Choose an upcoming event" />
              </SelectTrigger>
              <SelectContent>
                {events.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name} · {shortDate(e.date)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {already > 0 && (
              <p className="text-xs text-muted-foreground">
                {already === rows.length
                  ? rows.length === 1
                    ? "They're already on this event."
                    : "Everyone selected is already on this event."
                  : `${already} of them ${already === 1 ? "is" : "are"} already on it and will be skipped.`}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!event || already === rows.length}>
            Add to event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FollowUpDialog({ open, onOpenChange, rows, onDone }: DialogProps) {
  const attendances = useVisibleAttendances();
  const upcoming = useUpcomingEvents();
  const [date, setDate] = useState("");
  const upcomingIds = new Set(upcoming.map((e) => e.id));
  const ids = new Set(rows.map((r) => r.person.id));
  const targets = attendances.filter((a) => ids.has(a.personId) && upcomingIds.has(a.eventId));
  const peopleWithRows = new Set(targets.map((a) => a.personId)).size;
  const without = rows.length - peopleWithRows;

  const submit = () => {
    if (!date || !targets.length) return;
    const before = targets.map((a) => [a.id, a.followUpDate] as const);
    bulkUpdateAttendances(
      targets.map((a) => a.id),
      { followUpDate: date },
    );
    toastWithUndo(
      `Follow-up set for ${people(peopleWithRows)} on ${shortDate(date)}`,
      () => before.forEach(([id, d]) => bulkUpdateAttendances([id], { followUpDate: d })),
      {
        description: without
          ? `${plural(without, "person is", "people are")} not on an upcoming event.`
          : undefined,
        undoneMessage: "Follow-up dates put back",
      },
    );
    setDate("");
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set a follow-up date</DialogTitle>
          <DialogDescription>
            Applies to each person's upcoming events.
            {without > 0 &&
              ` ${plural(without, "person isn't", "people aren't")} on an upcoming event, so they'll be skipped.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="bulk-followup">Follow up on</Label>
          <Input
            id="bulk-followup"
            type="date"
            min={localDate()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!date || targets.length === 0}>
            Set follow-up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
