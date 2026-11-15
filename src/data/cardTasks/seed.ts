/**
 * Card tasks and notes demo seed (browser-storage demo; the generated `supabase/seed.sql` carries the
 * same rows). Every card's due step the pipeline seeds are planned with becomes a task (the column's
 * name, its day and time, the card's owner), a note a plan carries becomes the first entry of the log,
 * and a few cards get more (a ticked task, one without a day, a second note) so every shape shows.
 * Dates are relative to today, like the rest of the demo.
 */
import { subHours } from "date-fns";
import type { CrmPerson } from "@/stores/peopleStore";
import { seedPipelineFollowups } from "../pipeline/seed";
import { seedCustomerFollowups } from "../customerPipeline/seed";
import type { CardBoard, CardNote, CardTask, CardTasksData, SeedFollowup } from "./types";

const EXTRA_DONE = "Send the info link";
const EXTRA_OPEN = "Add to the group chat";
const EXTRA_NOTE = "Met through a friend, keen to hear more";

function build(board: CardBoard, list: SeedFollowup[], now: Date, out: CardTasksData): void {
  const key = board === "recruiting" ? "personId" : "entryId";
  list.forEach((f, i) => {
    const at = f.noteAt;
    const make = (
      n: number,
      t: Partial<CardTask> & { title: string; position: number },
    ): CardTask => ({
      id: `ct-${f.cardId}-${n}`,
      personId: null,
      entryId: null,
      [key]: f.cardId,
      done: false,
      doneAt: null,
      doneBy: null,
      dueDate: null,
      dueTime: null,
      assigneeId: f.ownerId,
      createdBy: f.ownerId,
      createdAt: at,
      updatedAt: at,
      ...t,
    });
    let n = 0;
    // Every third card with a due step already has a ticked task before it.
    if (f.title && i % 3 === 0)
      out.tasks.push(
        make(n++, { title: EXTRA_DONE, position: 0, done: true, doneAt: at, doneBy: f.ownerId }),
      );
    if (f.title)
      out.tasks.push(
        make(n++, {
          title: f.title,
          position: out.tasks.filter((x) => x[key] === f.cardId).length,
          dueDate: f.dueDate,
          dueTime: f.dueDate ? f.dueTime : null,
        }),
      );
    if (f.title && i % 4 === 1)
      out.tasks.push(
        make(n++, {
          title: EXTRA_OPEN,
          position: out.tasks.filter((x) => x[key] === f.cardId).length,
        }),
      );
    const note = (id: number, body: string, createdAt: string): CardNote => ({
      id: `cn-${f.cardId}-${id}`,
      personId: null,
      entryId: null,
      [key]: f.cardId,
      authorId: f.ownerId,
      body,
      createdAt,
    });
    if (f.note) out.notes.push(note(0, f.note, at));
    if (f.title && i % 5 === 2)
      out.notes.push(note(1, EXTRA_NOTE, subHours(new Date(at), 6).toISOString()));
  });
  void now;
}

/** The demo's card tasks and notes on both boards. */
export function seedCardTasks(people: CrmPerson[], now: Date = new Date()): CardTasksData {
  const out: CardTasksData = { tasks: [], notes: [] };
  build("recruiting", seedPipelineFollowups(people, now), now, out);
  build("customer", seedCustomerFollowups(people, now), now, out);
  return out;
}
