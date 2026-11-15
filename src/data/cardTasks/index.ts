/**
 * Tasks and notes on pipeline cards, both boards (re-exported from "@/data"). Tables live in
 * ./store (browser storage in the demo; in memory with real accounts); `summarize` in ./rules is the
 * one function every surface takes a card's counts and due date from.
 */
export * from "./types";
export {
  EMPTY_SUMMARY,
  assigneeChoices,
  canAssign,
  canDeleteNote,
  cardKey,
  cleanDue,
  taskDueState,
  dueTasksFor,
  isBlank,
  notesOf,
  summarize,
  summarizeAll,
  tasksOf,
  zonedNow,
  type CardSummary,
  type TaskDueState,
  type DueTask,
} from "./rules";
export {
  useAssigneeChoices,
  useCardNotes,
  useCardSummaries,
  useCardSummary,
  useCardTasks,
  useDueTasks,
  usePersonLookup,
} from "./hooks";
export {
  addCardNote,
  addCardTask,
  canEditCard,
  cardOwner,
  removeCardFollowups,
  removeCardNote,
  removeCardTask,
  setTaskDone,
  updateCardTask,
  type NoteResult,
  type TaskInput,
  type TaskPatch,
  type TaskResult,
} from "./mutations";
