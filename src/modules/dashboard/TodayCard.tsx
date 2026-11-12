import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  CalendarClock,
  CalendarDays,
  Check,
  CircleCheck,
  MessageCircle,
  NotebookPen,
  Settings2,
  ShoppingBag,
  Ticket,
  TrendingUp,
  Undo2,
  UserPlus,
  UserX,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ActionRow, EmptyState, STAGE_LABEL, StageChip, type IconTone } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { quickCheckIn, toastWithUndo } from "@/components/log/quickLog";
import {
  bookingLabel,
  effectiveBizClass,
  removeContact,
  openLog,
  rescheduleBookedStep,
  rescheduleChoices,
  setContactSettings,
  useAttendancesForEvent,
  useCategoryOf,
  useContactSettings,
  useCurrentUser,
  useCustomerColumns,
  usePipelineColumns,
} from "@/data";
import { MissedNoteDialog } from "@/modules/events/MissedNoteDialog";
import { useMoveCard } from "@/modules/pipeline/useMoveCard";
import { useCustomerMove } from "@/modules/customers/useCustomerMove";
import { CancelStepDialog } from "@/modules/pipeline/CancelStepDialog";
import { timeText, whenText } from "@/modules/pipeline/format";
import { AddAttendeeDialog } from "@/modules/events/AddAttendeeDialog";
import { ReferralTodayRow } from "@/modules/pipeline/Referrals";
import { plural, relativeDay, shortDate } from "./format";
import { useInvitesOff } from "./hooks";
import {
  countByFilter,
  groupToday,
  type TodayFilter,
  type TodayGroup,
  type TodayItem,
  type TodaySub,
} from "./today";

type Filter = "all" | TodayFilter;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "team", label: "Team" },
  { value: "customers", label: "Customers" },
  { value: "pipeline", label: "Pipeline" },
  { value: "events", label: "Events" },
];

const GROUP_LABEL: Record<TodayFilter, string> = {
  team: "Team",
  customers: "Customers",
  pipeline: "Pipeline",
  events: "Events",
};
const SUB_LABEL: Record<TodaySub, string> = {
  recruiting: "Recruiting",
  customer: "Customer pipeline",
};

const ICON: Record<TodayItem["kind"], { icon: typeof Ticket; tone: IconTone }> = {
  ticket: { icon: Ticket, tone: "bad" },
  followup: { icon: Ticket, tone: "bad" },
  customer: { icon: ShoppingBag, tone: "warn" },
  anniversary: { icon: TrendingUp, tone: "info" },
  team: { icon: MessageCircle, tone: "primary" },
  prospect: { icon: MessageCircle, tone: "primary" },
  missed: { icon: UserX, tone: "warn" },
  step: { icon: CalendarClock, tone: "primary" },
  invite: { icon: UserPlus, tone: "info" },
  referral: { icon: Users, tone: "info" },
};

type StepItem = Extract<TodayItem, { kind: "step" }>;
type InviteItem = Extract<TodayItem, { kind: "invite" }>;

/**
 * The prioritised "Today" list. Desktop shows 5 rows and "Show N more";
 * phones show 3 and "See all". Filters and contact settings live in the header.
 */
export function TodayCard({
  items,
  compact,
  candidate,
}: {
  items: TodayItem[];
  compact: boolean;
  candidate: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);
  // Rows checked off here stay in place (as "Done · Undo") until the page is
  // left, so the next row never slides under the pointer mid double-click.
  const [done, setDone] = useState<Map<string, DoneEntry>>(() => new Map());
  const list = useMemo(() => {
    const out = items.filter((i) => !done.has(i.key));
    [...done.values()]
      .sort((a, b) => a.index - b.index)
      .forEach((d) => out.splice(Math.min(d.index, out.length), 0, d.item));
    return out;
  }, [items, done]);
  const forget = (key: string) =>
    setDone((m) => {
      if (!m.has(key)) return m;
      const next = new Map(m);
      next.delete(key);
      return next;
    });
  const checkIn = (item: TodayItem) => {
    const { contactId, toastId } = quickCheckIn(
      item.person.id,
      item.kind === "customer"
        ? `Contact with ${item.person.name} logged`
        : `Check-in with ${item.person.name} logged`,
      { onUndo: () => forget(item.key) },
    );
    const index = list.findIndex((i) => i.key === item.key);
    setDone((m) => new Map(m).set(item.key, { item, index, contactId, toastId, at: Date.now() }));
  };
  const undo = (d: DoneEntry) => {
    removeContact(d.contactId);
    toast.dismiss(d.toastId);
    forget(d.item.key);
  };
  // "Done" on a booked step moves the card into the booked column through the
  // boards' own movers (Registered and First sale ask first, the sale form
  // opens, the move is recorded and the toast can undo it).
  const user = useCurrentUser();
  const me = candidate ? undefined : user.personId;
  const recruiting = useMoveCard(usePipelineColumns(me));
  const customer = useCustomerMove(useCustomerColumns(me));
  const accept = (item: StepItem) => {
    const b = item.booking;
    if (b.board === "customer") customer.move(b.cardId, b.name, b.column.id);
    else recruiting.move(b.cardId, b.name, b.column.id);
  };

  const invites = useInvitesOff(user.personId);

  const counts = countByFilter(items.filter((i) => !done.has(i.key)));
  const shown = filter === "all" ? list : list.filter((i) => i.filter === filter);
  // "All" shows each group's most urgent few under its header; one group
  // shows its first few. "Show N more" opens everything up.
  const all = filter === "all";
  const perGroup = compact ? 2 : 3;
  const limit = compact ? 3 : 5;
  const groups: (TodayGroup & { total: number })[] = groupToday(shown).map((g) => {
    const take = expanded ? g.items.length : all ? perGroup : limit;
    const keep = new Set(g.items.slice(0, take).map((i) => i.key));
    return {
      ...g,
      total: g.items.length,
      items: g.items.filter((i) => keep.has(i.key)),
      subs: g.subs
        ?.map((s) => ({ ...s, items: s.items.filter((i) => keep.has(i.key)) }))
        .filter((s) => s.items.length > 0),
    };
  });
  const visibleCount = groups.reduce((n, g) => n + g.items.length, 0);
  const hidden = shown.length - visibleCount;
  // Group headers only when it helps: not for candidates (events only).
  const headers = !candidate;
  const showFilters = !candidate && items.length > 0;

  const row = (item: TodayItem) => {
    const d = done.get(item.key);
    return d ? (
      <DoneRow key={item.key} entry={d} compact={compact} onUndo={() => undo(d)} />
    ) : (
      <TodayRow
        key={item.key}
        item={item}
        compact={compact}
        onCheckIn={checkIn}
        onAccept={accept}
        onPutOff={invites.putOff}
      />
    );
  };

  return (
    <section
      className={cn(
        "grid min-w-0 content-start gap-3 border border-line bg-card text-card-foreground",
        compact ? "rounded-xl px-3 py-3" : "rounded-card px-4 py-4 sm:px-[18px]",
      )}
      aria-labelledby="today-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="today-heading" className={cn("font-bold", compact ? "text-[13px]" : "text-sm")}>
          Today
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {showFilters && !compact && (
            <FilterChips filter={filter} counts={counts} onChange={setFilter} />
          )}
          {!candidate && <ContactSettings />}
        </div>
      </div>
      {showFilters && compact && (
        <FilterChips filter={filter} counts={counts} onChange={setFilter} />
      )}

      {items.length === 0 ? (
        <EmptyState
          className="py-6"
          icon={<CircleCheck />}
          title="You're all caught up"
          body={
            candidate
              ? "Event follow-ups and ticket reminders show up here when they're due."
              : "Check-ins, customer contacts, booked pipeline steps, event follow-ups and IBO anniversaries show up here when they're due."
          }
        />
      ) : shown.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-muted-foreground">
          Nothing in {FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} right now.
        </p>
      ) : !headers ? (
        <div>{groups.flatMap((g) => g.items).map(row)}</div>
      ) : (
        <div className="grid gap-3.5">
          {groups.map((g) => (
            <section
              key={g.filter}
              aria-labelledby={`today-group-${g.filter}`}
              className="grid gap-1.5"
            >
              {all && (
                <div className="flex items-center justify-between gap-2">
                  <h3
                    id={`today-group-${g.filter}`}
                    className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
                  >
                    {GROUP_LABEL[g.filter]}{" "}
                    <span className="font-semibold tabular-nums text-faint">{g.total}</span>
                  </h3>
                  {g.total > g.items.length && (
                    <button
                      type="button"
                      onClick={() => setFilter(g.filter)}
                      className="rounded-sm text-[12px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      aria-label={`See all ${g.total} in ${GROUP_LABEL[g.filter]}`}
                    >
                      See all {g.total}
                    </button>
                  )}
                </div>
              )}
              {!all && (
                <h3 id={`today-group-${g.filter}`} className="sr-only">
                  {GROUP_LABEL[g.filter]}
                </h3>
              )}
              {g.subs ? (
                g.subs.map((s) => (
                  <div key={s.sub} className="grid gap-1">
                    <h4 className="flex items-center gap-1.5 text-[11.5px] font-semibold text-faint">
                      <span aria-hidden="true" className="h-px w-2.5 bg-line" />
                      {SUB_LABEL[s.sub]}
                    </h4>
                    <div>{s.items.map(row)}</div>
                  </div>
                ))
              ) : (
                <div>{g.items.map(row)}</div>
              )}
            </section>
          ))}
        </div>
      )}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-fit rounded-sm text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Show {hidden} more
        </button>
      )}
      {expanded && shown.length > (all ? perGroup : limit) && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="w-fit rounded-sm text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Show fewer
        </button>
      )}
      {recruiting.dialog}
      {customer.dialog}
    </section>
  );
}

function FilterChips({
  filter,
  counts,
  onChange,
}: {
  filter: Filter;
  counts: Record<Filter, number>;
  onChange: (f: Filter) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter the Today list">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          aria-pressed={filter === f.value}
          onClick={() => onChange(f.value)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11.5px] font-semibold leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            filter === f.value
              ? "border-foreground bg-foreground text-background"
              : "border-line text-muted-foreground hover:text-foreground",
          )}
        >
          {f.label} <span className="tabular-nums">{counts[f.value]}</span>
        </button>
      ))}
    </div>
  );
}

function ContactSettings() {
  const settings = useContactSettings();
  const field = (key: "teamDays" | "customerDays", label: string) => (
    <DaysField
      key={key}
      id={`today-${key}`}
      label={label}
      value={settings[key]}
      onCommit={(n) => setContactSettings({ [key]: n })}
    />
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label="Reminder settings"
          title="Reminder settings"
        >
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-72 gap-3">
        <div>
          <p className="text-sm font-bold">Remind me to get in touch</p>
          <p className="text-[12.5px] text-muted-foreground">
            People show up in Today when nobody has contacted them for this long.
          </p>
        </div>
        {field("teamDays", "Team members")}
        {field("customerDays", "Customers")}
      </PopoverContent>
    </Popover>
  );
}

/** Number input that keeps its own text while typing and saves whole numbers 1–365. */
function DaysField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_72px_auto] items-center gap-2">
      <Label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={365}
        className="h-8"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (Number.isInteger(n) && n >= 1 && n <= 365) onCommit(n);
        }}
        onBlur={() => setText(String(value))}
      />
      <span className="text-[12.5px] text-muted-foreground">days</span>
    </div>
  );
}

interface DoneEntry {
  item: TodayItem;
  /** Position in the list when it was checked off. */
  index: number;
  contactId: string;
  toastId: string | number;
  at: number;
}

/** Ignore an Undo that lands within this long of the check-in (a double-click). */
const UNDO_GUARD_MS = 700;

/** A row just checked off: stays put with an Undo until the page is left. */
function DoneRow({
  entry,
  compact,
  onUndo,
}: {
  entry: DoneEntry;
  compact: boolean;
  onUndo: () => void;
}) {
  const p = entry.item.person;
  const customer = entry.item.kind === "customer";
  return (
    <ActionRow
      icon={CircleCheck}
      iconTone="good"
      title={
        <span className="text-muted-foreground">
          {customer ? `Contact with ${p.name} logged` : `Checked in with ${p.name}`}
        </span>
      }
      link={{ to: "/people/$id", params: { id: p.id } }}
      meta={<span className="font-semibold text-good">Done · logged for today</span>}
      action={
        <Button
          size="sm"
          variant="ghost"
          autoFocus
          aria-label={`Undo ${customer ? "contact" : "check-in"} with ${p.name}`}
          onClick={() => {
            if (Date.now() - entry.at >= UNDO_GUARD_MS) onUndo();
          }}
        >
          <Undo2 /> Undo
        </Button>
      }
      className={cn(compact && "gap-2.5 py-[9px]")}
    />
  );
}

function TodayRow({
  item,
  compact,
  onCheckIn: checkIn,
  onAccept,
  onPutOff,
}: {
  item: TodayItem;
  compact: boolean;
  onCheckIn: (item: TodayItem) => void;
  onAccept: (item: StepItem) => void;
  /** "Not now" on an invite suggestion. */
  onPutOff: (eventId: string) => void;
}) {
  const { icon } = ICON[item.kind];
  let tone = ICON[item.kind].tone;
  const [noteOpen, setNoteOpen] = useState(false);
  const categoryOf = useCategoryOf();
  const [cancelOpen, setCancelOpen] = useState(false);
  const p = item.person;
  const first = p.name.split(" ")[0];
  const stage =
    item.kind === "customer" || (item.kind === "step" && item.filter === "customers")
      ? "customer"
      : effectiveBizClass(p);
  let title: ReactNode;
  let detail: string;
  let action: ReactNode;

  const quick = (label: string) =>
    compact ? (
      <Button
        size="icon"
        variant="soft"
        className="size-8"
        aria-label={`${label}: ${p.name}`}
        onClick={() => checkIn(item)}
      >
        <Check />
      </Button>
    ) : (
      <Button
        size="sm"
        variant="soft"
        onClick={() => checkIn(item)}
        aria-label={`${label}: ${p.name}`}
      >
        <Check /> {label}
      </Button>
    );

  switch (item.kind) {
    case "step": {
      const b = item.booking;
      const label = bookingLabel(b.column);
      const when =
        b.due === "today"
          ? `today${b.time ? ` ${timeText(b.time)}` : ""}`
          : `${plural(b.daysLate, "day")} overdue`;
      if (b.due === "overdue") tone = "warn";
      title = compact ? `${p.name} — ${label}` : `${p.name} — ${label} (${when})`;
      detail = compact
        ? when
        : `${b.board === "customer" ? "Customer pipeline" : "Recruiting pipeline"} · moves to ${b.column.label}`;
      action = (
        <span className="flex items-center gap-1.5">
          {compact ? (
            <Button
              size="icon"
              variant="soft"
              className="size-8"
              aria-label={`Done: move ${p.name} to ${b.column.label}`}
              onClick={() => onAccept(item)}
            >
              <Check />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="soft"
              aria-label={`Done: move ${p.name} to ${b.column.label}`}
              onClick={() => onAccept(item)}
            >
              <Check /> Done
            </Button>
          )}
          <Reschedule item={item} label={label} />
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            aria-label={`Cancel ${label} with ${p.name}`}
            title="Cancel"
            onClick={() => setCancelOpen(true)}
          >
            <X />
          </Button>
          <CancelStepDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            board={b.board}
            cardId={b.cardId}
            name={p.name}
            stepLabel={label}
          />
        </span>
      );
      break;
    }
    case "ticket":
      title = item.self
        ? `Buy your ticket for ${item.event.name}`
        : compact
          ? `${p.name} needs a ticket`
          : `${p.name} hasn't bought a ticket`;
      detail = compact
        ? `Planned by ${shortDate(item.dueDate)}`
        : `Planned to buy by ${shortDate(item.dueDate)} · ${item.event.name}`;
      break;
    case "followup": {
      const buying = item.dueDate === item.attendance.plannedPurchaseDate;
      title = item.self
        ? buying
          ? `Buy your ticket for ${item.event.name}`
          : `Decide on ${item.event.name}`
        : compact
          ? p.name
          : `Follow up with ${p.name}`;
      const when = relativeDay(item.dueDate);
      detail = buying
        ? `${item.self ? "You plan" : "Plans"} to buy ${when}`
        : `Follow-up due ${when}`;
      if (!compact) detail += ` · ${item.event.name}`;
      break;
    }
    case "customer":
      title = compact
        ? p.name
        : item.never
          ? `${p.name}, never contacted`
          : `${p.name}, ${plural(item.days ?? 0, "day")} since contact`;
      detail = compact
        ? item.never
          ? "Never contacted"
          : plural(item.days ?? 0, "day")
        : item.lastSale
          ? `Last bought ${item.lastSale.product} · ${shortDate(item.lastSale.date)}`
          : "No purchases logged";
      action = quick("Log contact");
      break;
    case "anniversary":
      title =
        item.level === "due"
          ? item.self
            ? "Your apprentice year is complete"
            : `${p.name} has completed the apprentice year`
          : `${item.self ? "You become" : `${compact ? first : p.name} becomes`} an IBO on ${shortDate(item.date)}`;
      detail = item.level === "due" ? "Now an IBO" : `${plural(item.daysLeft, "day")} left`;
      if (!compact) {
        detail += item.numbersOnFile ? " · IBO# and LTD# on file" : " · IBO# or LTD# missing";
      }
      break;
    case "invite":
      return <InviteRow item={item} compact={compact} onPutOff={onPutOff} />;
    case "referral":
      return <ReferralTodayRow item={item} compact={compact} />;
    case "team":
    case "prospect":
      title = compact ? p.name : `Check in with ${p.name}`;
      detail = item.never
        ? item.days !== null
          ? `Never contacted · joined ${plural(item.days, "day")} ago`
          : "Never contacted"
        : compact
          ? plural(item.days ?? 0, "day")
          : `Last contact ${plural(item.days ?? 0, "day")} ago · your goal is ${item.threshold}`;
      action = quick("Check in");
      break;
    case "missed": {
      const { latest, lastAttended, missed } = item.streak;
      title = compact ? p.name : `${p.name} missed ${latest.name}`;
      detail = compact
        ? `Missed ${categoryOf(latest).name} ${shortDate(latest.date)}`
        : `${categoryOf(latest).name} ${shortDate(latest.date)} · ${
            missed.length > 1
              ? `missed the last ${missed.length}`
              : `came ${shortDate(lastAttended.date)}`
          }`;
      action = (
        <span className="flex items-center gap-1.5">
          {quick("Check in")}
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            aria-label={`Already handled: note about ${p.name}`}
            title="Already handled"
            onClick={() => setNoteOpen(true)}
          >
            <NotebookPen />
          </Button>
          <MissedNoteDialog
            open={noteOpen}
            onOpenChange={setNoteOpen}
            personId={p.id}
            personName={p.name}
            eventId={latest.id}
            eventName={latest.name}
          />
        </span>
      );
      break;
    }
  }

  if (item.kind === "ticket" || item.kind === "followup") {
    action = item.self ? (
      <Button asChild size="sm" variant="outline">
        <Link to="/events/$id" params={{ id: item.event.id }}>
          Open event
        </Link>
      </Button>
    ) : (
      <Button
        size="sm"
        variant="outline"
        onClick={() => openLog({ tab: "checkin", personId: p.id })}
        aria-label={`Follow up with ${p.name}`}
      >
        Follow up
      </Button>
    );
  }
  if (item.kind === "anniversary") {
    action = (
      <Button asChild size="sm" variant="outline">
        <Link to="/people/$id" params={{ id: p.id }} aria-label={`Plan ${p.name}'s IBO move`}>
          Plan it
        </Link>
      </Button>
    );
  }

  const boardRow = item.kind === "step" && item.booking.board === "customer";
  return (
    <ActionRow
      icon={icon}
      iconTone={tone}
      title={title}
      link={
        (item.kind === "ticket" || item.kind === "followup") && item.self
          ? { to: "/events/$id", params: { id: item.event.id } }
          : boardRow
            ? { to: "/customers" }
            : { to: "/people/$id", params: { id: p.id } }
      }
      meta={
        boardRow ? (
          <span>{compact ? `On your list · ${detail}` : detail}</span>
        ) : compact ? (
          <span>
            {STAGE_LABEL[stage]} · {detail}
          </span>
        ) : (
          <>
            <StageChip stage={stage} />
            <span>{detail}</span>
          </>
        )
      }
      action={action}
      className={cn(compact && "gap-2.5 py-[9px]")}
    />
  );
}

/** "Reschedule" a booked step: tomorrow, next week, or a day of your choice. */
function Reschedule({ item, label }: { item: StepItem; label: string }) {
  const b = item.booking;
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const move = (date: string) => {
    const r = rescheduleBookedStep(b.board, b.cardId, date);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setOpen(false);
    toastWithUndo(`${label} with ${b.name} moved to ${whenText(date, b.time)}`, r.undo, {
      undoneMessage: "Back on the old day",
    });
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          className="size-8"
          aria-label={`Reschedule ${label} with ${b.name}`}
          title="Reschedule"
        >
          <CalendarDays />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-64 gap-2.5">
        <p className="text-sm font-bold">Move {label} to…</p>
        <div className="grid grid-cols-2 gap-2">
          {rescheduleChoices().map((c) => (
            <Button key={c.label} size="sm" variant="soft" onClick={() => move(c.date)}>
              {c.label}
            </Button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (day) move(day);
          }}
        >
          <div className="grid min-w-0 flex-1 gap-1">
            <Label htmlFor={`resched-${b.board}-${b.cardId}`} className="text-[12px]">
              Another day
            </Label>
            <Input
              id={`resched-${b.board}-${b.cardId}`}
              type="date"
              className="h-8 min-w-0"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={!day}>
            Move
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Invite your customers" to an upcoming event whose category welcomes them
 * (at first the monthly meeting, info sessions and trainings): Invite opens
 * the event's add-attendee dialog with just your customers; "Not now" puts it
 * off for that event.
 */
function InviteRow({
  item,
  compact,
  onPutOff,
}: {
  item: InviteItem;
  compact: boolean;
  onPutOff: (eventId: string) => void;
}) {
  const { event, customers } = item;
  const rows = useAttendancesForEvent(event.id);
  const category = useCategoryOf()(event);
  const listed = useMemo(() => rows.map((a) => a.personId), [rows]);
  const n = customers.length;
  const who =
    n === 1 ? customers[0].name : n === 2 ? `${customers[0].name} and ${customers[1].name}` : null;
  const when = relativeDay(event.date);
  return (
    <ActionRow
      icon={UserPlus}
      iconTone="info"
      title={
        compact ? `Invite customers to ${event.name}` : `Invite your customers to ${event.name}`
      }
      link={{ to: "/events/$id", params: { id: event.id } }}
      meta={
        <span>
          {compact
            ? `${plural(n, "customer")} not on the list · ${when}`
            : `${who ?? plural(n, "customer")} ${n === 1 ? "isn't" : "aren't"} on the list yet · ${category.name} ${when}`}
        </span>
      }
      action={
        <span className="flex items-center gap-1.5">
          <AddAttendeeDialog eventId={event.id} existingPersonIds={listed} customersOnly>
            {(open) =>
              compact ? (
                <Button
                  size="icon"
                  variant="soft"
                  className="size-8"
                  aria-label={`Invite customers to ${event.name}`}
                  onClick={open}
                >
                  <UserPlus />
                </Button>
              ) : (
                <Button size="sm" variant="soft" onClick={open}>
                  <UserPlus /> Invite
                </Button>
              )
            }
          </AddAttendeeDialog>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            aria-label={`Not now: inviting customers to ${event.name}`}
            title="Not now"
            onClick={() => onPutOff(event.id)}
          >
            <X />
          </Button>
        </span>
      }
      className={cn(compact && "gap-2.5 py-[9px]")}
    />
  );
}
