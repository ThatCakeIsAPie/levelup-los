import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toastWithUndo } from "@/components/log/quickLog";
import {
  RECRUITING_BAND_LABEL,
  REFERRAL_SOURCE,
  movePipelineCard,
  type MoveFailure,
  type PipelineColumn,
} from "@/data";

const FAILURE: Record<MoveFailure, string> = {
  "no-access": "Candidates don't have a pipeline yet.",
  "not-found": "That person isn't on your team.",
  "not-a-prospect": "Only prospects move on the board.",
  "not-on-board": "That card is off the board.",
  "unknown-column": "That column isn't on this board.",
  "same-column": "Already there.",
};

/**
 * Move a card with an Undo toast. Moving into Registered asks first (the
 * person becomes an apprentice from today). Render `dialog` once.
 */
export function useMoveCard(columns: PipelineColumn[]) {
  const [confirm, setConfirm] = useState<{ personId: string; name: string } | null>(null);

  const doMove = (personId: string, name: string, to: string) => {
    const r = movePipelineCard(personId, to);
    if (!r.ok) {
      if (r.reason !== "same-column") toast.error(FAILURE[r.reason]);
      return;
    }
    const label =
      columns.find((c) => c.id === to)?.label ?? RECRUITING_BAND_LABEL[r.move.milestone];
    toastWithUndo(
      r.registered ? `${name} registered — now an apprentice` : `${name} moved to ${label}`,
      r.undo,
      {
        undoneMessage: "Move undone",
        description:
          to === REFERRAL_SOURCE ? "Open their card to add the names they pass on." : undefined,
      },
    );
  };

  const move = (personId: string, name: string, to: string) => {
    if (to === "registered") setConfirm({ personId, name });
    else doMove(personId, name, to);
  };

  const dialog = (
    <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Register {confirm?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They become an apprentice from today and leave the board. Their IBO and LTD numbers can
            be added on their profile.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (confirm) doMove(confirm.personId, confirm.name, "registered");
              setConfirm(null);
            }}
          >
            Register
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { move, dialog };
}
