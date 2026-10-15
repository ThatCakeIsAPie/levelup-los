import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { format } from "date-fns";
import { Check, Flag, History, PencilLine, ShoppingBag } from "lucide-react";
import {
  addMonths,
  growthMilestone,
  parseDate,
  openLog,
  useCanCoach,
  useChatPeople,
  useCurrentUser,
  useGrowthPath,
  type CrmPerson,
  type GrowthPath,
  type MilestoneStatus,
} from "@/data";
import { SectionCard, ToneChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApprenticeNotice, BusinessPathCard } from "@/modules/people/BusinessPath";
import { firstName } from "@/modules/people/format";
import { CoachSheet, type CoachTarget } from "./CoachSheet";
import {
  countTarget,
  duration,
  isMonthly,
  isPersonalPv,
  monthName,
  monthYear,
  monthlyTarget,
  pv,
  reachedLong,
  reachedShort,
} from "./format";

/** Width of one milestone on the path (px). */
const ITEM = 92;

/**
 * The person profile's path card: the growth path for apprentices and IBOs
 * (your own: what you hold and your next milestone; a downline's: their
 * whole path, with the upline's actions), the stage stepper for prospects.
 * Each milestone is held now (checked), earned before but not held now
 * (hollow with a history badge: "First hit Mar 2026"), or never reached.
 */
export function ProfilePathCard({
  person,
  canEdit,
  compact,
}: {
  person: CrmPerson;
  canEdit: boolean;
  compact?: boolean;
}) {
  const path = useGrowthPath(person.id);
  if (!path?.registered)
    return <BusinessPathCard person={person} canEdit={canEdit} compact={compact} />;
  return <GrowthPathCard person={person} path={path} canEdit={canEdit} compact={compact} />;
}

function GrowthPathCard({
  person,
  path,
  canEdit,
  compact,
}: {
  person: CrmPerson;
  path: GrowthPath;
  canEdit: boolean;
  compact?: boolean;
}) {
  const me = useCurrentUser();
  const own = me.personId === person.id;
  const coach = useCanCoach(person.id);
  const last = path.milestones.length - 1;
  const [selected, setSelected] = useState(path.nextIndex === -1 ? last : path.nextIndex);
  // The sheet keeps its last target while it animates closed.
  const [sheet, setSheet] = useState<{ target: CoachTarget; open: boolean; n: number } | null>(
    null,
  );
  const openSheet = (target: CoachTarget) =>
    setSheet((s) => ({ target, open: true, n: (s?.n ?? 0) + 1 }));
  const name = firstName(person.name);
  const status = path.milestones[selected];
  const panelId = useId();
  // The next goal after this one: the first later milestone not held now.
  const later = path.nextIndex === -1 ? [] : path.milestones.slice(path.nextIndex + 1);
  const afterAt = later.findIndex((m) => !m.held);
  const after = afterAt === -1 ? null : later[afterAt];
  const heldBetween = afterAt === -1 ? [] : later.slice(0, afterAt);

  return (
    <SectionCard
      title={own ? "Your growth path" : `${name}'s growth path`}
      action={
        coach ? (
          <Button size="sm" variant="soft" onClick={() => openSheet({ tab: "pv" })}>
            <PencilLine /> Update
          </Button>
        ) : (
          <span className="font-normal text-muted-foreground">
            {pv(path.thisMonth.pv)} PV this month
          </span>
        )
      }
    >
      <PathRow
        path={path}
        selected={selected}
        onSelect={setSelected}
        quietAfterNext={own}
        panelId={panelId}
      />
      <MilestoneDetail
        id={panelId}
        path={path}
        status={status}
        own={own}
        coach={coach}
        name={name}
        onCoach={openSheet}
      />
      {status.heldVia !== "last_month" && <KeepUpNote path={path} own={own} name={name} />}
      {own && path.next && status.code === path.next.code && after && (
        <p className="text-[12px] text-muted-foreground">
          After {path.next.label} comes {after.label}
          {heldBetween.length > 0 &&
            ` (you hold ${heldBetween.map((m) => m.label).join(" and ")} already)`}
          .
        </p>
      )}
      <ApprenticeNotice person={person} canEdit={canEdit} compact={compact} />
      {coach && (
        <CoachSheet
          person={person}
          path={path}
          target={sheet?.target ?? null}
          open={!!sheet?.open}
          formKey={sheet?.n ?? 0}
          onOpenChange={(open) => !open && setSheet((s) => (s ? { ...s, open: false } : s))}
        />
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// The row of dots
// ---------------------------------------------------------------------------

/**
 * One dot per milestone on a line filled up to the one being worked on. Only
 * this row scrolls sideways; the selected dot is kept in view. The dots are
 * tabs: arrow keys, Home and End move between them.
 */
export function PathRow({
  path,
  selected,
  onSelect,
  quietAfterNext,
  panelId,
}: {
  path: GrowthPath;
  selected: number;
  onSelect: (i: number) => void;
  /** Your own path: milestones after the next one are toned down. */
  quietAfterNext?: boolean;
  panelId: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const first = useRef(true);
  const selectedRef = useRef(selected);
  const n = path.milestones.length;
  const fill = path.nextIndex === -1 ? n - 1 : path.nextIndex;

  // Keep the selected dot in view (centred), without moving the page.
  const center = useCallback((smooth: boolean) => {
    const box = scroller.current;
    const el = buttons.current[selectedRef.current];
    if (!box || !el) return;
    const left = el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2;
    box.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
  }, []);
  useLayoutEffect(() => {
    selectedRef.current = selected;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    center(!first.current && !reduce);
    first.current = false;
  }, [selected, center]);
  // Once more after opening: the router restores scroll positions after the
  // first render and would put the row back where it was on the last visit.
  useEffect(() => {
    const t = setTimeout(() => center(false), 80);
    return () => clearTimeout(t);
  }, [center]);

  const move = (i: number) => {
    const next = Math.max(0, Math.min(n - 1, i));
    onSelect(next);
    buttons.current[next]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowRight: selected + 1,
      ArrowLeft: selected - 1,
      Home: 0,
      End: n - 1,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    move(keys[e.key]);
  };

  return (
    <div
      ref={scroller}
      className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-[18px] sm:px-[18px] [&::-webkit-scrollbar]:hidden"
    >
      <div
        role="tablist"
        aria-label="Growth path milestones"
        aria-orientation="horizontal"
        className="relative flex w-max pt-1"
        onKeyDown={onKeyDown}
      >
        <span
          aria-hidden="true"
          className="absolute top-[17px] h-[3px] rounded-full bg-track"
          style={{ left: ITEM / 2, width: (n - 1) * ITEM }}
        />
        <span
          aria-hidden="true"
          className="absolute top-[17px] h-[3px] rounded-full bg-primary transition-[width] duration-500"
          style={{ left: ITEM / 2, width: fill * ITEM }}
        />
        {path.milestones.map((m, i) => {
          const held = m.held;
          const before = m.state === "lost";
          const isNext = i === path.nextIndex;
          const quiet = quietAfterNext && !held && path.nextIndex !== -1 && i > path.nextIndex;
          const on = i === selected;
          const status = held
            ? m.hold === "permanent"
              ? `reached ${reachedShort(m.firstReachedOn!)}`
              : "held now"
            : before
              ? `${isNext ? "next milestone, " : ""}first hit ${reachedShort(m.firstReachedOn!)}, not held now`
              : isNext
                ? "next milestone"
                : "not reached yet";
          return (
            <button
              key={m.code}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${panelId}-tab-${i}`}
              aria-selected={on}
              aria-controls={panelId}
              aria-label={`${m.label}, ${status}`}
              tabIndex={on ? 0 : -1}
              onClick={() => onSelect(i)}
              className="group relative grid flex-none content-start justify-items-center gap-1 rounded-lg px-1 pb-2.5 text-center focus-visible:outline-2 focus-visible:outline-ring"
              style={{ width: ITEM }}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-[1] grid size-[27px] place-items-center rounded-full border-[3px] transition-transform group-hover:scale-110",
                  held && "border-primary bg-primary text-primary-foreground",
                  isNext && "border-primary bg-card shadow-[0_0_0_4px_var(--color-primary-soft)]",
                  !held && !isNext && "border-track bg-card",
                  quiet && "border-dashed",
                )}
              >
                {held ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : isNext ? (
                  <span className="size-2 rounded-full bg-primary" />
                ) : null}
                {before && (
                  <span className="absolute -top-1.5 -right-1.5 grid size-[15px] place-items-center rounded-full border-2 border-card bg-muted-foreground text-card">
                    <History className="size-2" strokeWidth={3} />
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "text-[11.5px] leading-tight font-semibold",
                  quiet ? "text-faint" : "text-foreground",
                  on && "font-extrabold",
                )}
              >
                {m.label}
              </span>
              <span className="text-[10.5px] leading-tight text-muted-foreground">
                {held
                  ? reachedShort(m.firstReachedOn!)
                  : before
                    ? isNext
                      ? "Earn again"
                      : `Hit ${monthYear(m.firstReachedOn!)}`
                    : isNext
                      ? "Next"
                      : " "}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "absolute bottom-0 h-[3px] w-7 rounded-full",
                  on ? "bg-primary" : "bg-transparent",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details of the selected milestone
// ---------------------------------------------------------------------------

/**
 * "This month's PV was set by an upline": logged sales then don't change it,
 * so say so wherever this month's numbers show.
 */
export function OverrideNote({ path, own }: { path: GrowthPath; own: boolean }) {
  const people = useChatPeople();
  const me = useCurrentUser();
  const o = path.thisMonth.override;
  if (!o) return null;
  const who =
    o.setBy === me.personId ? "you" : ((o.setBy && people.get(o.setBy)?.name) ?? "an upline");
  return (
    <p className="text-[12px] text-muted-foreground">
      {own ? "Your" : "This"} PV for {monthName(path.thisMonth.month)} ({pv(o.pv)}) was set by {who}{" "}
      from the Amway app; sales logged this month don't change it.
    </p>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-track", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <span className="block h-full rounded-full bg-sky" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** "95 / 150" rows with bars for each number toward a milestone. */
export function ProgressParts({ status }: { status: MilestoneStatus }) {
  const p = status.progress;
  if (!p) return null;
  return (
    <div className="grid gap-2">
      {p.parts.map((part) => (
        <div key={part.key} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="text-muted-foreground">{part.label}</span>
            <b className="tabular-nums">
              {pv(Math.min(part.current, part.target))} / {pv(part.target)}
            </b>
          </div>
          <ProgressBar value={part.target ? part.current / part.target : 0} />
        </div>
      ))}
    </div>
  );
}

/** "October 31". */
const dayLong = (date: string): string => format(parseDate(date), "MMMM d");

/** This month's numbers toward a monthly milestone: "6,883 so far", "1/3 legs, 2,100 so far". */
function soFar(status: MilestoneStatus): string {
  const parts = status.progress?.parts ?? [];
  const legs = parts.find((p) => p.key === "legs");
  const total = parts.find((p) => p.key !== "legs");
  const bits = [
    legs && `${Math.min(legs.current, legs.target)}/${legs.target} legs`,
    total && `${pv(total.current)} so far`,
  ].filter(Boolean);
  return bits.join(", ");
}

/**
 * Monthly milestones held only through last month: a gentle heads-up to meet
 * them again this month ("Ruby: hit 15,000 group PV again this month to keep
 * it"), highest first. Your own path, a downline's path and the Home card.
 */
export function KeepUpNote({
  path,
  own,
  name,
  className,
}: {
  path: GrowthPath;
  own: boolean;
  name: string;
  className?: string;
}) {
  const items = [...path.keepUp].reverse();
  if (!items.length) return null;
  const last = monthName(addMonths(path.thisMonth.month, -1));
  const until = items[0].heldUntil;
  return (
    <div
      role="note"
      className={cn(
        "grid gap-1 rounded-xl bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-warn-ink",
        className,
      )}
    >
      <ul className="grid gap-0.5">
        {items.map((s) => (
          <li key={s.code}>
            <b>{s.label}</b>: {own ? "hit" : `${name} needs`} {monthlyTarget(s.code)} again this
            month to keep it <span className="opacity-85">({soFar(s)})</span>.
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] opacity-85">
        {own ? "You met" : `${name} met`} {items.length > 1 ? "them" : "it"} in {last}, so{" "}
        {items.length > 1 ? "they count" : "it counts"}
        {until ? ` through ${dayLong(until)}` : " this month"}.
      </p>
    </div>
  );
}

/** "Marked by hand by Maria Reyes (from before the app)." */
function markLine(status: MilestoneStatus, marker: string | undefined): string {
  const note = status.mark?.note ? ` (${status.mark.note.toLowerCase()})` : "";
  return marker ? `Marked by hand by ${marker}${note}.` : `Marked by hand${note}.`;
}

function MilestoneDetail({
  id,
  path,
  status,
  own,
  coach,
  name,
  onCoach,
}: {
  id: string;
  path: GrowthPath;
  status: MilestoneStatus;
  own: boolean;
  coach: boolean;
  name: string;
  onCoach: (t: CoachTarget) => void;
}) {
  const people = useChatPeople();
  const me = useCurrentUser();
  const isNext = path.next?.code === status.code;
  const { held, hold } = status;
  const before = status.state === "lost";
  const keepUp = status.heldVia === "last_month";
  const def = growthMilestone(status.code);
  const progress = status.progress;
  const markedBy = status.mark?.markedBy;
  const marker =
    markedBy === me.personId ? "you" : markedBy ? people.get(markedBy)?.name : undefined;
  const legRule = def.check.kind === "legs_pv" ? def.check : null;
  const first = status.firstReachedOn;
  const daysChip =
    path.thisMonth.daysLeft === 0
      ? "Last day of the month"
      : `${path.thisMonth.daysLeft} ${path.thisMonth.daysLeft === 1 ? "day" : "days"} left this month`;

  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={`${id}-tab-${status.index}`}
      className="grid gap-2.5 rounded-xl bg-surface-2 px-3.5 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {held
              ? hold === "permanent"
                ? "Reached"
                : "Held now"
              : isNext
                ? own
                  ? "Your next milestone"
                  : "Next milestone"
                : before
                  ? "Earned before"
                  : "Later"}
          </span>
          <h3 className="text-lg leading-tight font-extrabold">{status.label}</h3>
        </div>
        {held ? (
          <ToneChip tone={keepUp ? "warn" : "good"} icon={Check}>
            {hold === "permanent"
              ? reachedShort(first!)
              : hold === "monthly" && status.heldUntil
                ? `Held through ${format(parseDate(status.heldUntil), "MMM d")}`
                : "Held now"}
          </ToneChip>
        ) : isNext && progress?.month ? (
          <ToneChip tone="info">{daysChip}</ToneChip>
        ) : before ? (
          <ToneChip tone="neutral" icon={History}>
            First hit {monthYear(first!)}
          </ToneChip>
        ) : null}
      </div>
      <p className="text-[12.5px] text-muted-foreground">{def.rule}.</p>

      {held && (
        <div className="grid gap-1 text-[12.5px]">
          <p>
            {hold === "permanent" ? "Reached" : "First reached"} on <b>{reachedLong(first!)}</b>
            {status.daysTaken !== null && status.index > 0 && (
              <>
                {" · "}
                {status.daysTaken === 0
                  ? "the same day as the step before"
                  : `${duration(status.daysTaken)} after the step before`}
              </>
            )}
          </p>
          <p className="text-muted-foreground">
            {status.source === "manual" ? markLine(status, marker) : "Found from the team's data."}
          </p>
          {hold === "live" && (
            <p className="text-muted-foreground">
              It counts while {own ? "you keep" : `${name} keeps`} {countTarget(status.code)}.
            </p>
          )}
          {hold === "monthly" && status.heldUntil && !keepUp && (
            <p className="text-muted-foreground">
              Met in {monthName(path.thisMonth.month)}, so it counts through{" "}
              {reachedLong(status.heldUntil)}.
            </p>
          )}
        </div>
      )}

      {before && (
        <div className="grid gap-1 text-[12.5px]">
          <p>
            {own ? "You" : name} first hit it on <b>{reachedLong(first!)}</b>
            {status.lastMetOn && status.lastMetOn !== first && (
              <>
                {" · "}
                {hold === "monthly"
                  ? `last met in ${monthName(status.lastMetOn.slice(0, 7))}`
                  : `last held ${monthYear(status.lastMetOn)}`}
              </>
            )}
            . {hold === "live" ? "The numbers are below it now" : "Not met this month or last"}, so
            it's one to earn again.
          </p>
          {status.source === "manual" && (
            <p className="text-muted-foreground">{markLine(status, marker)}</p>
          )}
        </div>
      )}

      {(!held || keepUp) && (
        <div className="grid gap-2.5">
          {isNext && path.workingDays !== null && path.nextIndex > 0 && (
            <p className="text-[12.5px]">
              Working on it for{" "}
              <b>{duration(path.workingDays).replace("same day", "less than a day")}</b> (since{" "}
              {path.milestones[path.nextIndex - 1].label}).
            </p>
          )}
          {keepUp && (
            <p className="text-[12.5px]">
              Met in {monthName(addMonths(path.thisMonth.month, -1))}, so it counts through{" "}
              <b>{reachedLong(status.heldUntil!)}</b>. To keep it, {own ? "hit" : `${name} needs`}{" "}
              {monthlyTarget(status.code)} again this month.
            </p>
          )}
          <ProgressParts status={status} />
          {isMonthly(status.code) && <OverrideNote path={path} own={own} />}
          {progress?.best && isMonthly(status.code) && (
            <p className="text-[12px] text-muted-foreground">
              Best month so far: <b className="text-foreground">{pv(progress.best.value)} PV</b> in{" "}
              {monthName(progress.best.month)}.
            </p>
          )}
          {legRule && progress?.legs && progress.legs.length > 0 && (
            <div className="grid gap-1">
              <span className="text-[11.5px] font-semibold text-muted-foreground">
                Legs this month
              </span>
              <ul className="grid gap-1">
                {progress.legs.slice(0, 6).map((l) => (
                  <li
                    key={l.personId}
                    className="flex items-center justify-between gap-3 text-[12.5px]"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {l.pv >= legRule.legPv ? (
                        <Check className="size-3.5 shrink-0 text-good" aria-label="Qualifies" />
                      ) : (
                        <span className="size-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate">{l.name}</span>
                    </span>
                    <b className="tabular-nums">{pv(l.pv)} PV</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {own && (isNext || keepUp) && isPersonalPv(status.code) && progress && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12.5px] text-muted-foreground">
                {pv(Math.max(0, progress.parts[0].target - progress.parts[0].current))} PV to go.
                Every sale you log counts right away.
              </p>
              <Button size="sm" onClick={() => openLog({ tab: "sale" })}>
                <ShoppingBag /> Log a sale
              </Button>
            </div>
          )}
          {!own && !isNext && !coach && !held && !before && (
            <p className="text-[12px] text-muted-foreground">Not reached yet.</p>
          )}
        </div>
      )}

      {coach && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-2.5">
          {isMonthly(status.code) && (
            <Button size="sm" variant="outline" onClick={() => onCoach({ tab: "pv" })}>
              <PencilLine /> Set {name}'s PV for a month
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onCoach({ tab: "mark", code: status.code })}
          >
            <Flag /> {markButtonLabel(status)}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The upline's mark button. A mark on a permanent milestone makes it reached;
 * on a live or monthly one it only records when they first hit it.
 */
function markButtonLabel(status: MilestoneStatus): string {
  if (status.hold !== "permanent")
    return status.mark ? "Change when they first hit it" : "Record when they first hit it";
  return status.mark
    ? "Change the hand mark"
    : status.firstReachedOn
      ? "Mark an earlier date"
      : "Mark as reached";
}
