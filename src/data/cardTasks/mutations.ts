/**
 * Card task and note writes (re-exported from "@/data"). Plain functions: they apply at once to the
 * store. Each write the user may want to take back returns an `undo`. The rules are the database's
 * (docs/backend.md, "Card tasks and notes"): whoever may read and edit a card may read and edit its
 * tasks and notes; a task goes to the card's owner, to the person setting it or to nobody; a time
 * needs a date; ticking stamps who and when; a note is never edited and only its author deletes it.
 */
import { usePeopleStore } from "@/stores/peopleStore";
import { visibleIdSet } from "../access";
import { getViewer } from "../session";
import { customerPipeline } from "../customerPipeline/store";
import { visibleEntries } from "../customerPipeline/rules";
import { registeredInProgress } from "../pipeline/inProgress";
import { cardTasks, updateCardTasks } from "./store";
import {
  canAssign,
  canDeleteNote,
  cleanBody,
  cleanDue,
  cleanTitle,
  nextTaskPosition,
  taskCard,
  validDate,
} from "./rules";
import type { CardNote, CardRef, CardTask } from "./types";

const now = () => new Date().toISOString();

/** The current user, when they may use the pipeline (not candidates). */
function actor(): string | null {
  const v = getViewer();
  return v && v.role !== "candidate" ? v.personId : null;
}

/**
 * The card's owner when the viewer may read and edit the card (null owner: none recorded), or
 * undefined when they may not. A recruiting card is a prospect they see; a customer card a name on
 * a list they see (their own and their downline's).
 */
export function cardOwner(ref: CardRef): { ownerId: string | null } | undefined {
  const viewer = getViewer();
  if (!viewer || viewer.role === "candidate") return undefined;
  const people = usePeopleStore.getState().people;
  if (ref.board === "recruiting") {
    if (!visibleIdSet(people, viewer).has(ref.id)) return undefined;
    const p = people.find((x) => x.id === ref.id);
    // A prospect, or a registered person whose card is in progress after Registered (src/data/pipeline/afterRegistered).
    return p?.bizClass === "prospect" || (p && registeredInProgress(p))
      ? { ownerId: p.sponsorId ?? null }
      : undefined;
  }
  const e = visibleEntries(customerPipeline().entries, people, viewer).find((x) => x.id === ref.id);
  return e ? { ownerId: e.ownerId } : undefined;
}

/** Whether the viewer may see and edit this card's tasks and notes. */
export const canEditCard = (ref: CardRef): boolean => !!cardOwner(ref);

export type TaskResult =
  { ok: true; task: CardTask; undo: () => void } | { ok: false; error: string };

export interface TaskInput {
  title: string;
  dueDate?: string | null;
  dueTime?: string | null;
  /** The card's owner or you; null or left out: whoever owns the card. */
  assigneeId?: string | null;
}

/** Add a task as the card's last one. */
export function addCardTask(ref: CardRef, input: TaskInput): TaskResult {
  const me = actor();
  const access = me ? cardOwner(ref) : undefined;
  if (!me || !access) return { ok: false, error: "You can't change this card." };
  const title = cleanTitle(input.title);
  if (!title) return { ok: false, error: "Give the task a title." };
  const assigneeId = input.assigneeId ?? null;
  if (!canAssign(assigneeId, access.ownerId, me))
    return { ok: false, error: "A task goes to the card's owner or to you." };
  const at = now();
  const task: CardTask = {
    id: crypto.randomUUID(),
    personId: ref.board === "recruiting" ? ref.id : null,
    entryId: ref.board === "customer" ? ref.id : null,
    title,
    done: false,
    doneAt: null,
    doneBy: null,
    ...cleanDue(input.dueDate, input.dueTime),
    assigneeId,
    position: nextTaskPosition(cardTasks().tasks, ref),
    createdBy: me,
    createdAt: at,
    updatedAt: at,
  };
  updateCardTasks((s) => ({ tasks: [...s.tasks, task] }));
  return { ok: true, task, undo: () => dropTask(task.id) };
}

function dropTask(id: string): void {
  updateCardTasks((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
}

function taskById(id: string): { task: CardTask; ownerId: string | null } | undefined {
  const task = cardTasks().tasks.find((t) => t.id === id);
  const ref = task && taskCard(task);
  const access = ref ? cardOwner(ref) : undefined;
  return task && access ? { task, ownerId: access.ownerId } : undefined;
}

function putTask(task: CardTask): void {
  updateCardTasks((s) => ({ tasks: s.tasks.map((t) => (t.id === task.id ? task : t)) }));
}

export type TaskPatch = Partial<Pick<TaskInput, "title" | "dueDate" | "dueTime" | "assigneeId">>;

/**
 * Change a task: its title, its due date and time (clearing the date clears the time; a time
 * without a date is not kept) or its assignee. Returns an undo, or an error.
 */
export function updateCardTask(
  id: string,
  patch: TaskPatch,
): { ok: true; undo: () => void } | { ok: false; error: string } {
  const me = actor();
  const found = me ? taskById(id) : undefined;
  if (!me || !found) return { ok: false, error: "You can't change this card." };
  const { task, ownerId } = found;
  const next: CardTask = { ...task };
  if ("title" in patch) {
    const title = cleanTitle(patch.title);
    if (!title) return { ok: false, error: "Give the task a title." };
    next.title = title;
  }
  if ("dueDate" in patch || "dueTime" in patch) {
    const date = "dueDate" in patch ? patch.dueDate : task.dueDate;
    const time = "dueTime" in patch ? patch.dueTime : task.dueTime;
    if (date && !validDate(date)) return { ok: false, error: "That isn't a date." };
    const due = cleanDue(date, time);
    next.dueDate = due.dueDate;
    next.dueTime = due.dueTime;
  }
  if ("assigneeId" in patch) {
    const assigneeId = patch.assigneeId ?? null;
    // Only a new assignee is checked (a task already given to someone else's name stays).
    if (assigneeId !== task.assigneeId && !canAssign(assigneeId, ownerId, me))
      return { ok: false, error: "A task goes to the card's owner or to you." };
    next.assigneeId = assigneeId;
  }
  putTask({ ...next, updatedAt: now() });
  return { ok: true, undo: () => putTask(task) };
}

/** Tick or untick a task (who and when are stamped; unticking clears them). Returns an undo. */
export function setTaskDone(id: string, done: boolean): (() => void) | null {
  const me = actor();
  const found = me ? taskById(id) : undefined;
  if (!me || !found || found.task.done === done) return null;
  const { task } = found;
  const at = now();
  putTask({
    ...task,
    done,
    doneAt: done ? at : null,
    doneBy: done ? me : null,
    updatedAt: at,
  });
  return () => putTask(task);
}

/**
 * Delete a task. The undo puts the same task back: same id, same position, whatever its state was.
 */
export function removeCardTask(id: string): (() => void) | null {
  const found = actor() ? taskById(id) : undefined;
  if (!found) return null;
  const { task } = found;
  dropTask(id);
  return () =>
    updateCardTasks((s) =>
      s.tasks.some((t) => t.id === task.id) ? s : { tasks: [...s.tasks, task] },
    );
}

export type NoteResult =
  { ok: true; note: CardNote; undo: () => void } | { ok: false; error: string };

/** Add a note to the card's log, as you, now. */
export function addCardNote(ref: CardRef, body: string): NoteResult {
  const me = actor();
  if (!me || !cardOwner(ref)) return { ok: false, error: "You can't change this card." };
  const text = cleanBody(body);
  if (!text) return { ok: false, error: "Write something first." };
  const note: CardNote = {
    id: crypto.randomUUID(),
    personId: ref.board === "recruiting" ? ref.id : null,
    entryId: ref.board === "customer" ? ref.id : null,
    authorId: me,
    body: text,
    createdAt: now(),
  };
  updateCardTasks((s) => ({ notes: [...s.notes, note] }));
  return { ok: true, note, undo: () => dropNote(note.id) };
}

function dropNote(id: string): void {
  updateCardTasks((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
}

/** Delete your own note. The undo puts the same note back (same id, same time). */
export function removeCardNote(id: string): (() => void) | null {
  const me = actor();
  const note = cardTasks().notes.find((n) => n.id === id);
  const ref = note && taskCard(note);
  if (!me || !note || !ref || !cardOwner(ref) || !canDeleteNote(note, me)) return null;
  dropNote(id);
  return () =>
    updateCardTasks((s) =>
      s.notes.some((n) => n.id === note.id) ? s : { notes: [...s.notes, note] },
    );
}

// ---------------------------------------------------------------------------
// When a card's subject goes
// ---------------------------------------------------------------------------

/**
 * The tasks and notes without the cards `gone` (a person who was deleted, or a list name that was
 * removed): they go in the same change as the person or name, as the database cascades them. A
 * person who is gone is no longer anyone's assignee, author or ticker (the database sets those null).
 */
export function followupsWithout(
  data: { tasks: CardTask[]; notes: CardNote[] },
  gone: { personId?: string; entryId?: string },
): { tasks: CardTask[]; notes: CardNote[] } {
  const here = (r: { personId: string | null; entryId: string | null }) =>
    (!!gone.personId && r.personId === gone.personId) ||
    (!!gone.entryId && r.entryId === gone.entryId);
  const who = gone.personId;
  return {
    tasks: data.tasks
      .filter((t) => !here(t))
      .map((t) =>
        who && (t.assigneeId === who || t.doneBy === who || t.createdBy === who)
          ? {
              ...t,
              assigneeId: t.assigneeId === who ? null : t.assigneeId,
              doneBy: t.doneBy === who ? null : t.doneBy,
              createdBy: t.createdBy === who ? null : t.createdBy,
            }
          : t,
      ),
    notes: data.notes
      .filter((n) => !here(n))
      .map((n) => (who && n.authorId === who ? { ...n, authorId: null } : n)),
  };
}

/** Drop a deleted person's, or a removed list name's, tasks and notes (see `followupsWithout`). */
export function removeCardFollowups(gone: { personId?: string; entryId?: string }): void {
  updateCardTasks((s) => followupsWithout(s, gone));
}
