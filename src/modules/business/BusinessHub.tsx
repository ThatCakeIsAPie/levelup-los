import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  CalendarDays,
  ChevronRight,
  Contact,
  Kanban,
  Megaphone,
  Network,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  PageHeader,
  SegmentedBar,
  STAGE_LABEL,
  STAGE_SOLID_CLASS,
  ToneChip,
  type LinkTarget,
} from "@/components/brand";
import { cn } from "@/lib/utils";
import { LibraryTile } from "@/modules/library/HomeCards";
import {
  effectiveBizClass,
  parseDate,
  useAttendancesForPerson,
  useCurrentUser,
  useMe,
  usePipelineSummary,
  useUnlocks,
  type CrmEvent,
} from "@/data";
import {
  STAGES,
  daysUntil,
  iboInDays,
  useCampaignSummary,
  useCustomerSummary,
  useFeaturedEvent,
  usePeopleAttentionCount,
  useTeamSummary,
  useTicketSummary,
  useWalletSummary,
} from "./summary";

const PAGE =
  "mx-auto grid w-full max-w-5xl content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]";

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** "$200" for whole amounts, "$66.67" otherwise. */
const money = (n: number) => (Number.isInteger(n) ? usd0 : usd2).format(n);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The "My business" hub (phone tab + desktop page): one live tile per area,
 * each showing a number or the next thing to do and linking to its page.
 * Tiles follow what the person has unlocked (src/data/unlocks.ts): a new
 * apprentice gets customers, events and wallet; candidates their path, their
 * event status and their wallet.
 */
export function BusinessHub() {
  const user = useCurrentUser();
  const { can } = useUnlocks();
  const candidate = user.role === "candidate";
  return (
    <div className={PAGE}>
      <PageHeader
        title="My business"
        subtitle={
          candidate
            ? "Your path, your next event and what you owe"
            : "Your team, customers and events at a glance"
        }
      />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 lg:gap-3.5">
        {can.pipeline && <PipelineTile />}
        {candidate ? <PathTile /> : can.team && <TeamTile />}
        {!candidate && can.people && <PeopleTile />}
        {can.customers && <CustomersTile />}
        {/* Without event planning, the tile is about your own plans. */}
        <EventTile candidate={candidate || !can.eventPlanning} viewerId={user.personId} />
        <WalletTile wide={candidate} />
        {can.campaigns && <CampaignsTile />}
        {can.library && <LibraryTile />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tile frame
// ---------------------------------------------------------------------------

const ICON_TONE = {
  pipeline: "bg-info-soft text-info-ink",
  team: "bg-stage-ibo text-stage-ibo-fg",
  people: "bg-primary-soft text-primary-ink",
  customers: "bg-stage-customer-soft text-stage-customer-ink",
  event: "bg-white/12 text-event-fg",
  wallet: "bg-info-soft text-info-ink",
  campaigns: "bg-surface-2 text-muted-foreground",
} as const;

function Tile({
  link,
  icon: Icon,
  tone,
  title,
  wide,
  event,
  children,
}: {
  link: LinkTarget;
  icon: LucideIcon;
  tone: keyof typeof ICON_TONE;
  title: string;
  /** Full width on phones (two columns); one column on desktop. */
  wide?: boolean;
  /** Navy event styling. */
  event?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={link.to}
      params={link.params}
      className={cn(
        "group grid min-w-0 content-start gap-2 rounded-xl border px-3 py-[11px] transition-colors lg:gap-2.5 lg:rounded-card lg:px-4 lg:py-3.5",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        event
          ? "border-transparent bg-event text-event-fg hover:brightness-110"
          : "border-line bg-surface hover:border-primary/40 hover:bg-surface-2/40",
        wide && "col-span-2 lg:col-span-1",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-lg lg:size-8",
            ICON_TONE[tone],
          )}
        >
          <Icon className="size-[15px] lg:size-4" aria-hidden="true" />
        </span>
        <b className="text-[12.5px] lg:text-[13.5px]">{title}</b>
        <ChevronRight
          className={cn(
            "ml-auto size-[15px] transition-transform group-hover:translate-x-0.5",
            event ? "text-event-muted" : "text-faint",
          )}
          aria-hidden="true"
        />
      </span>
      {children}
    </Link>
  );
}

/** Big number with an optional muted note beside it. */
function Value({ value, note, event }: { value: ReactNode; note?: ReactNode; event?: boolean }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-[22px] font-extrabold leading-tight tabular-nums lg:text-[26px]">
        {value}
      </span>
      {note && (
        <span className={cn("text-xs", event ? "text-event-muted" : "text-muted-foreground")}>
          {note}
        </span>
      )}
    </span>
  );
}

const Meta = ({ children, event }: { children: ReactNode; event?: boolean }) => (
  <span className={cn("text-[11.5px]", event ? "text-event-muted" : "text-muted-foreground")}>
    {children}
  </span>
);

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

const PIPE_BANDS = [
  { key: "contact", label: "Contact" },
  { key: "first_meeting", label: "First meeting" },
  { key: "first_plan", label: "First plan" },
  { key: "registered", label: "Registered" },
] as const;

/** This month's first meetings against the team goal, and where everyone sits. */
function PipelineTile() {
  const p = usePipelineSummary();
  if (!p) return null;
  const total = PIPE_BANDS.reduce((s, b) => s + p.bands[b.key], 0);
  return (
    <Tile link={{ to: "/pipeline" }} icon={Kanban} tone="pipeline" title="Pipeline" wide>
      <Value
        value={p.mg1}
        note={`first ${p.mg1 === 1 ? "meeting" : "meetings"} this month${p.goal ? ` · goal ${p.goal}` : ""}`}
      />
      {total === 0 ? (
        <Meta>Add the people you invite to see them move from contact to registered.</Meta>
      ) : (
        <>
          <span className="flex h-5 gap-[3px]" aria-hidden="true">
            {PIPE_BANDS.map((b) => (
              <span
                key={b.key}
                className={cn(
                  "grid min-w-[22px] place-items-center rounded-[4px] text-[10px] font-extrabold tabular-nums",
                  b.key === "first_meeting"
                    ? "bg-sky text-on-sky"
                    : "bg-surface-2 text-muted-foreground",
                )}
                style={{ flex: Math.max(p.bands[b.key], 1) }}
              >
                {p.bands[b.key]}
              </span>
            ))}
          </span>
          <span className="text-[11px] text-muted-foreground">
            <span className="sr-only">
              {PIPE_BANDS.map((b) => `${b.label} ${p.bands[b.key]}`).join(", ")}.{" "}
            </span>
            <span aria-hidden="true">{PIPE_BANDS.map((b) => b.label).join(" · ")}</span>
          </span>
        </>
      )}
    </Tile>
  );
}

function TeamTile() {
  const t = useTeamSummary();
  return (
    <Tile link={{ to: "/mindmap" }} icon={Network} tone="team" title="Team" wide>
      <Value
        value={t.count}
        note={
          t.count === 0
            ? "people on your team"
            : `${t.count === 1 ? "person" : "people"} · ${
                t.fresh > 0 ? `+${t.fresh}` : "none"
              } new in 30 days`
        }
      />
      {t.count === 0 ? (
        <Meta>People you sponsor show up here with their stage. Open the map to add them.</Meta>
      ) : (
        <>
          <SegmentedBar
            height={7}
            segments={STAGES.map((s) => ({
              value: t.mix[s],
              className: STAGE_SOLID_CLASS[s],
              label: STAGE_LABEL[s],
            }))}
          />
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
            {STAGES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span
                  className={cn("size-2 rounded-full", STAGE_SOLID_CLASS[s])}
                  aria-hidden="true"
                />
                <b className="font-semibold text-foreground tabular-nums">{t.mix[s]}</b>
                {STAGE_LABEL[s]}
              </span>
            ))}
          </span>
        </>
      )}
    </Tile>
  );
}

const PATH_STEPS = [
  { stage: "prospect", label: "Prospect" },
  { stage: "apprentice", label: "Apprentice" },
  { stage: "ibo", label: "IBO" },
] as const;

/** Candidates: Prospect → Apprentice → IBO with the current step marked. */
function PathTile() {
  const me = useMe();
  const stage = me ? effectiveBizClass(me) : "prospect";
  const current = Math.max(
    0,
    PATH_STEPS.findIndex((s) => s.stage === stage),
  );
  const iboDays = stage === "apprentice" ? iboInDays(me?.businessStartDate) : undefined;
  return (
    <Tile link={{ to: "/mindmap" }} icon={Network} tone="team" title="Your path" wide>
      <ol className="grid grid-cols-3 gap-1.5" aria-label="Business path">
        {PATH_STEPS.map((s, i) => (
          <li
            key={s.stage}
            className="grid gap-1"
            aria-current={i === current ? "step" : undefined}
          >
            <span
              className={cn("h-[7px] rounded-full", i <= current ? "bg-primary" : "bg-track")}
              aria-hidden="true"
            />
            <span
              className={cn(
                "text-[11.5px]",
                i === current ? "font-bold text-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
              {i === current && <span className="sr-only"> (you are here)</span>}
            </span>
          </li>
        ))}
      </ol>
      <Meta>
        {stage === "prospect"
          ? "Register your business to become an apprentice, then an IBO one year later."
          : stage === "apprentice"
            ? iboDays !== undefined && iboDays > 0
              ? `You become an IBO in ${plural(iboDays, "day")}.`
              : "You become an IBO one year after your business start date."
            : "You're an IBO. Your team will show up here."}
      </Meta>
    </Tile>
  );
}

function PeopleTile() {
  const n = usePeopleAttentionCount();
  return (
    <Tile link={{ to: "/people" }} icon={Users} tone="people" title="People">
      <Value value={n} />
      {n > 0 ? (
        <ToneChip tone="warn" className="justify-self-start">
          {n === 1 ? "needs attention" : "need attention"}
        </ToneChip>
      ) : (
        <ToneChip tone="good" className="justify-self-start">
          All caught up
        </ToneChip>
      )}
    </Tile>
  );
}

function CustomersTile() {
  const c = useCustomerSummary();
  return (
    <Tile link={{ to: "/customers" }} icon={Contact} tone="customers" title="Customers">
      <Value value={c.count} note={c.count > 0 ? `${money(c.volume)}/mo` : undefined} />
      {c.count === 0 ? (
        <Meta>No customers yet</Meta>
      ) : c.due > 0 ? (
        <ToneChip tone="warn" className="justify-self-start">
          {c.due} due for contact
        </ToneChip>
      ) : (
        <ToneChip tone="good" className="justify-self-start">
          All contacted
        </ToneChip>
      )}
    </Tile>
  );
}

function when(e: CrmEvent): string {
  const n = daysUntil(e.date);
  if (n <= 0) return "happening now";
  if (n === 1) return "tomorrow";
  return `in ${n} days`;
}

function EventTile({ candidate, viewerId }: { candidate: boolean; viewerId: string }) {
  const event = useFeaturedEvent();
  const s = useTicketSummary(event);
  const mine = useAttendancesForPerson(viewerId);
  const link: LinkTarget = { to: "/events" };

  if (!event) {
    return (
      <Tile link={link} icon={CalendarDays} tone="event" title="Events" wide event>
        <span className="text-[13.5px] font-bold">No upcoming events</span>
        <Meta event>
          {candidate
            ? "Your sponsor will invite you to the next meeting."
            : "Add your next meeting or conference to see the countdown and tickets here."}
        </Meta>
      </Tile>
    );
  }

  const header = (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="min-w-0 text-[13.5px] font-bold lg:text-[14.5px]">{event.name}</span>
      <span className="text-[11.5px] text-event-muted">
        {when(event)} · {format(parseDate(event.date), "MMM d")}
      </span>
    </span>
  );

  if (candidate) {
    const row = mine.find((a) => a.eventId === event.id);
    const status = !row
      ? "You're not on the list yet"
      : row.hasTicket
        ? "You have a ticket"
        : row.desireToAttend === "no"
          ? "You said you're not going"
          : "No ticket yet";
    return (
      <Tile link={link} icon={CalendarDays} tone="event" title="Events" wide event>
        {header}
        <Meta event>{status}</Meta>
      </Tile>
    );
  }

  return (
    <Tile link={link} icon={CalendarDays} tone="event" title="Events" wide event>
      {header}
      {s.invited === 0 ? (
        <Meta event>No one from your team is on the list yet</Meta>
      ) : (
        <>
          <SegmentedBar
            height={7}
            total={Math.max(1, s.invited)}
            className="bg-white/15"
            segments={[
              { value: s.bought, className: "bg-sky", label: "Tickets bought" },
              { value: s.plannedThisWeek, className: "bg-amber", label: "Plan to buy this week" },
            ]}
          />
          <Meta event>
            {s.bought} of {s.invited} tickets
            {s.needTicket > 0 && (
              <>
                {" · "}
                <b className="font-semibold text-event-fg">{s.needTicket} need a ticket</b>
              </>
            )}
          </Meta>
        </>
      )}
    </Tile>
  );
}

function WalletTile({ wide }: { wide?: boolean }) {
  const w = useWalletSummary();
  const none = w.owedCount + w.paidCount === 0;
  return (
    <Tile link={{ to: "/wallet" }} icon={Wallet} tone="wallet" title="Wallet" wide={wide}>
      <Value value={money(w.owed)} />
      <Meta>
        {none
          ? "Nothing owed yet"
          : w.owedCount > 0
            ? `you owe · ${plural(w.owedCount, "invoice")}`
            : "you're all paid up"}
        {w.paid > 0 && ` · ${money(w.paid)} paid`}
      </Meta>
    </Tile>
  );
}

function CampaignsTile() {
  const c = useCampaignSummary();
  const next = c.next ? parseDate(c.next) : undefined;
  const soon = !!c.next && daysUntil(c.next.slice(0, 10)) < 7;
  return (
    <Tile link={{ to: "/campaigns" }} icon={Megaphone} tone="campaigns" title="Campaigns">
      <Value value={c.count} />
      <Meta>
        {c.count === 0
          ? "Nothing scheduled"
          : next
            ? `next scheduled for ${format(next, soon ? "EEEE" : "MMM d")}`
            : "pending send"}
      </Meta>
    </Tile>
  );
}
