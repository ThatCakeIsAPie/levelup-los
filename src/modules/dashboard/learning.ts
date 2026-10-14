/**
 * Pure learning helpers for the Dashboard. "This week" is the rolling last 7
 * days (today and the 6 days before), so the weekly goal and the week strip
 * never reset to zero on a Monday morning.
 */
import { addDays, format } from "date-fns";
import {
  learningStreak,
  learningUnit,
  localDate,
  parseDate,
  unitAmount,
  type CrmPerson,
  type Learning,
  type LearningGoal,
} from "@/data";

export interface WeekTotals {
  pages: number;
  chapters: number;
  readingMinutes: number;
  /** Podcast episodes. */
  podcasts: number;
  listeningMinutes: number;
  workshops: number;
}

/** The totals that count toward the goal's reading and podcast targets. */
export function goalKeys(goal: LearningGoal): {
  reading: "pages" | "chapters" | "readingMinutes";
  podcasts: "podcasts" | "listeningMinutes";
} {
  const r = goal.readingUnit ?? "pages";
  return {
    reading: r === "minutes" ? "readingMinutes" : r,
    podcasts: goal.podcastUnit === "minutes" ? "listeningMinutes" : "podcasts",
  };
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

const TOTAL_KEY = {
  pages: { pages: "pages", chapters: "chapters", minutes: "readingMinutes" },
  podcast: { episodes: "podcasts", minutes: "listeningMinutes" },
} as const;

/**
 * Reading (by unit), podcasts (by unit) and workshops (conferences count as
 * workshops) in the last 7 days.
 */
export function weekTotals(entries: Learning[], today: string): WeekTotals {
  const from = weekStart(today);
  const out: WeekTotals = {
    pages: 0,
    chapters: 0,
    readingMinutes: 0,
    podcasts: 0,
    listeningMinutes: 0,
    workshops: 0,
  };
  for (const e of entries) {
    if (e.date < from || e.date > today) continue;
    const unit = learningUnit(e);
    const key =
      e.kind === "pages"
        ? TOTAL_KEY.pages[unit as keyof typeof TOTAL_KEY.pages]
        : e.kind === "podcast"
          ? TOTAL_KEY.podcast[unit as keyof typeof TOTAL_KEY.podcast]
          : "workshops";
    // Skip units this version doesn't know (data written by a newer client).
    if (key) out[key] += e.amount;
  }
  return out;
}

/**
 * Combined goal progress 0..1: the average of each target's progress, each
 * capped at 100%. Reading and podcasts count only entries in the goal's unit.
 */
export function goalProgress(totals: WeekTotals, goal: LearningGoal): number {
  const keys = goalKeys(goal);
  const parts = (
    [
      [totals[keys.reading], goal.pages],
      [totals[keys.podcasts], goal.podcasts],
      [totals.workshops, goal.workshops],
    ] as const
  )
    .filter(([, target]) => target > 0)
    .map(([done, target]) => Math.min(1, done / target));
  if (parts.length === 0) return 0;
  return parts.reduce((s, x) => s + x, 0) / parts.length;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "15 pages · 30 min reading · 1 podcast" (empty string when nothing was logged). */
export function totalsSummary(t: WeekTotals): string {
  const parts: string[] = [];
  if (t.pages) parts.push(unitAmount(t.pages, "pages"));
  if (t.chapters) parts.push(unitAmount(t.chapters, "chapters"));
  if (t.readingMinutes) parts.push(`${t.readingMinutes} min reading`);
  if (t.podcasts) parts.push(plural(t.podcasts, "podcast"));
  if (t.listeningMinutes) parts.push(`${t.listeningMinutes} min listening`);
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
      b.totals.chapters - a.totals.chapters ||
      b.totals.readingMinutes - a.totals.readingMinutes ||
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
