/**
 * `registeredInProgressIds` / `registeredInProgress` over the stores (for code outside React: the card's
 * tasks and notes, toasts). The rule itself is in ./afterRegistered.
 */
import { usePeopleStore, type CrmPerson } from "@/stores/peopleStore";
import { useRemoteStore } from "../remote/extras";
import { getBoardDef } from "../stageNames/hooks";
import { getWorkspaceTimezone } from "../workspaceTimezone";
import { registeredInProgressIds, type InProgressState } from "./afterRegistered";
import { isRegisteredPerson } from "./rules";
import { pipeline } from "./store";

/** The tables as they are now. */
export function currentInProgressState(): InProgressState {
  const p = pipeline();
  return {
    people: usePeopleStore.getState().people,
    steps: p.steps,
    hides: p.hides,
    cards: p.cards,
    moves: p.moves,
    uplines: useRemoteStore.getState().chain.map((c) => c.personId),
    def: getBoardDef("recruiting"),
    timeZone: getWorkspaceTimezone(),
    now: new Date(),
  };
}

/** Is this registered person's card in progress on their sponsor's board (so tasks and notes work on it)? */
export function registeredInProgress(person: CrmPerson): boolean {
  if (!isRegisteredPerson(person)) return false;
  return registeredInProgressIds([person], currentInProgressState()).has(person.id);
}
