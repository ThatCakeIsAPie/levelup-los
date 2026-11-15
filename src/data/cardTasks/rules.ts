/**
 * Pure rules for card tasks and notes (no React, no stores). Tested in
 * `rules.test.ts`. The database enforces the same rules (migration
 * `20261108000100_card_tasks.sql`); this is the browser-storage demo's
 * implementation and what every surface reads.
 */
import {
  MAX_NOTE_BODY,
  MAX_TASK_TITLE,
  type CardBoard,
  type CardNote,
  type CardRef,
  type CardTask,
} from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;

/** The key a card's rows share: `recruiting:<person id>` or `customer:<entry id>`. */
export const cardKey = (ref: CardRef): string => `${ref.board}:${ref.id}`;

export const taskCard = (t: { personId: string | null; entryId: string | null }): CardRef | null =>
  t.personId
    ? { board: "recruiting", id: t.personId }
    : t.entryId
      ? { board: "customer", id: t.entryId }
      : null;

export const isOnCard = (
  row: { personId: string | null; entryId: string | null },
  ref: CardRef,
): boolean => (ref.board === "recruiting" ? row.personId === ref.id : row.entryId === ref.id);

/** A card's tasks in order: by position, then oldest first. New tasks go last, done ones stay in place. */
export function tasksOf(tasks: readonly CardTask[], ref: CardRef): CardTask[] {
  return tasks
    .filter((t) => isOnCard(t, ref))
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}

/** A card's notes, newest first. */
export function notesOf(notes: readonly CardNote[], ref: CardRef): CardNote[] {
  return notes
    .filter((n) => isOnCard(n, ref))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** The position a new task takes: after every task the card has. */
export const nextTaskPosition = (tasks: readonly CardTask[], ref: CardRef): number =>
  tasksOf(tasks, ref).reduce((n, t) => Math.max(n, t.position + 1), 0);

// ---------------------------------------------------------------------------
// What may be written
// ---------------------------------------------------------------------------

/** A task title as stored (trimmed), or null when it is empty or too long. */
export function cleanTitle(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t && t.length <= MAX_TASK_TITLE ? t : null;
}

/** A note body as stored (trimmed), or null when it is empty or too long. */
export function cleanBody(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t && t.length <= MAX_NOTE_BODY ? t : null;
}

/** "HH:mm" for a time the database hands back as "HH:mm:ss"; null when empty or not a time. */
export function cleanDueTime(s: string | null | undefined): string | null {
  const m = TIME_RE.exec((s ?? "").trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

export const validDate = (s: string | null | undefined): s is string =>
  !!s && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/**
 * A due date and time as stored: a time needs a date (without one it is dropped), and a bad value
 * is dropped. The database refuses a time without a date.
 */
export function cleanDue(
  date: string | null | undefined,
  time: string | null | undefined,
): { dueDate: string | null; dueTime: string | null } {
  const dueDate = validDate(date) ? date : null;
  return { dueDate, dueTime: dueDate ? cleanDueTime(time) : null };
}

/**
 * Who a task may go to: the card's owner or the person setting it (and nobody: whoever owns the
 * card). At most two people.
 */
export function assigneeChoices(ownerId: string | null, me: string): string[] {
  return [...new Set([ownerId, me].filter((x): x is string => !!x))];
}

/** May `me` assign a task on a card owned by `ownerId` to `assigneeId`? */
export const canAssign = (assigneeId: string | null, ownerId: string | null, me: string): boolean =>
  assigneeId === null || assigneeId === me || assigneeId === ownerId;

/** May `me` delete this note? Only its author. */
export const canDeleteNote = (note: Pick<CardNote, "authorId">, me: string): boolean =>
  !!note.authorId && note.authorId === me;

// ---------------------------------------------------------------------------
// Due dates in the team's time zone
// ---------------------------------------------------------------------------

/** The date and clock in `timeZone` at `now`: "YYYY-MM-DD" and "HH:mm:ss". */
export function zonedNow(now: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}:${get("second")}`,
  };
}

export type TaskDueState = "overdue" | "today" | "later";

/**
 * Where a due date stands in the team's calendar: overdue once its moment has passed (a task with a
 * time at that time, one without at the end of its day: the database's `list_card_tasks` rule),
 * today while it is still due today, else later.
 */
export function taskDueState(
  due: { date: string; time: string | null },
  now: Date,
  timeZone: string,
): TaskDueState {
  const at = zonedNow(now, timeZone);
  const dueAt = `${due.date}T${due.time ? `${due.time.slice(0, 5)}:00` : "23:59:59"}`;
  if (dueAt < `${at.date}T${at.time}`) return "overdue";
  return due.date === at.date ? "today" : "later";
}

/** Calendar days from `from` to `to` ("YYYY-MM-DD", counted in UTC days so no zone or DST shifts it). */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);

/** Order of two open tasks' due moments: earlier first, a day without a time after that day's timed tasks. */
const dueKey = (t: Pick<CardTask, "dueDate" | "dueTime">): string =>
  `${t.dueDate}T${t.dueTime ?? "23:59"}`;

// ---------------------------------------------------------------------------
// The summary every surface shows
// ---------------------------------------------------------------------------

export interface CardSummary {
  /** Ticked tasks, and all tasks. */
  done: number;
  total: number;
  /** The earliest due date (and time) among the OPEN tasks; null when none has one. */
  due: { date: string; time: string | null; state: TaskDueState } | null;
  /**
   * Who the open tasks are for, one entry per person, in order of first appearance: a task with no
   * assignee is the card owner's (when `ownerId` is given).
   */
  assigneeIds: string[];
  /** Notes on the card. */
  notes: number;
}

export const EMPTY_SUMMARY: CardSummary = {
  done: 0,
  total: 0,
  due: null,
  assigneeIds: [],
  notes: 0,
};

/** A card with no tasks and no notes shows nothing. */
export const isBlank = (s: CardSummary): boolean => s.total === 0 && s.notes === 0;

/**
 * One card's summary from its own tasks and notes (the single function behind the card face, the
 * card panel's counts and Home): tasks done and total, the earliest open due date and whether it is
 * overdue or today in the team's time zone, who the open tasks are for, and the notes count.
 */
export function summarize(
  tasks: readonly CardTask[],
  notes: readonly unknown[],
  opts: { now: Date; timeZone: string; ownerId?: string | null },
): CardSummary {
  const open = tasks.filter((t) => !t.done);
  const dated = open
    .filter((t) => t.dueDate)
    .sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || a.position - b.position);
  const first = dated[0];
  const people: string[] = [];
  for (const t of [...open].sort((a, b) => a.position - b.position)) {
    const who = t.assigneeId ?? opts.ownerId ?? null;
    if (who && !people.includes(who)) people.push(who);
  }
  return {
    done: tasks.length - open.length,
    total: tasks.length,
    due: first
      ? {
          date: first.dueDate!,
          time: first.dueTime,
          state: taskDueState(
            { date: first.dueDate!, time: first.dueTime },
            opts.now,
            opts.timeZone,
          ),
        }
      : null,
    assigneeIds: people,
    notes: notes.length,
  };
}

/** Summaries for every card that has a task or a note, by `cardKey`. */
export function summarizeAll(
  tasks: readonly CardTask[],
  notes: readonly CardNote[],
  opts: { now: Date; timeZone: string; ownerOf?: (ref: CardRef) => string | null },
): Map<string, CardSummary> {
  const byCard = new Map<string, { ref: CardRef; tasks: CardTask[]; notes: CardNote[] }>();
  const slot = (ref: CardRef) => {
    const key = cardKey(ref);
    let s = byCard.get(key);
    if (!s) byCard.set(key, (s = { ref, tasks: [], notes: [] }));
    return s;
  };
  for (const t of tasks) {
    const ref = taskCard(t);
    if (ref) slot(ref).tasks.push(t);
  }
  for (const n of notes) {
    const ref = taskCard(n);
    if (ref) slot(ref).notes.push(n);
  }
  const out = new Map<string, CardSummary>();
  for (const [key, s] of byCard)
    out.set(key, summarize(s.tasks, s.notes, { ...opts, ownerId: opts.ownerOf?.(s.ref) ?? null }));
  return out;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

/** An open task that is due today or overdue, for Home's Today card. */
export interface DueTask {
  taskId: string;
  board: CardBoard;
  /** The card: the prospect's id, or the list entry's id. */
  cardId: string;
  /** The card's person's name (a list name on the customer board). */
  name: string;
  title: string;
  dueDate: string;
  dueTime: string | null;
  state: Exclude<TaskDueState, "later">;
  /** Whole days past its date in the team's calendar (0 today). */
  daysLate: number;
  /** The customer behind a list name that already buys. */
  customerId: string | null;
}

/**
 * The open tasks for Home: due today or overdue, and the viewer's (assigned to them, or unassigned
 * on a card they own). `cards` says which cards the viewer may see, who owns them and what they are
 * called; a card that is not listed (off the board, in "Do not contact") has no tasks here.
 */
export function dueTasksFor(
  tasks: readonly CardTask[],
  viewerId: string,
  cards: ReadonlyMap<string, { ownerId: string; name: string; customerId?: string | null }>,
  opts: { now: Date; timeZone: string },
): DueTask[] {
  const today = zonedNow(opts.now, opts.timeZone).date;
  const out: DueTask[] = [];
  for (const t of tasks) {
    const ref = taskCard(t);
    if (!ref || t.done || !t.dueDate) continue;
    const card = cards.get(cardKey(ref));
    if (!card) continue;
    if (t.assigneeId ? t.assigneeId !== viewerId : card.ownerId !== viewerId) continue;
    const state = taskDueState({ date: t.dueDate, time: t.dueTime }, opts.now, opts.timeZone);
    if (state === "later") continue;
    out.push({
      taskId: t.id,
      board: ref.board,
      cardId: ref.id,
      name: card.name,
      title: t.title,
      dueDate: t.dueDate,
      dueTime: t.dueTime,
      state,
      daysLate: Math.max(0, daysBetween(t.dueDate, today)),
      customerId: card.customerId ?? null,
    });
  }
  return out.sort(
    (a, b) =>
      `${a.dueDate}T${a.dueTime ?? "23:59"}`.localeCompare(
        `${b.dueDate}T${b.dueTime ?? "23:59"}`,
      ) ||
      a.name.localeCompare(b.name) ||
      a.taskId.localeCompare(b.taskId),
  );
}
