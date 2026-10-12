/**
 * Pure learning helpers for the Dashboard. "This week" is the rolling last 7
 * days (today and the 6 days before), so the weekly goal and the week strip
 * never reset to zero on a Monday morning.
 */
import { addDays, format } from "date-fns";
import {
  learningStreak,
  localDate,
  parseDate,
  type CrmPerson,
  type Learning,
  type LearningGoal,
} from "@/data";

export interface WeekTotals {
  pages: number;
  podcasts: number;
  workshops: number;
}

export interface WeekDay {
  date: string;
  /** One-letter weekday, e.g. "M". */
  letter: string;
  /** Full weekday name, for screen readers. */
  name: string;
  isToday: boolean;
  logged: boolean;
}

/** The first day of the rolling week that ends on `today`. */
export function weekStart(today: string): string {
  return localDate(addDays(parseDate(today), -6));
}

/** The last 7 days, oldest first (today last), with whether learning was logged. */
export function weekDays(entries: Learning[], today: string): WeekDay[] {
  const logged = new Set(entries.map((e) => e.date));
  const start = parseDate(today);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i - 6);
    const date = localDate(d);
    return {
      date,
      letter: format(d, "EEEEE"),
      name: format(d, "EEEE"),
      isToday: i === 6,
      logged: logged.has(date),
    };
  });
}

/** Pages, podcasts and workshops (conferences count as workshops) in the last 7 days. */
export function weekTotals(entries: Learning[], today: string): WeekTotals {
  const from = weekStart(today);
  const out: WeekTotals = { pages: 0, podcasts: 0, workshops: 0 };
  for (const e of entries) {
    if (e.date < from || e.date > today) continue;
    if (e.kind === "pages") out.pages += e.amount;
    else if (e.kind === "podcast") out.podcasts += e.amount;
    else out.workshops += e.amount;
  }
  return out;
}

/** Combined goal progress 0..1: the average of each kind's progress, each capped at 100%. */
export function goalProgress(totals: WeekTotals, goal: LearningGoal): number {
  const parts = (["pages", "podcasts", "workshops"] as const)
    .filter((k) => goal[k] > 0)
    .map((k) => Math.min(1, totals[k] / goal[k]));
  if (parts.length === 0) return 0;
  return parts.reduce((s, x) => s + x, 0) / parts.length;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "15 pages · 1 podcast" (empty string when nothing was logged). */
export function totalsSummary(t: WeekTotals): string {
  const parts: string[] = [];
  if (t.pages) parts.push(plural(t.pages, "page"));
  if (t.podcasts) parts.push(plural(t.podcasts, "podcast"));
  if (t.workshops) parts.push(plural(t.workshops, "workshop"));
  return parts.join(" · ");
}

export interface TeamLearner {
  person: CrmPerson;
  totals: WeekTotals;
  streak: number;
  /** Distinct days with learning in the last 7 days. */
  activeDays: number;
}

export interface TeamLearningSummary {
  /** Most active members this week, best first. */
  active: TeamLearner[];
  /** Members with nothing logged this week, direct team and IBO/apprentices first. */
  idle: CrmPerson[];
}

const STAGE_RANK: Record<string, number> = { ibo: 0, apprentice: 1, prospect: 2 };

/** Rank the team's learning for the last 7 days. `team` should exclude the viewer. */
export function summarizeTeamLearning(
  team: CrmPerson[],
  entries: Learning[],
  today: string,
  viewerId: string,
): TeamLearningSummary {
  const from = weekStart(today);
  const byPerson = new Map<string, Learning[]>();
  for (const e of entries) {
    const list = byPerson.get(e.personId);
    if (list) list.push(e);
    else byPerson.set(e.personId, [e]);
  }
  const active: TeamLearner[] = [];
  const idle: CrmPerson[] = [];
  for (const person of team) {
    const mine = byPerson.get(person.id) ?? [];
    const week = mine.filter((e) => e.date >= from && e.date <= today);
    if (week.length === 0) {
      idle.push(person);
      continue;
    }
    active.push({
      person,
      totals: weekTotals(week, today),
      streak: learningStreak(mine),
      activeDays: new Set(week.map((e) => e.date)).size,
    });
  }
  active.sort(
    (a, b) =>
      b.activeDays - a.activeDays ||
      b.streak - a.streak ||
      b.totals.pages - a.totals.pages ||
      a.person.name.localeCompare(b.person.name),
  );
  idle.sort(
    (a, b) =>
      Number(b.sponsorId === viewerId) - Number(a.sponsorId === viewerId) ||
      (STAGE_RANK[a.bizClass] ?? 3) - (STAGE_RANK[b.bizClass] ?? 3) ||
      a.name.localeCompare(b.name),
  );
  return { active, idle };
}
