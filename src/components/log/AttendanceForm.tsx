import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarX2 } from "lucide-react";
import { EmptyState } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EVENT_TYPE_LABEL,
  MODE_LABEL,
  closeLog,
  daysFromToday,
  eventModes,
  localDate,
  parseDate,
  setEventAttendance,
  useCurrentUser,
  useEvents,
  useVisibleAttendances,
  useVisibleTeam,
  type AttendMode,
} from "@/data";
import { Segmented } from "@/modules/events/Segmented";
import { MODE_ICON } from "@/modules/events/typeIcons";
import { toastWithUndo } from "./quickLog";
import { Field } from "./parts";

/** How far back the Log sheet offers events. */
const DAYS_BACK = 14;

/**
 * "Went to an event": who came (you, or someone on your team) to an event
 * from the last two weeks, in person or virtually. Counts toward their
 * activity and ends a missed-event follow-up.
 */
export function AttendanceForm({ initialPersonId }: { initialPersonId?: string }) {
  const user = useCurrentUser();
  const events = useEvents();
  const team = useVisibleTeam();
  const rows = useVisibleAttendances();
  const recent = useMemo(() => {
    const today = localDate();
    const from = daysFromToday(-DAYS_BACK);
    return events.filter((e) => e.date <= today && e.date >= from).reverse();
  }, [events]);
  const people = useMemo(() => {
    if (user.role === "candidate") return [];
    return team.filter((p) => p.id !== user.personId).sort((a, b) => a.name.localeCompare(b.name));
  }, [team, user]);

  const [eventId, setEventId] = useState(recent[0]?.id ?? "");
  const [personId, setPersonId] = useState(
    initialPersonId && people.some((p) => p.id === initialPersonId)
      ? initialPersonId
      : user.personId,
  );
  const event = recent.find((e) => e.id === eventId);
  const modes = event ? eventModes(event) : [];
  const [picked, setPicked] = useState<AttendMode | undefined>();
  const mode = picked && modes.includes(picked) ? picked : modes[0];
  const already = rows.find((a) => a.eventId === eventId && a.personId === personId);

  if (recent.length === 0)
    return (
      <EmptyState
        icon={<CalendarX2 />}
        title="No events in the last two weeks"
        body="When an event has happened, log who came here or on the event's page."
      />
    );

  const save = () => {
    if (!event || !mode) return;
    const undo = setEventAttendance(event.id, personId, mode);
    const who =
      personId === user.personId ? "You" : (people.find((p) => p.id === personId)?.name ?? "");
    toastWithUndo(`${who} came to ${event.name} (${MODE_LABEL[mode].toLowerCase()})`, undo, {
      undoneMessage: "Attendance removed",
    });
    closeLog();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label="Event" htmlFor="log-att-event">
        <Select value={eventId} onValueChange={setEventId}>
          <SelectTrigger id="log-att-event">
            <SelectValue placeholder="Which event?" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {recent.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {e.name === EVENT_TYPE_LABEL[e.type] ? "" : `${EVENT_TYPE_LABEL[e.type]} · `}
                  {format(parseDate(e.date), "EEE, MMM d")}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {people.length > 0 && (
        <Field label="Who came" htmlFor="log-att-person">
          <Select value={personId} onValueChange={setPersonId}>
            <SelectTrigger id="log-att-person">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={user.personId}>You</SelectItem>
              {people.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {modes.length > 1 && (
        <Field label="How">
          <Segmented<AttendMode>
            label="How did they join?"
            value={mode}
            onChange={(v) => v && setPicked(v)}
            options={modes.map((m) => ({ value: m, label: MODE_LABEL[m], icon: MODE_ICON[m] }))}
          />
        </Field>
      )}
      {already?.attended === true && (
        <p className="text-[12.5px] text-muted-foreground">
          Already marked as there
          {already.mode ? ` (${MODE_LABEL[already.mode].toLowerCase()})` : ""}.
        </p>
      )}
      <Button type="submit" disabled={!event}>
        Log attendance
      </Button>
    </form>
  );
}
