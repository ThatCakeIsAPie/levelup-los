import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import type { Undoable } from "./useUndoSlot";

/** The Undo that `useUndoSlot` offers inside a card panel. */
export function UndoButton({
  slot,
  button,
}: {
  slot: Undoable | null;
  button: RefObject<HTMLButtonElement | null>;
}) {
  if (!slot) return null;
  return (
    <Button
      ref={button}
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 justify-self-start px-2 text-[12px] font-semibold"
      aria-label={`Undo delete: ${slot.label}`}
      onClick={slot.restore}
    >
      Undo
    </Button>
  );
}
