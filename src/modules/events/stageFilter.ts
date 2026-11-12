/**
 * The attendee stage filter on an event (`/events/$id?stage=apprentice,ibo`):
 * show only some kinds of people. Pure, tested in stageFilter.test.ts.
 */
import { effectiveBizClass, type Attendance, type BizClass, type CrmPerson } from "@/data";

/** Chip order on the event page. */
export const ATTENDEE_STAGES: readonly BizClass[] = ["apprentice", "ibo", "customer", "prospect"];

/** The person's stage on the roster (an apprentice past their first year is an IBO). */
export function attendeeStage(
  a: Attendance,
  people: Map<string, CrmPerson>,
  today?: Date,
): BizClass | undefined {
  const p = people.get(a.personId);
  return p ? effectiveBizClass(p, today) : undefined;
}

/** Rows whose person is one of `stages` (empty = everyone). */
export function filterByStage(
  rows: Attendance[],
  people: Map<string, CrmPerson>,
  stages: readonly BizClass[],
  today?: Date,
): Attendance[] {
  if (!stages.length) return rows;
  return rows.filter((a) => {
    const s = attendeeStage(a, people, today);
    return !!s && stages.includes(s);
  });
}

/** How many rows per stage (for the chip counts). */
export function countByStage(
  rows: Attendance[],
  people: Map<string, CrmPerson>,
  today?: Date,
): Record<BizClass, number> {
  const c: Record<BizClass, number> = { prospect: 0, apprentice: 0, ibo: 0, customer: 0 };
  for (const a of rows) {
    const s = attendeeStage(a, people, today);
    if (s) c[s]++;
  }
  return c;
}

/**
 * The chips to show: every business stage, and Customer only when the list
 * has customers (or the filter already asks for them).
 */
export function stageChips(
  counts: Record<BizClass, number>,
  selected: readonly BizClass[],
): BizClass[] {
  return ATTENDEE_STAGES.filter(
    (s) => s !== "customer" || counts.customer > 0 || selected.includes("customer"),
  );
}
