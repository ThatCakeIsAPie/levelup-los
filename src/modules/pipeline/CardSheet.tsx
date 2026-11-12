import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ClockAlert, MoveRight, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar, RatingChip, RatingPicker, ToneChip, useIsDesktop } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toastWithUndo } from "@/components/log/quickLog";
import { cn } from "@/lib/utils";
import {
  RECRUITING_BAND_LABEL,
  RECRUITING_BOARD,
  REFERRAL_SOURCE,
  bookNextStep,
  bookableColumns,
  bookingError,
  sameBooking,
  dropPipelineCard,
  updatePipelineCard,
  usePipelineColumns,
  type BoardCard,
  type PipelineColumn,
} from "@/data";
import { MoveMenu } from "./moveCard";
import { ageLong, bookingState } from "./format";
import { BookingFields, NoteField } from "./BookingFields";
import { BookedStep } from "./BookedStep";
import { ReferralsBlock } from "./Referrals";

/** A card's details: where it is, move it, next step, hot, where you met, take it off the board. */
export function CardSheet({
  card,
  columns,
  open,
  onOpenChange,
  onMove,
}: {
  card: BoardCard | null;
  columns: PipelineColumn[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (personId: string, name: string, to: string) => void;
}) {
  const desktop = useIsDesktop();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn(
          "flex flex-col gap-0 p-0",
          desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-card pb-safe",
        )}
      >
        {card && (
          <CardDetails
            key={card.personId}
            card={card}
            columns={columns}
            onMove={onMove}
            onClose={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CardDetails({
  card,
  columns,
  onMove,
  onClose,
}: {
  card: BoardCard;
  columns: PipelineColumn[];
  onMove: (personId: string, name: string, to: string) => void;
  onClose: () => void;
}) {
  const col = columns.find((c) => c.id === card.column);
  const ownerColumns = usePipelineColumns(card.ownerId);
  const bookable = bookableColumns(ownerColumns, card.cardColumn, RECRUITING_BOARD, card.band);
  const initial = bookingState(card.booking);
  const [booking, setBooking] = useState(initial);
  const [note, setNote] = useState(card.note ?? "");
  const [source, setSource] = useState(card.source ?? "");
  const [error, setError] = useState<string | null>(null);
  const bookingChanged = !sameBooking(booking, initial);
  const dirty = bookingChanged || note !== (card.note ?? "") || source !== (card.source ?? "");

  const save = () => {
    if (bookingChanged) {
      const err = bookingError(booking, bookable);
      if (err) {
        setError(err);
        return;
      }
      const r = bookNextStep("recruiting", card.personId, booking);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
    }
    updatePipelineCard(card.personId, { note, source: source.trim() || null });
    onClose();
  };

  return (
    <>
      <SheetHeader className="border-b border-line px-5 pb-3 pt-4 text-left">
        <div className="flex items-center gap-3">
          <PersonAvatar name={card.name} stage="prospect" size="lg" />
          <div className="min-w-0">
            <SheetTitle className="truncate text-base font-extrabold">{card.name}</SheetTitle>
            <SheetDescription className="text-[12.5px]">
              {card.ownerName ? `${card.ownerName}'s prospect · ` : ""}
              {col
                ? `${RECRUITING_BAND_LABEL[col.band]}${col.kind === "fixed" ? "" : " band"}`
                : ""}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 pb-5 pt-4">
        <div className="grid gap-2 rounded-card bg-surface-2 px-3.5 py-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <b>{col?.label ?? "Contact made"}</b>
            <RatingChip rating={card.rating} />
            {card.stale && (
              <ToneChip tone="warn" icon={ClockAlert}>
                No movement in {ageLong(card.days)}
              </ToneChip>
            )}
          </div>
          <span className="text-[12px] text-muted-foreground">
            {card.days === 0 ? "Moved here today" : `Here for ${ageLong(card.days)}`}
            {card.elsewhere &&
              ` · at ${card.elsewhere.ownerName}'s step "${card.elsewhere.label}" on their board`}
          </span>
          <MoveMenu
            columns={columns}
            current={card.column}
            align="start"
            onMove={(to) => {
              onMove(card.personId, card.name, to);
              onClose();
            }}
          >
            <Button variant="soft" size="sm" className="justify-self-start">
              <MoveRight /> Move to…
            </Button>
          </MoveMenu>
        </div>

        <ReferralsBlock
          target={{ kind: "person", id: card.personId }}
          name={card.name}
          ownerId={card.ownerId}
          board="recruiting"
          source={card.cardColumn === REFERRAL_SOURCE}
        />
        <BookedStep
          board="recruiting"
          cardId={card.personId}
          name={card.name}
          booking={card.booking}
          onCancelled={onClose}
        />
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <BookingFields
            id="card-booking"
            columns={bookable}
            bands={RECRUITING_BOARD.bands}
            value={booking}
            onChange={(b) => {
              setBooking(b);
              setError(null);
            }}
          />
          {error && (
            <p className="text-[12.5px] font-semibold text-bad" role="alert">
              {error}
            </p>
          )}
          <NoteField id="card-note" value={note} onChange={setNote} />
          <div className="grid gap-1.5">
            <Label htmlFor="card-source" className="text-[12px] text-muted-foreground">
              Where you met
            </Label>
            <Input
              id="card-source"
              value={source}
              maxLength={30}
              placeholder="e.g. Gym, Referral"
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[12px] text-muted-foreground" id="card-rating">
              How warm are they? <span className="text-faint">Hot shows first in the column</span>
            </span>
            <RatingPicker
              value={card.rating}
              onChange={(rating) => updatePipelineCard(card.personId, { rating })}
            />
          </div>
          <Button type="submit" disabled={!dirty}>
            Save
          </Button>
        </form>

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button asChild variant="outline" size="sm">
            <Link to="/people/$id" params={{ id: card.personId }}>
              <ArrowUpRight /> Open profile
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const undo = dropPipelineCard(card.personId);
              if (undo)
                toastWithUndo(`${card.name} taken off the board`, undo, {
                  description: "They stay a prospect on your People list.",
                  undoneMessage: "Back on the board",
                });
              onClose();
            }}
          >
            <UserMinus /> Take off the board
          </Button>
        </div>
      </div>
    </>
  );
}
