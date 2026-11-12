import { useMemo } from "react";
import { PersonAvatar, STAGE_SOLID_CLASS, ToneChip } from "@/components/brand";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { effectiveBizClass, updateAttendance, type Attendance, type DesireLevel } from "@/data";
import { cn } from "@/lib/utils";
import { usePeopleMap } from "./hooks";
import { RiskBadge } from "./RiskFlags";
import { STAGES, patchForStage, shortDate, stageOf, ticketStatus, type StageKey } from "./lib";

/**
 * Board view: one column per stage (same steps as the funnel). Cards carry
 * the person's stage color; "Move to" changes the underlying fields with the
 * same rules as the old kanban. Scrolls sideways inside its own box.
 */
export function AttendeeKanban({
  rows,
  onEdit,
  finished,
}: {
  rows: Attendance[];
  onEdit: (attendanceId: string) => void;
  finished: boolean;
}) {
  const people = usePeopleMap();
  const grouped = useMemo(() => {
    const g: Record<StageKey, Attendance[]> = {
      invited: [],
      interested: [],
      date: [],
      ticket: [],
      attended: [],
    };
    rows.forEach((a) => g[stageOf(a)].push(a));
    return g;
  }, [rows]);

  return (
    <div
      className="-mx-4 overflow-x-auto px-4 pb-2 focus-visible:outline-2 focus-visible:outline-ring lg:mx-0 lg:px-0"
      role="region"
      aria-label="Attendee board"
      tabIndex={0}
    >
      <div className="flex min-w-max gap-3 xl:grid xl:min-w-0 xl:grid-cols-5">
        {STAGES.map((col) => (
          <section
            key={col.key}
            aria-labelledby={`col-${col.key}`}
            className="grid w-[232px] content-start gap-2 rounded-card bg-surface-2 p-2.5 xl:w-auto"
          >
            <h3
              id={`col-${col.key}`}
              className="flex items-center gap-2 px-1 pb-0.5 text-[12.5px] font-bold"
            >
              <span className={cn("size-2 rounded-full", col.dot)} aria-hidden="true" />
              {col.label}
              <span className="ml-auto rounded-full bg-card px-2 text-[11px] font-bold tabular-nums text-muted-foreground">
                {grouped[col.key].length}
              </span>
            </h3>
            {grouped[col.key].length === 0 && (
              <p className="rounded-[10px] border border-dashed border-line px-2 py-3 text-center text-[11.5px] text-faint">
                Nobody here
              </p>
            )}
            {grouped[col.key].map((a) => {
              const p = people.get(a.personId);
              const stage = p ? effectiveBizClass(p) : undefined;
              const ts = ticketStatus(a);
              return (
                <article
                  key={a.id}
                  className="relative grid gap-2 overflow-hidden rounded-[10px] border border-line bg-card py-2 pl-3.5 pr-2.5"
                >
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 w-[3px]",
                      stage ? STAGE_SOLID_CLASS[stage] : "bg-faint",
                    )}
                    aria-hidden="true"
                  />
                  <div className="flex items-center gap-2">
                    <PersonAvatar name={p?.name ?? "?"} stage={stage} size="sm" />
                    <button
                      type="button"
                      onClick={() => onEdit(a.id)}
                      className="min-w-0 flex-1 truncate rounded-sm text-left text-[13px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {p?.name ?? "Unknown person"}
                    </button>
                    <RiskBadge attendance={a} finished={finished} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {a.desireToAttend === "no" ? (
                      <ToneChip tone="neutral">Not going</ToneChip>
                    ) : (
                      col.key !== "attended" && <ToneChip tone={ts.tone}>{ts.label}</ToneChip>
                    )}
                    {a.followUpDate && !a.hasTicket && (
                      <ToneChip tone="neutral">Follow up {shortDate(a.followUpDate)}</ToneChip>
                    )}
                  </div>
                  {(col.key === "invited" || col.key === "interested") && (
                    <Select
                      value={a.desireToAttend ?? "unset"}
                      onValueChange={(v) =>
                        updateAttendance(a.id, {
                          desireToAttend: v === "unset" ? undefined : (v as DesireLevel),
                        })
                      }
                    >
                      <SelectTrigger
                        className="h-7 text-xs"
                        aria-label={`${p?.name ?? "Attendee"} wants to go`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unset">Not asked</SelectItem>
                        <SelectItem value="yes">Wants to go</SelectItem>
                        <SelectItem value="maybe">Maybe</SelectItem>
                        <SelectItem value="no">Not going</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {(col.key === "ticket" || col.key === "attended") && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={a.attended === true}
                        onCheckedChange={(v) =>
                          updateAttendance(a.id, { attended: v ? true : undefined })
                        }
                      />
                      Attended
                    </label>
                  )}
                  <Select
                    value=""
                    onValueChange={(v) => updateAttendance(a.id, patchForStage(a, v as StageKey))}
                  >
                    <SelectTrigger
                      className="h-7 text-xs text-muted-foreground"
                      aria-label={`Move ${p?.name ?? "attendee"} to another column`}
                    >
                      <SelectValue placeholder="Move to…" />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGES.filter((x) => x.key !== col.key).map((x) => (
                        <SelectItem key={x.key} value={x.key}>
                          {x.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
