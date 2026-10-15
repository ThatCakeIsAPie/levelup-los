import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toastWithUndo } from "@/components/log/quickLog";
import {
  CANCEL_REASONS,
  MAX_CANCEL_TEXT,
  NOT_INTERESTED,
  cancelBookedStep,
  cancelError,
  moveCustomerCard,
  movePipelineCard,
  offersNotInterested,
  type BoardKind,
  type CancelReason,
} from "@/data";

/**
 * "Cancel" on a booked next step: why (they cancelled, no-show, couldn't
 * reach them, not interested anymore, or in their own words). The booking is
 * cleared (the note stays), the cancellation is recorded and shows in the
 * person's activity; "Not interested anymore" can also move the card to
 * Not interested. One toast with Undo takes all of it back.
 */
export function CancelStepDialog({
  open,
  onOpenChange,
  board,
  cardId,
  name,
  stepLabel,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: BoardKind;
  cardId: string;
  name: string;
  /** "MG1", "Info 2". */
  stepLabel: string;
  /** After a confirmed cancel (e.g. close the sheet). */
  onDone?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Cancel {stepLabel} with {name.split(" ")[0]}?
          </DialogTitle>
          <DialogDescription>
            The booking comes off the card (its note stays). The reason is kept for your numbers.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CancelForm
            board={board}
            cardId={cardId}
            name={name}
            onClose={() => onOpenChange(false)}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CancelForm({
  board,
  cardId,
  name,
  onClose,
  onDone,
}: {
  board: BoardKind;
  cardId: string;
  name: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [text, setText] = useState("");
  const [moveOut, setMoveOut] = useState(true);
  const [tried, setTried] = useState(false);
  const error = cancelError(reason, text);

  const confirm = () => {
    setTried(true);
    if (error || !reason) return;
    const r = cancelBookedStep(board, cardId, reason, text);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    let moveUndo: (() => void) | null = null;
    if (offersNotInterested(reason) && moveOut) {
      // The normal move path (recorded, counted, undoable).
      const m =
        board === "customer"
          ? moveCustomerCard(cardId, NOT_INTERESTED)
          : movePipelineCard(cardId, NOT_INTERESTED);
      if (m.ok) moveUndo = m.undo;
    }
    toastWithUndo(
      r.summary.replace(" cancelled", ` with ${name.split(" ")[0]} cancelled`),
      () => {
        moveUndo?.();
        r.undo();
      },
      {
        description: moveUndo ? "Moved to Not interested." : undefined,
        undoneMessage: "Booking back on the card",
      },
    );
    onClose();
    onDone?.();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        // Rendered in a portal: don't let the submit reach a form around the trigger.
        e.stopPropagation();
        confirm();
      }}
    >
      <RadioGroup
        value={reason ?? ""}
        onValueChange={(v) => setReason(v as CancelReason)}
        aria-label="Why was it cancelled?"
        className="gap-2.5"
      >
        {CANCEL_REASONS.map((r) => (
          <div key={r.value} className="flex items-center gap-2.5">
            <RadioGroupItem value={r.value} id={`cancel-${r.value}`} />
            <Label htmlFor={`cancel-${r.value}`} className="text-[13.5px] font-medium">
              {r.label}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {reason === "other" && (
        <div className="grid gap-1.5">
          <Label htmlFor="cancel-text" className="text-[12px] text-muted-foreground">
            What happened?
          </Label>
          <Input
            id="cancel-text"
            autoFocus
            value={text}
            maxLength={MAX_CANCEL_TEXT}
            aria-invalid={tried && !!error}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Rescheduling after the holidays"
          />
        </div>
      )}
      {offersNotInterested(reason) && (
        <label className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 text-[13px]">
          <Checkbox checked={moveOut} onCheckedChange={(v) => setMoveOut(v === true)} />
          Also move them to Not interested
        </label>
      )}
      {tried && error && (
        <p className="text-[12.5px] font-semibold text-bad" role="alert">
          {error}
        </p>
      )}
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Keep it
        </Button>
        <Button type="submit" disabled={!reason}>
          Cancel step
        </Button>
      </DialogFooter>
    </form>
  );
}
