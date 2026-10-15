import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Flame, Users } from "lucide-react";
import { quickCheckIn } from "@/components/log/quickLog";
import {
  EmptyState,
  PersonAvatar,
  SectionCard,
  SegmentedBar,
  STAGE_LABEL,
  STAGE_SOLID_CLASS,
  StatTile,
  ToneChip,
} from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  daysFromToday,
  effectiveBizClass,
  isRegistered,
  localDate,
  registeredOn,
  useContacts,
  useCustomerCounts,
  useTeamLearning,
  type CrmPerson,
} from "@/data";
import { plural } from "./format";
import { summarizeTeamLearning, totalsSummary, weekStart } from "./learning";

const STAGES = ["ibo", "apprentice"] as const;

/**
 * Team size, new registrations, customers and stage mix. `team` excludes the
 * viewer. Only registered people (apprentices and IBOs) count: prospects live
 * on the pipeline, not the team.
 */
export function TeamCard({ team, compact }: { team: CrmPerson[]; compact?: boolean }) {
  const customerCounts = useCustomerCounts();
  const stats = useMemo(() => {
    const since = daysFromToday(-30);
    const mix = { ibo: 0, apprentice: 0 };
    let size = 0;
    let fresh = 0;
    for (const p of team) {
      if (!isRegistered(p)) continue;
      size++;
      mix[effectiveBizClass(p) === "ibo" ? "ibo" : "apprentice"]++;
      const on = registeredOn(p);
      if (on && on >= since) fresh++;
    }
    const customers = Object.values(customerCounts).reduce((s, n) => s + n, 0);
    return { size, mix, fresh, customers };
  }, [team, customerCounts]);

  return (
    <SectionCard
      title="Your team"
      className={compact ? "rounded-xl p-3 sm:px-3" : undefined}
      action={
        <Link to="/mindmap" className="text-primary hover:underline">
          Open mindmap
        </Link>
      }
    >
      {stats.size === 0 ? (
        <EmptyState
          className="py-6"
          icon={<Users />}
          title="No one on your team yet"
          body="People you sponsor show up here once they register."
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/people">Go to people</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <StatTile value={stats.size} label="Registered" />
            <StatTile
              value={stats.fresh > 0 ? `+${stats.fresh}` : "0"}
              label={compact ? "New" : "Registered in 30 days"}
            />
            <StatTile value={stats.customers} label="Customers" />
          </div>
          <SegmentedBar
            height={10}
            segments={STAGES.map((s) => ({
              value: stats.mix[s],
              className: STAGE_SOLID_CLASS[s],
              label: STAGE_LABEL[s],
            }))}
          />
          <ul className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-muted-foreground">
            {STAGES.map((s) => (
              <li key={s} className="inline-flex items-center gap-1.5">
                <i className={`inline-block size-[9px] rounded-[3px] ${STAGE_SOLID_CLASS[s]}`} />
                {STAGE_LABEL[s]} <span className="tabular-nums">{stats.mix[s]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

const NUDGE_NOTE = "Learning nudge";

/** Who on the team is learning this week, with a Nudge for those who aren't. */
export function TeamLearningCard({
  team,
  viewerId,
  compact,
}: {
  team: CrmPerson[];
  viewerId: string;
  compact?: boolean;
}) {
  const entries = useTeamLearning();
  const contacts = useContacts();
  const today = localDate();
  const { active, idle } = useMemo(
    () => summarizeTeamLearning(team, entries, today, viewerId),
    [team, entries, today, viewerId],
  );
  const nudged = useMemo(() => {
    const from = weekStart(today);
    return new Set(
      contacts.filter((c) => c.note === NUDGE_NOTE && c.date >= from).map((c) => c.personId),
    );
  }, [contacts, today]);

  const activeShown = active.slice(0, idle.length > 0 ? 3 : 5);
  const idleShown = idle.slice(0, Math.max(2, 5 - activeShown.length));
  const moreIdle = idle.length - idleShown.length;

  return (
    <SectionCard
      title="Learning this week"
      className={compact ? "rounded-xl p-3 sm:px-3" : undefined}
      action={
        <Link to="/reports" className="text-primary hover:underline">
          All
        </Link>
      }
    >
      {team.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Your team's learning shows up here once you have a team.
        </p>
      ) : (
        <ul className="grid gap-2.5">
          {activeShown.map((l) => (
            <li
              key={l.person.id}
              className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]"
            >
              <PersonAvatar name={l.person.name} stage={effectiveBizClass(l.person)} />
              <div className="min-w-0">
                <PersonLink person={l.person} />
                <div className="truncate text-[11.5px] text-muted-foreground">
                  {totalsSummary(l.totals)}
                </div>
              </div>
              {l.streak > 0 ? (
                <ToneChip tone="warn" icon={Flame}>
                  <span className="sr-only">Streak </span>
                  {l.streak}
                </ToneChip>
              ) : (
                <span />
              )}
            </li>
          ))}
          {idleShown.map((p) => (
            <li
              key={p.id}
              className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]"
            >
              <PersonAvatar name={p.name} stage={effectiveBizClass(p)} />
              <div className="min-w-0">
                <PersonLink person={p} />
                <div className="text-[11.5px] text-muted-foreground">Nothing logged yet</div>
              </div>
              {nudged.has(p.id) ? (
                <ToneChip tone="neutral" icon={Check}>
                  Nudged
                </ToneChip>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Nudge ${p.name} about learning`}
                  onClick={() => quickCheckIn(p.id, "Nudge logged", { note: NUDGE_NOTE })}
                >
                  Nudge
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(moreIdle > 0 || active.length > activeShown.length) && (
        <p className="text-[11.5px] text-muted-foreground">
          {[
            active.length > activeShown.length &&
              `${plural(active.length - activeShown.length, "other")} learning`,
            moreIdle > 0 && `${moreIdle} more with nothing logged`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </SectionCard>
  );
}

function PersonLink({ person }: { person: CrmPerson }) {
  return (
    <Link
      to="/people/$id"
      params={{ id: person.id }}
      className="block truncate rounded-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {person.name}
    </Link>
  );
}
