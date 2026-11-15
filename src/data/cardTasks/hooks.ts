/**
 * Card tasks and notes hooks (re-exported from "@/data"). Visibility is the cards' own: a card the
 * viewer may not see has no tasks or notes for them.
 */
import { useMemo } from "react";
import { usePeopleStore } from "@/stores/peopleStore";
import { visibleIdSet } from "../access";
import { useViewer } from "../session";
import { useWorkspaceTimezone } from "../workspaceTimezone";
import { useChatPeople } from "../chat/hooks";
import { useCustomerPipelineStore } from "../customerPipeline/store";
import { useDoNotContactIds } from "../customerPipeline/hooks";
import { visibleEntries } from "../customerPipeline/rules";
import { usePipelineStore } from "../pipeline/store";
import { useCardTasksStore } from "./store";
import {
  assigneeChoices,
  dueTasksFor,
  EMPTY_SUMMARY,
  notesOf,
  summarize,
  summarizeAll,
  tasksOf,
  type CardSummary,
  type DueTask,
} from "./rules";
import type { CardBoard, CardNote, CardRef, CardTask } from "./types";

const NONE_TASKS: CardTask[] = [];
const NONE_NOTES: CardNote[] = [];
const NONE_DUE: DueTask[] = [];

/** A card's tasks, in order. */
export function useCardTasks(ref: CardRef | null): CardTask[] {
  const tasks = useCardTasksStore((s) => s.tasks);
  return useMemo(() => (ref ? tasksOf(tasks, ref) : NONE_TASKS), [tasks, ref?.board, ref?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** A card's notes, newest first. */
export function useCardNotes(ref: CardRef | null): CardNote[] {
  const notes = useCardTasksStore((s) => s.notes);
  return useMemo(() => (ref ? notesOf(notes, ref) : NONE_NOTES), [notes, ref?.board, ref?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Who owns a card, by the stores: a prospect's sponsor, a list name's owner. */
function useOwnerOf(): (ref: CardRef) => string | null {
  const people = usePeopleStore((s) => s.people);
  const entries = useCustomerPipelineStore((s) => s.entries);
  return useMemo(() => {
    const sponsor = new Map(people.map((p) => [p.id, p.sponsorId ?? null]));
    const owner = new Map(entries.map((e) => [e.id, e.ownerId]));
    return (ref) => (ref.board === "recruiting" ? sponsor.get(ref.id) : owner.get(ref.id)) ?? null;
  }, [people, entries]);
}

/** One card's summary (the card panel and the profile). */
export function useCardSummary(ref: CardRef): CardSummary {
  const tasks = useCardTasks(ref);
  const notes = useCardNotes(ref);
  const timeZone = useWorkspaceTimezone();
  const ownerOf = useOwnerOf();
  const owner = ownerOf(ref);
  return useMemo(
    () =>
      tasks.length || notes.length
        ? summarize(tasks, notes, { now: new Date(), timeZone, ownerId: owner })
        : EMPTY_SUMMARY,
    [tasks, notes, timeZone, owner],
  );
}

/**
 * The summaries of every card on one board that has a task or a note, by the card's own id (the
 * prospect's, or the list name's). A card with none has no entry: nothing is drawn for it.
 */
export function useCardSummaries(board: CardBoard): ReadonlyMap<string, CardSummary> {
  const tasks = useCardTasksStore((s) => s.tasks);
  const notes = useCardTasksStore((s) => s.notes);
  const timeZone = useWorkspaceTimezone();
  const ownerOf = useOwnerOf();
  return useMemo(() => {
    const all = summarizeAll(
      tasks.filter((t) => (board === "recruiting" ? t.personId : t.entryId)),
      notes.filter((n) => (board === "recruiting" ? n.personId : n.entryId)),
      { now: new Date(), timeZone, ownerOf },
    );
    const prefix = `${board}:`;
    return new Map([...all].map(([k, v]) => [k.slice(prefix.length), v] as const));
  }, [tasks, notes, timeZone, ownerOf, board]);
}

/** The two people a task on this card may go to: the card's owner and you (one when they are the same). */
export function useAssigneeChoices(ref: CardRef): string[] {
  const viewer = useViewer();
  const ownerOf = useOwnerOf();
  const owner = ownerOf(ref);
  return useMemo(() => (viewer ? assigneeChoices(owner, viewer.personId) : []), [viewer, owner]);
}

/**
 * The viewer's open tasks due today or overdue (in the team's calendar), for Home: assigned to them,
 * or unassigned on a card they own. Cards off the board and in "Do not contact" leave theirs out.
 */
export function useDueTasks(): DueTask[] {
  const viewer = useViewer();
  const tasks = useCardTasksStore((s) => s.tasks);
  const people = usePeopleStore((s) => s.people);
  const cards = usePipelineStore((s) => s.cards);
  const entries = useCustomerPipelineStore((s) => s.entries);
  const customerCards = useCustomerPipelineStore((s) => s.cards);
  const skip = useDoNotContactIds();
  const timeZone = useWorkspaceTimezone();
  return useMemo(() => {
    if (!viewer || viewer.role === "candidate" || !tasks.some((t) => !t.done && t.dueDate))
      return NONE_DUE;
    const ids = visibleIdSet(people, viewer);
    const map = new Map<string, { ownerId: string; name: string; customerId?: string | null }>();
    const stored = new Map(cards.map((c) => [c.personId, c]));
    for (const p of people) {
      if (p.bizClass !== "prospect" || !p.sponsorId || !ids.has(p.id) || skip.has(p.id)) continue;
      const c = stored.get(p.id);
      if (c?.droppedAt || c?.column === "do_not_contact") continue;
      map.set(`recruiting:${p.id}`, { ownerId: p.sponsorId, name: p.name });
    }
    const storedEntry = new Map(customerCards.map((c) => [c.entryId, c]));
    for (const e of visibleEntries(entries, people, viewer)) {
      if (storedEntry.get(e.id)?.column === "do_not_contact") continue;
      if ((e.customerId && skip.has(e.customerId)) || (e.prospectId && skip.has(e.prospectId)))
        continue;
      map.set(`customer:${e.id}`, { ownerId: e.ownerId, name: e.name, customerId: e.customerId });
    }
    const due = dueTasksFor(tasks, viewer.personId, map, { now: new Date(), timeZone });
    return due.length ? due : NONE_DUE;
  }, [viewer, tasks, people, cards, entries, customerCards, skip, timeZone]);
}

/**
 * Who a task or note names: the person's name and stage, for anyone on the team (the card's owner or
 * an upline who is not in the viewer's own view come from the directory). Undefined for nobody.
 */
export function usePersonLookup(): (
  id: string | null | undefined,
) => { name: string; stage: import("@/stores/peopleStore").BizClass | undefined } | undefined {
  const people = useChatPeople();
  return useMemo(
    () => (id) => {
      const p = id ? people.get(id) : undefined;
      return p ? { name: p.name, stage: p.stage } : undefined;
    },
    [people],
  );
}
