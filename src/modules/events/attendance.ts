/**
 * "Were they there?" helpers shared by the event roster, the viewer's own
 * card and the person profile.
 */
import { toast } from "sonner";
import { toastWithUndo } from "@/components/log/quickLog";
import { MODE_LABEL, eventModes, type AttendMode, type Attendance, type CrmEvent } from "@/data";
import { MODE_ICON } from "./typeIcons";

export type Came = AttendMode | "no";

/** The value of the "Were they there?" control for a row. */
export const cameValue = (a: Attendance | undefined): Came | undefined =>
  a?.attended === true ? (a.mode ?? "in_person") : a?.attended === false ? "no" : undefined;

/** Options for "Were they there?": the event's ways to attend, then "Not there". */
export function cameOptions(event: CrmEvent, notLabel = "Not there") {
  return [
    ...eventModes(event).map((m) => ({
      value: m as Came,
      label: MODE_LABEL[m],
      icon: MODE_ICON[m],
    })),
    { value: "no" as Came, label: notLabel },
  ];
}

/** Toast after recording someone's attendance elsewhere (profile, Log sheet). */
export function attendanceToast(
  name: string,
  eventName: string,
  value: Came | undefined,
  undo: () => void,
) {
  if (value === undefined) {
    toast(`Cleared ${name}'s attendance`);
    return;
  }
  toastWithUndo(
    value === "no"
      ? `${name} marked as not there`
      : `${name} came (${MODE_LABEL[value].toLowerCase()})`,
    undo,
    { description: eventName },
  );
}
