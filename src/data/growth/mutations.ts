import { useCrmStore } from "@/stores/crmStore";
import { useSessionStore } from "@/stores/sessionStore";
import { localDate } from "@/lib/dates";
import { canCoach } from "./hooks";
import type { GrowthMilestoneCode } from "./types";

const me = () => useSessionStore.getState().user?.personId;

/**
 * An upline sets a downline's PV for a calendar month ("YYYY-MM"), from their
 * Amway app. It replaces the logged total for that month and records who set
 * it and when. `null` clears it (back to the logged total). Returns false when
 * the viewer isn't an upline of the person, or the value isn't a number >= 0.
 */
export function setMonthPv(personId: string, month: string, pv: number | null): boolean {
  if (!canCoach(personId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  if (pv !== null && !(Number.isFinite(pv) && pv >= 0)) return false;
  useCrmStore
    .getState()
    .setPvOverride(
      personId,
      month,
      pv === null
        ? null
        : { pv: Math.round(pv * 100) / 100, setBy: me(), setAt: new Date().toISOString() },
    );
  return true;
}

/**
 * An upline marks a milestone as reached on a day (e.g. history from before
 * the app); recorded with who marked it. `null` removes the mark (what the
 * data shows still counts). Returns false when the viewer isn't an upline of
 * the person or the date is in the future.
 */
export function markMilestoneReached(
  personId: string,
  code: GrowthMilestoneCode,
  reachedOn: string | null,
  note?: string,
): boolean {
  if (!canCoach(personId)) return false;
  if (reachedOn !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(reachedOn) || reachedOn > localDate()))
    return false;
  useCrmStore.getState().setMilestoneMark(
    personId,
    code,
    reachedOn === null
      ? null
      : {
          reachedOn,
          markedBy: me(),
          markedAt: new Date().toISOString(),
          ...(note?.trim() ? { note: note.trim() } : {}),
        },
  );
  return true;
}
