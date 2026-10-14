import { BookOpen, Headphones, Presentation } from "lucide-react";
import { SectionCard } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  effectiveBizClass,
  learningUnit,
  openLog,
  unitAmount,
  type CrmPerson,
  type Learning,
} from "@/data";
import { shortDate } from "./format";

const STEPS = [
  { stage: "prospect", label: "Prospect", note: "Getting to know the business" },
  { stage: "apprentice", label: "Apprentice", note: "First year after registering" },
  { stage: "ibo", label: "IBO", note: "Independent business owner" },
] as const;

/** Prospect → Apprentice → IBO, with the person's current step highlighted. */
export function PathCard({ me }: { me: CrmPerson | undefined }) {
  const stage = me ? effectiveBizClass(me) : "prospect";
  const current = Math.max(
    0,
    STEPS.findIndex((s) => s.stage === stage),
  );
  return (
    <SectionCard title="Your path">
      <ol className="grid grid-cols-3" aria-label="Business path">
        {STEPS.map((s, i) => {
          const done = i < current;
          const here = i === current;
          return (
            <li
              key={s.stage}
              className="relative grid content-start justify-items-start gap-1 pt-[22px] pr-2"
              aria-current={here ? "step" : undefined}
            >
              <span className="absolute inset-x-0 top-[7px] h-[3px] bg-track" aria-hidden="true">
                <span
                  className={cn(
                    "block h-full bg-primary",
                    done ? "w-full" : here ? "w-[55%]" : "w-0",
                  )}
                />
              </span>
              <span
                className={cn(
                  "absolute top-0 left-0 size-[17px] rounded-full border-[3px]",
                  done && "border-primary bg-primary",
                  here && "border-primary bg-card shadow-[0_0_0_4px_var(--color-primary-soft)]",
                  !done && !here && "border-track bg-card",
                )}
                aria-hidden="true"
              />
              <b className="text-[13px]">{s.label}</b>
              <span className="text-[11.5px] leading-snug text-muted-foreground">
                {here ? "You are here" : s.note}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="rounded-[10px] bg-surface-2 px-3 py-2.5 text-[12.5px] text-muted-foreground">
        {stage === "prospect"
          ? "Keep learning and come to the next event. When you register your business you become an apprentice, and an IBO one year later."
          : stage === "apprentice"
            ? "You become an IBO one year after your business start date."
            : "You're an IBO. Keep learning and helping your team grow."}
        {me?.joinedDate && ` You joined on ${shortDate(me.joinedDate)}.`}
      </p>
    </SectionCard>
  );
}

const KIND_ICON = {
  pages: BookOpen,
  podcast: Headphones,
  workshop: Presentation,
  conference: Presentation,
} as const;

function entryDetail(e: Learning): string {
  const unit = learningUnit(e);
  if (e.kind === "pages") return unitAmount(e.amount, unit!);
  if (e.kind === "podcast") {
    return unit === "minutes" || e.amount !== 1
      ? `Podcast · ${unitAmount(e.amount, unit!)}`
      : "Podcast";
  }
  return e.kind === "workshop" ? "Workshop" : "Conference";
}

/** The viewer's most recent learning entries. */
export function MyLearningCard({ entries }: { entries: Learning[] }) {
  const recent = entries.slice(0, 5);
  return (
    <SectionCard
      title="Your learning"
      action={
        <button
          type="button"
          onClick={() => openLog({ tab: "learning" })}
          className="rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Log learning
        </button>
      }
    >
      {recent.length === 0 ? (
        <div className="grid justify-items-start gap-2">
          <p className="text-[13px] text-muted-foreground">
            Nothing logged yet. Books, podcasts and workshops all count toward your streak.
          </p>
          <Button size="sm" onClick={() => openLog({ tab: "learning" })}>
            Log your first learning
          </Button>
        </div>
      ) : (
        <ul className="grid gap-2.5">
          {recent.map((e) => {
            const Icon = KIND_ICON[e.kind];
            return (
              <li
                key={e.id}
                className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]"
              >
                <span className="grid size-8 place-items-center rounded-[9px] bg-info-soft text-info-ink">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{e.title}</div>
                  <div className="text-[11.5px] text-muted-foreground">{entryDetail(e)}</div>
                </div>
                <span className="text-[11.5px] text-faint">{shortDate(e.date)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
