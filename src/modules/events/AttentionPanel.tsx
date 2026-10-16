import { useState } from "react";
import { CalendarClock, CheckCircle2, ClipboardCheck, HandHelping, Ticket } from "lucide-react";
import { toast } from "sonner";
import { ActionRow, SectionCard, StageChip, type IconTone } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  daysFromToday,
  effectiveBizClass,
  openLog,
  updateAttendance,
  useCurrentUser,
  useDoNotContactIds,
  useEventCategory,
  usesTickets,
  type Attendance,
  type CrmEvent,
} from "@/data";
import { usePeopleMap } from "./hooks";
import { attentionItems, shortDate, type AttentionCode, type AttentionItem } from "./lib";

const ICON: Record<AttentionCode, typeof Ticket> = {
  date_passed: Ticket,
  buy_due: Ticket,
  no_helper: HandHelping,
  no_followup: CalendarClock,
  followup_due: CalendarClock,
  unrecorded: ClipboardCheck,
};

const TONE: Record<AttentionCode, IconTone> = {
  date_passed: "bad",
  buy_due: "warn",
  no_helper: "bad",
  no_followup: "warn",
  followup_due: "info",
  unrecorded: "warn",
};

/** Patch with a toast that can undo it. */
function patchWithUndo(a: Attendance, patch: Partial<Attendance>, message: string) {
  const before: Partial<Attendance> = {};
  for (const k of Object.keys(patch) as (keyof Attendance)[])
    (before as Record<string, unknown>)[k] = a[k];
  updateAttendance(a.id, patch);
  toast.success(message, {
    action: { label: "Undo", onClick: () => updateAttendance(a.id, before) },
  });
}

/** "Needs attention this week": one row per person with a one-tap fix. */
export function AttentionPanel({
  event,
  rows,
  onEdit,
  readOnly,
}: {
  event: CrmEvent;
  rows: Attendance[];
  onEdit: (attendanceId: string) => void;
  readOnly?: boolean;
}) {
  const user = useCurrentUser();
  const people = usePeopleMap();
  const [showAll, setShowAll] = useState(false);
  const skip = useDoNotContactIds();
  const tickets = usesTickets(useEventCategory(event));
  const items = attentionItems({ ...event, tickets }, rows, undefined, skip);
  const finished = (event.endDate ?? event.date) < daysFromToday(0);
  const shown = showAll ? items : items.slice(0, 6);

  const action = (it: AttentionItem) => {
    const { a } = it;
    const name = people.get(a.personId)?.name ?? "This person";
    if (readOnly) return null;
    switch (it.code) {
      case "date_passed":
      case "buy_due":
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              patchWithUndo(
                a,
                { hasTicket: true, mode: a.mode ?? "in_person", desireToAttend: "yes" },
                `${name} has a ticket`,
              )
            }
          >
            Mark bought
          </Button>
        );
      case "no_helper":
        return a.personId === user.personId ? (
          <Button size="sm" variant="outline" onClick={() => onEdit(a.id)}>
            Pick helper
          </Button>
        ) : (
          <Button
            size="sm"
            variant="soft"
            onClick={() => patchWithUndo(a, { helperId: user.personId }, `You're helping ${name}`)}
          >
            I'll help
          </Button>
        );
      case "no_followup": {
        const d = daysFromToday(3);
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              patchWithUndo(
                a,
                { followUpDate: d },
                `Follow-up with ${name} set for ${shortDate(d)}`,
              )
            }
          >
            Follow up {shortDate(d)}
          </Button>
        );
      }
      case "followup_due":
        return (
          <Button
            size="sm"
            variant="soft"
            onClick={() => openLog({ tab: "checkin", personId: a.personId })}
          >
            Check in
          </Button>
        );
      case "unrecorded":
        return (
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="soft"
              onClick={() => patchWithUndo(a, { attended: true }, `${name} marked attended`)}
            >
              Attended
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => patchWithUndo(a, { attended: false }, `${name} marked as no-show`)}
            >
              No-show
            </Button>
          </div>
        );
    }
  };

  return (
    <SectionCard
      title={finished ? "Still to record" : "Needs attention this week"}
      action={
        items.length > 0 ? (
          <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-bold text-warn-ink tabular-nums">
            {items.length}
          </span>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-[10px] bg-surface-2 px-3 py-3 text-[13px]">
          <CheckCircle2 className="size-5 shrink-0 text-good" aria-hidden="true" />
          <span className="text-muted-foreground">
            {finished
              ? "Attendance is recorded for everyone with a ticket."
              : "Nobody needs a nudge this week."}
          </span>
        </div>
      ) : (
        <div>
          {shown.map((it) => {
            const p = people.get(it.a.personId);
            return (
              <ActionRow
                key={it.a.id}
                icon={ICON[it.code]}
                iconTone={TONE[it.code]}
                title={p?.name ?? "Unknown person"}
                onClick={() => onEdit(it.a.id)}
                meta={
                  <>
                    {p && <StageChip stage={effectiveBizClass(p)} />}
                    <span>{it.label}</span>
                  </>
                }
                action={action(it)}
                className="max-sm:grid-cols-[32px_minmax(0,1fr)] max-sm:[&>*:last-child]:col-start-2 max-sm:[&>*:last-child]:justify-self-start"
              />
            );
          })}
          {items.length > 6 && (
            <Button
              variant="link"
              size="sm"
              className="mt-1 h-auto px-0"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show fewer" : `Show all ${items.length}`}
            </Button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
