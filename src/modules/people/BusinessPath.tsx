import { addYears, differenceInCalendarDays, format } from "date-fns";
import { BellRing, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import {
  apprenticeAlertLabel,
  apprenticeAlertLevel,
  effectiveBizClass,
  localDate,
  parseDate,
  updatePerson,
  type CrmPerson,
  type PipelineStage,
} from "@/data";
import { SectionCard } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { firstName, fmtDate, relativeDays } from "./format";

type StepState = "done" | "current" | "todo";

const STEPS: { stage: PipelineStage; label: string }[] = [
  { stage: "prospect", label: "Prospect" },
  { stage: "apprentice", label: "Apprentice" },
  { stage: "ibo", label: "IBO" },
];

const RANK: Record<PipelineStage, number> = { prospect: 0, apprentice: 1, ibo: 2 };

/** First time the person entered `stage`, from stage history ("YYYY-MM-DD"). */
function enteredAt(p: CrmPerson, stage: PipelineStage): string | undefined {
  const h = p.stageHistory?.find((s) => s.stage === stage);
  return h ? localDate(new Date(h.at)) : undefined;
}

/** The apprentice anniversary (business start + 1 year) as "YYYY-MM-DD". */
function anniversary(p: CrmPerson): string | undefined {
  return p.businessStartDate ? localDate(addYears(parseDate(p.businessStartDate), 1)) : undefined;
}

/**
 * Prospect → Apprentice → IBO stepper with dates, plus the 90/30-day IBO
 * notice in context (mockup "Business path").
 */
export function BusinessPathCard({
  person,
  canEdit,
  compact,
}: {
  person: CrmPerson;
  canEdit: boolean;
  compact?: boolean;
}) {
  const effective = effectiveBizClass(person);
  const current: PipelineStage = effective === "customer" ? "prospect" : effective;
  const ibo = anniversary(person);
  const today = localDate();

  const dates: Record<PipelineStage, string> = {
    prospect:
      current === "prospect"
        ? `Since ${fmtDate(enteredAt(person, "prospect") ?? person.joinedDate) || "joining"}`
        : fmtDate(enteredAt(person, "prospect") ?? person.joinedDate),
    apprentice:
      current === "prospect"
        ? "Next step"
        : person.businessStartDate
          ? `${current === "apprentice" ? "Since " : ""}${fmtDate(person.businessStartDate)}`
          : "Start date missing",
    ibo:
      current === "ibo"
        ? fmtDate(enteredAt(person, "ibo") ?? ibo) || "IBO"
        : ibo
          ? `${fmtDate(ibo)} · ${relativeDays(differenceInCalendarDays(parseDate(ibo), parseDate(today)))}`
          : current === "apprentice"
            ? "Needs a start date"
            : "",
  };

  const stateOf = (stage: PipelineStage): StepState => {
    if (RANK[stage] < RANK[current]) return "done";
    if (stage === current) return current === "ibo" ? "done" : "current";
    return "todo";
  };

  return (
    <SectionCard
      title="Business path"
      action={
        person.businessStartDate && !compact ? (
          <span className="font-normal text-faint">
            Started {fmtDate(person.businessStartDate, { year: true })}
          </span>
        ) : undefined
      }
    >
      <ol className="grid grid-cols-3" aria-label="Business path">
        {STEPS.map(({ stage, label }) => {
          const state = stateOf(stage);
          return (
            <li
              key={stage}
              className="relative grid content-start justify-items-start gap-0.5 pt-[22px]"
              aria-current={stage === current ? "step" : undefined}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-0 right-0 top-[7px] h-[3px]",
                  state === "done" ? "bg-primary" : "bg-track",
                )}
                style={
                  state === "current"
                    ? {
                        background:
                          "linear-gradient(90deg, var(--primary) 0 55%, var(--track) 55% 100%)",
                      }
                    : undefined
                }
              />
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-0 top-0 size-[17px] rounded-full border-[3px]",
                  state === "done" && "border-primary bg-primary",
                  state === "current" &&
                    "border-primary bg-card shadow-[0_0_0_4px_var(--primary-soft)]",
                  state === "todo" && "border-track bg-card",
                )}
              />
              <b className={cn("text-[13px]", compact && "text-[11.5px]")}>{label}</b>
              {!compact && dates[stage] && (
                <span className="text-[11.5px] text-muted-foreground">{dates[stage]}</span>
              )}
            </li>
          );
        })}
      </ol>

      <ApprenticeNotice person={person} canEdit={canEdit} compact={compact} />
    </SectionCard>
  );
}

/**
 * The 90/30-day "becomes an IBO" notice for an apprentice, and "Mark as IBO"
 * once their year is up. Renders nothing for anyone else.
 */
export function ApprenticeNotice({
  person,
  canEdit,
  compact,
}: {
  person: CrmPerson;
  canEdit: boolean;
  compact?: boolean;
}) {
  const level = apprenticeAlertLevel(person);
  const ibo = anniversary(person);
  if (!level || !ibo) return null;
  const name = firstName(person.name);
  const idsOnFile = !!person.iboNumber?.trim() && !!person.ltdNumber?.trim();
  const daysLeft = differenceInCalendarDays(parseDate(ibo), parseDate(localDate()));
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] bg-warn-soft px-3 py-2.5 text-[12.5px] text-warn-ink">
      {level === "due" ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      ) : (
        <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      )}
      <div className="grid gap-2">
        {level === "due" ? (
          <p>
            <b>{apprenticeAlertLabel(level)}.</b> {name}'s apprentice year ended on{" "}
            {format(parseDate(ibo), "MMM d")}. Update the stage so it shows everywhere.
          </p>
        ) : compact ? (
          <p>
            Becomes an IBO on <b>{format(parseDate(ibo), "MMM d")}</b>, {relativeDays(daysLeft)}
          </p>
        ) : (
          <p>
            <b>{level === "30d" ? "30-day notice." : "90-day notice."}</b> {name} becomes an IBO
            automatically on {format(parseDate(ibo), "MMM d")}.{" "}
            {idsOnFile
              ? "IBO# and LTD# are on file, so nothing is blocking it."
              : "Add the IBO# and LTD# in Details before then."}
          </p>
        )}
        {level === "due" && canEdit && (
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => {
              updatePerson(person.id, { bizClass: "ibo", pipelineStage: "ibo" });
              toast.success(`${name} is now an IBO`);
            }}
          >
            Mark as IBO
          </Button>
        )}
      </div>
    </div>
  );
}
