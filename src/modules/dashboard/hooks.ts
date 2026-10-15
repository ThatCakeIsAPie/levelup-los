import { useMemo } from "react";
import {
  bestLearningStreak,
  learningStreak,
  localDate,
  useLearning,
  useWeeklyGoal,
  useContactSettings,
  useCurrentUser,
  useDoNotContactIds,
  useEvents,
  useLastContactMap,
  useMissedFollowUps,
  useSales,
  useVisibleAttendances,
  useVisiblePeople,
} from "@/data";
import { buildTodayItems, type TodayItem } from "./today";
import { weekDays } from "./learning";

/** The ranked Today list for the current user. */
export function useTodayItems(): TodayItem[] {
  const user = useCurrentUser();
  const people = useVisiblePeople();
  const lastContact = useLastContactMap();
  const settings = useContactSettings();
  const events = useEvents();
  const attendances = useVisibleAttendances();
  const sales = useSales();
  const doNotContact = useDoNotContactIds();
  const missed = useMissedFollowUps();
  return useMemo(
    () =>
      buildTodayItems({
        viewerId: user.personId,
        role: user.role,
        people,
        lastContact,
        settings,
        events,
        attendances,
        sales,
        doNotContact,
        missed,
      }),
    [user, people, lastContact, settings, events, attendances, sales, doNotContact, missed],
  );
}

/** Streak + weekly goal numbers for one person (the viewer). */
export function useMyLearning(personId: string) {
  const entries = useLearning(personId);
  const weekly = useWeeklyGoal(personId);
  return useMemo(() => {
    const today = localDate();
    return {
      entries,
      goal: weekly.goal,
      /** Each goal item with this week's total. */
      goalItems: weekly.items,
      streak: learningStreak(entries),
      best: bestLearningStreak(entries),
      loggedToday: entries.some((e) => e.date === today),
      days: weekDays(entries, today),
      progress: weekly.progress,
    };
  }, [entries, weekly]);
}

export type MyLearning = ReturnType<typeof useMyLearning>;
