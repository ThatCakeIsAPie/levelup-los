import { toast } from "sonner";
import { SectionCard, ToneChip } from "@/components/brand";
import { Label } from "@/components/ui/label";
import {
  MODE_LABEL,
  assignToEvent,
  eventModes,
  setEventAttendance,
  updateAttendance,
  useCurrentUser,
  type AttendMode,
  type Attendance,
  type CrmEvent,
  type DesireLevel,
} from "@/data";
import { BuyTicketButton } from "./BuyTicketButton";
import { Segmented } from "./Segmented";
import { attendanceToast, cameOptions, cameValue } from "./attendance";
import { MODE_ICON } from "./typeIcons";

/**
 * The viewer's own answer for an event without tickets: before it, "Are you
 * coming?" (and how, when it's both in person and virtual); from the day of
 * the event, "Were you there?".
 */
export function MyAttendanceCard({
  event,
  rows,
  started,
}: {
  event: CrmEvent;
  rows: Attendance[];
  started: boolean;
}) {
  const user = useCurrentUser();
  const mine = rows.find((a) => a.personId === user.personId);
  const modes = eventModes(event);

  if (started) {
    const value = cameValue(mine);
    return (
      <SectionCard
        title="Were you there?"
        action={value && value !== "no" ? <ToneChip tone="good">You came</ToneChip> : undefined}
      >
        <Segmented
          label="Were you there?"
          allowEmpty
          value={value}
          onChange={(v) => {
            const undo = setEventAttendance(
              event.id,
              user.personId,
              v === undefined ? null : v === "no" ? false : v,
            );
            attendanceToast("You", event.name, v, undo);
          }}
          options={cameOptions(event, "Couldn't make it")}
        />
        <p className="text-xs text-muted-foreground">
          It counts toward your activity, and your upline sees it.
        </p>
      </SectionCard>
    );
  }

  const setDesire = (v: DesireLevel | undefined) => {
    const a = mine ?? assignToEvent(event.id, user.personId);
    updateAttendance(a.id, { desireToAttend: v });
    if (!mine && v)
      toast.success(v === "no" ? "Thanks for letting your team know" : "You're on the list");
  };
  return (
    <SectionCard title="Are you coming?">
      <Segmented<DesireLevel>
        label="Are you coming?"
        allowEmpty
        value={mine?.desireToAttend}
        onChange={setDesire}
        options={[
          { value: "yes", label: "Yes" },
          { value: "maybe", label: "Maybe" },
          { value: "no", label: "Can't" },
        ]}
      />
      {modes.length > 1 && mine && mine.desireToAttend !== "no" && (
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">How will you join?</Label>
          <Segmented<AttendMode>
            label="How will you join?"
            size="sm"
            value={mine.mode}
            onChange={(v) => v && updateAttendance(mine.id, { mode: v })}
            options={modes.map((m) => ({ value: m, label: MODE_LABEL[m], icon: MODE_ICON[m] }))}
          />
        </div>
      )}
      {mine?.desireToAttend !== "no" && (
        <BuyTicketButton event={event} variant="outline" className="justify-self-start" />
      )}
    </SectionCard>
  );
}
