import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Check,
  CircleCheck,
  MessageCircle,
  Settings2,
  ShoppingBag,
  Ticket,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { ActionRow, EmptyState, STAGE_LABEL, StageChip, type IconTone } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  effectiveBizClass,
  logContact,
  openLog,
  setContactSettings,
  useContactSettings,
} from "@/data";
import { plural, relativeDay, shortDate } from "./format";
import { countByFilter, type TodayFilter, type TodayItem } from "./today";

type Filter = "all" | TodayFilter;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "team", label: "Team" },
  { value: "customers", label: "Customers" },
  { value: "events", label: "Events" },
];

const ICON: Record<TodayItem["kind"], { icon: typeof Ticket; tone: IconTone }> = {
  ticket: { icon: Ticket, tone: "bad" },
  followup: { icon: Ticket, tone: "bad" },
  customer: { icon: ShoppingBag, tone: "warn" },
  anniversary: { icon: TrendingUp, tone: "info" },
  team: { icon: MessageCircle, tone: "primary" },
};

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
  const counts = countByFilter(items);
  const shown = filter === "all" ? items : items.filter((i) => i.filter === filter);
  const limit = compact ? 3 : 5;
  const visible = expanded ? shown : shown.slice(0, limit);
  const hidden = shown.length - visible.length;
  // Phones keep the header simple until the list is opened up.
  const showFilters = !candidate && items.length > 0 && (!compact || expanded);

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
          {compact && hidden > 0 && !expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-sm text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              See all {shown.length}
            </button>
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
              : "Check-ins, customer contacts, event follow-ups and IBO anniversaries show up here when they're due."
          }
        />
      ) : shown.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-muted-foreground">
          Nothing in {FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} right now.
        </p>
      ) : (
        <div>
          {visible.map((item) => (
            <TodayRow key={item.key} item={item} compact={compact} />
          ))}
        </div>
      )}

      {hidden > 0 && !compact && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-fit rounded-sm text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Show {hidden} more
        </button>
      )}
      {expanded && shown.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="w-fit rounded-sm text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Show fewer
        </button>
      )}
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

function checkIn(item: TodayItem) {
  logContact({ personId: item.person.id });
  toast.success(
    item.kind === "customer"
      ? `Contact with ${item.person.name} logged`
      : `Check-in with ${item.person.name} logged`,
  );
}

function TodayRow({ item, compact }: { item: TodayItem; compact: boolean }) {
  const { icon, tone } = ICON[item.kind];
  const p = item.person;
  const first = p.name.split(" ")[0];
  const stage = item.kind === "customer" ? "customer" : effectiveBizClass(p);
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
    case "team":
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

  return (
    <ActionRow
      icon={icon}
      iconTone={tone}
      title={title}
      link={
        (item.kind === "ticket" || item.kind === "followup") && item.self
          ? { to: "/events/$id", params: { id: item.event.id } }
          : { to: "/people/$id", params: { id: p.id } }
      }
      meta={
        compact ? (
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
