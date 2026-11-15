import { useEffect, useRef, useState, type RefObject } from "react";

export interface Undoable {
  /** What was deleted (names the button for a screen reader). */
  label: string;
  /** Puts it back (the same call the toast's Undo makes). */
  restore: () => void;
}

const OFFER_MS = 8000;

/**
 * Inside a card panel (a modal dialog) the keyboard cannot reach a toast's Undo: the panel keeps the
 * focus. So a delete there also offers the same Undo as a button right after the list, focused, for
 * a few seconds (`UndoButton`). Outside a dialog nothing is offered here (the toast is reachable) and
 * `fallback` runs, which puts the focus where the person was working.
 */
export function useUndoSlot(root: RefObject<HTMLElement | null>, fallback: () => void) {
  const [slot, setSlot] = useState<Undoable | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const back = useRef(fallback);
  back.current = fallback;
  useEffect(() => {
    if (!slot) return;
    button.current?.focus();
    const t = window.setTimeout(() => {
      if (document.activeElement === button.current) back.current();
      setSlot(null);
    }, OFFER_MS);
    return () => window.clearTimeout(t);
  }, [slot]);
  return {
    slot,
    button,
    offer: (u: Undoable) => {
      if (root.current?.closest('[role="dialog"]')) setSlot(u);
      else back.current();
    },
    clear: () => setSlot(null),
  };
}
