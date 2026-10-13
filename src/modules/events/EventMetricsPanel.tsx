import type { ReactNode } from "react";
import { SectionCard, SegmentedBar, STAGE_LABEL, STAGE_SOLID_CLASS } from "@/components/brand";
import { effectiveBizClass, useVisibleTeam, type Attendance, type BizClass } from "@/data";
import { cn } from "@/lib/utils";
import { usePeopleMap } from "./hooks";

const ORDER: BizClass[] = ["ibo", "apprentice", "prospect", "customer"];

/** Who is on the roster, by business stage (stage colors match the chips). */
export function RosterMix({ rows }: { rows: Attendance[] }) {
  const people = usePeopleMap();
  const counts: Record<BizClass, number> = { ibo: 0, apprentice: 0, prospect: 0, customer: 0 };
  for (const a of rows) {
    const p = people.get(a.personId);
    if (p) counts[effectiveBizClass(p)]++;
  }
  const stages = ORDER.filter((s) => counts[s] > 0 || s !== "customer");
  return (
    <SectionCard title="Roster mix">
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nobody on the roster yet.</p>
      ) : (
        <>
          <SegmentedBar
            height={10}
            segments={stages.map((s) => ({
              value: counts[s],
              className: STAGE_SOLID_CLASS[s],
              label: STAGE_LABEL[s],
            }))}
          />
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px]">
            {stages.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span
                  className={cn("size-2.5 shrink-0 rounded-[3px]", STAGE_SOLID_CLASS[s])}
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">{STAGE_LABEL[s]}</span>
                <b className="font-bold tabular-nums">{counts[s]}</b>
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5 rounded-[10px] bg-surface-2 px-3 py-2.5">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h3>
      <dl className="grid gap-1">{children}</dl>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12.5px]" title={hint}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The detailed counts from the old metrics panel: pipeline, ticketing,
 * engagement and qualifications.
 */
export function EventDetailsPanel({ rows }: { rows: Attendance[] }) {
  const team = useVisibleTeam();
  const count = (f: (a: Attendance) => boolean) => rows.filter(f).length;
  return (
    <SectionCard title="By the numbers">
      <div className="grid grid-cols-2 gap-2.5">
        <Group title="Pipeline">
          <Row label="Your team" value={team.length} hint="Everyone on your business team" />
          <Row label="Want to go" value={count((a) => a.desireToAttend === "yes")} />
          <Row label="Have a ticket" value={count((a) => a.hasTicket)} />
        </Group>
        <Group title="Ticketing">
          <Row label="In person" value={count((a) => a.hasTicket && a.mode !== "virtual")} />
          <Row label="Virtual" value={count((a) => a.hasTicket && a.mode === "virtual")} />
          <Row label="No-shows" value={count((a) => a.hasTicket && a.attended === false)} />
        </Group>
        <Group title="Engagement">
          <Row label="Follow-ups set" value={count((a) => !!a.followUpDate)} />
          <Row
            label="Purchase dates"
            value={count((a) => !a.hasTicket && !!a.plannedPurchaseDate)}
          />
          <Row label="Not going" value={count((a) => a.desireToAttend === "no")} />
        </Group>
        <Group title="Qualifications">
          <Row label="Leadership" value={count((a) => a.leadershipQualified)} />
          <Row label="Additional event" value={count((a) => a.specialEventQualified)} />
        </Group>
      </div>
    </SectionCard>
  );
}
