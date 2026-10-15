import { useCrmStore } from "@/stores/crmStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { useSessionStore } from "@/stores/sessionStore";
import { localDate } from "@/lib/dates";
import { visibleIdSet } from "../access";
import { getViewer } from "../session";
import { historyUpdates, type HistoryUpdate } from "./engine";
import { canCoach, isUplineOf } from "./hooks";
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
 * An upline records the day a milestone was (first) reached by hand (e.g.
 * history from before the app); saved with who marked it. For a permanent
 * milestone (New apprentice, First sale, First sponsor) the mark counts as
 * reached; for a live or monthly one it's history only (when they first hit
 * it) and doesn't make it held now. `null` removes the mark (what the data
 * shows still counts). Returns false when the viewer isn't an upline of the
 * person or the date is in the future.
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

/**
 * Records the history the data shows right now for the count milestones
 * (First sponsor, 3/10, 6/25, 6/50, 12/100) of the signed-in person and
 * everyone they coach, so a later drop keeps the first-reached date (and the
 * unlocks that go with it). Writes only rows that change (new, an earlier
 * first day, or last met in an earlier month); returns them. Mounted in the
 * shell through `useRecordMilestoneHistory()`.
 */
export function recordMilestoneHistory(): HistoryUpdate[] {
  const viewer = getViewer();
  if (!viewer || viewer.role === "candidate") return [];
  const people = usePeopleStore.getState().people;
  const crm = useCrmStore.getState();
  const visible = visibleIdSet(people, viewer);
  const ids = people
    .filter((p) => p.id === viewer.personId || isUplineOf(people, visible, viewer, p.id))
    .map((p) => p.id);
  const rows = historyUpdates(
    {
      people,
      sales: crm.sales,
      overrides: crm.pvOverrides,
      marks: crm.milestoneMarks,
      history: crm.milestoneHistory,
    },
    ids,
    localDate(),
  );
  if (rows.length) {
    const recordedAt = new Date().toISOString();
    crm.recordMilestoneHistory(
      rows.map((r) => ({ ...r, recordedBy: viewer.personId, recordedAt })),
    );
  }
  return rows;
}
