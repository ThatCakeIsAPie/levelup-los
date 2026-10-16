import { useMemo } from "react";
import { logPerson } from "@/stores/activityStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import { useCrmStore, learningGoalFor, type LearningGoal } from "@/stores/crmStore";
import { useEventsStore } from "@/stores/eventsStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { localDate } from "@/lib/dates";
import { useCustomerPipelineStore } from "./customerPipeline/store";
import { usePipelineStore } from "./pipeline/store";
import { useVisibleIds } from "./people";
import { normalizeItem, weeklyGoalView, type WeeklyGoalView } from "./weeklyGoal";

/**
 * A visible person's weekly goal with this week's total for each item and the
 * combined progress (rules in ./weeklyGoal). Someone you can't see has their
 * goal counted against nothing.
 */
export function useWeeklyGoal(personId: string | undefined): WeeklyGoalView & {
  goal: LearningGoal;
} {
  const goals = useCrmStore((s) => s.goals);
  const learning = useCrmStore((s) => s.learning);
  const contacts = useCrmStore((s) => s.contacts);
  const sales = useCrmStore((s) => s.sales);
  const people = usePeopleStore((s) => s.people);
  const attendances = useAttendanceStore((s) => s.attendances);
  const events = useEventsStore((s) => s.events);
  const pipelineMoves = usePipelineStore((s) => s.moves);
  const customerMoves = useCustomerPipelineStore((s) => s.moves);
  const ids = useVisibleIds();
  return useMemo(() => {
    const goal = learningGoalFor(goals, personId ?? "");
    const visible = !!personId && ids.has(personId);
    const view = weeklyGoalView(goal, {
      personId: personId ?? "",
      today: localDate(),
      learning: visible ? learning : [],
      contacts: visible ? contacts : [],
      people: visible ? people : [],
      sales: visible ? sales : [],
      attendances: visible ? attendances : [],
      events,
      pipelineMoves: visible ? pipelineMoves : [],
      customerMoves: visible ? customerMoves : [],
    });
    return { goal, ...view };
  }, [
    goals,
    personId,
    ids,
    learning,
    contacts,
    people,
    sales,
    attendances,
    events,
    pipelineMoves,
    customerMoves,
  ]);
}

/**
 * Replace a person's weekly goal (items in order; units fitted to each
 * category). A change is noted in their activity ("Updated weekly goal"; Home's
 * "What you did today" lists it for whoever edited it).
 */
export function setLearningGoal(personId: string, goal: LearningGoal): void {
  const store = useCrmStore.getState();
  const next = { items: goal.items.map(normalizeItem) };
  const before = JSON.stringify(learningGoalFor(store.goals, personId).items);
  store.setLearningGoal(personId, next);
  if (JSON.stringify(next.items) !== before) {
    logPerson("updated", personId, "Edited weekly goal", { goal: true });
  }
}
