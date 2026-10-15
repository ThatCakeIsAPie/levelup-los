import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  ClockAlert,
  Kanban,
  Mail,
  MoveRight,
  Pencil,
  Phone,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar, ToneChip, useIsDesktop } from "@/components/brand";
import { Button } from "@/components/ui/button";
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
  CUSTOMER_BAND_LABEL,
  CUSTOMER_BOARD,
  addEntryToRecruiting,
  bookNextStep,
  bookableColumns,
  bookingError,
  sameBooking,
  openLog,
  updateCustomerCard,
  useCustomerColumns,
  updateListEntry,
  useListEntry,
  usePerson,
  usePipelineAccess,
  type BoardCard,
  type CustomerBand,
  type PipelineColumn,
} from "@/data";
import { MoveMenu } from "@/modules/pipeline/moveCard";
import { ageLong, bookingState } from "@/modules/pipeline/format";
import { BookingFields, NoteField } from "@/modules/pipeline/BookingFields";
import { BookedStep } from "@/modules/pipeline/BookedStep";
import { RatingPicker } from "./ListEntryDialog";

/** A customer card's details: where it is, move it, next step, warm/hot, the people it became. */
export function CustomerCardSheet({
  card,
  columns,
  open,
  onOpenChange,
  onMove,
  onEdit,
}: {
  card: BoardCard | null;
  columns: PipelineColumn<CustomerBand>[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (id: string, name: string, to: string) => void;
  onEdit: (entryId: string) => void;
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
          <Details
            key={card.personId}
            card={card}
            columns={columns}
            onMove={onMove}
            onEdit={onEdit}
            onClose={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Details({
  card,
  columns,
  onMove,
  onEdit,
  onClose,
}: {
  card: BoardCard;
  columns: PipelineColumn<CustomerBand>[];
  onMove: (id: string, name: string, to: string) => void;
  onEdit: (entryId: string) => void;
  onClose: () => void;
}) {
  const entry = useListEntry(card.personId);
  const customer = usePerson(entry?.customerId ?? undefined);
  const prospect = usePerson(entry?.prospectId ?? undefined);
  const recruiting = usePipelineAccess();
  const col = columns.find((c) => c.id === card.column);
  const ownerColumns = useCustomerColumns(card.ownerId);
  const bookable = bookableColumns(ownerColumns, card.cardColumn, CUSTOMER_BOARD, card.band);
  const initial = bookingState(card.booking);
  const [booking, setBooking] = useState(initial);
  const [note, setNote] = useState(card.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const bookingChanged = !sameBooking(booking, initial);
  const dirty = bookingChanged || note !== (card.note ?? "");

  const save = () => {
    if (bookingChanged) {
      const err = bookingError(booking, bookable);
      if (err) {
        setError(err);
        return;
      }
      const r = bookNextStep("customer", card.personId, booking);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
    }
    if (note !== (card.note ?? "")) updateCustomerCard(card.personId, { note });
    onClose();
  };

  return (
    <>
      <SheetHeader className="border-b border-line px-5 pb-3 pt-4 text-left">
        <div className="flex items-center gap-3">
          <PersonAvatar name={card.name} stage={customer ? "customer" : "prospect"} size="lg" />
          <div className="min-w-0">
            <SheetTitle className="truncate text-base font-extrabold">{card.name}</SheetTitle>
            <SheetDescription className="text-[12.5px]">
              {card.ownerName ? `On ${card.ownerName}'s list · ` : ""}
              {col ? `${CUSTOMER_BAND_LABEL[col.band]}` : ""}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 pb-5 pt-4">
        <div className="grid gap-2 rounded-card bg-surface-2 px-3.5 py-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <b>{col?.label ?? "Not contacted yet"}</b>
            {customer?.dittoSince && <ToneChip tone="good">On Ditto</ToneChip>}
            {card.stale && (
              <ToneChip tone="warn" icon={ClockAlert}>
                No movement in {ageLong(card.days)}
              </ToneChip>
            )}
          </div>
          <span className="text-[12px] text-muted-foreground">
            {card.listed
              ? "On the list, not contacted yet"
              : card.days === 0
                ? "Moved here today"
                : `Here for ${ageLong(card.days)}`}
            {card.elsewhere &&
              ` · at ${card.elsewhere.ownerName}'s step "${card.elsewhere.label}" on their board`}
          </span>
          <MoveMenu
            columns={columns}
            bands={CUSTOMER_BOARD.bands}
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

        {entry && (
          <div className="grid gap-2 text-[13px]">
            {entry.howKnown && <p className="text-muted-foreground">{entry.howKnown}</p>}
            {(entry.phone || entry.email) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {entry.phone && (
                  <a
                    href={`tel:${entry.phone}`}
                    className="inline-flex items-center gap-1.5 rounded-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Phone className="size-3.5" aria-hidden="true" /> {entry.phone}
                  </a>
                )}
                {entry.email && (
                  <a
                    href={`mailto:${entry.email}`}
                    className="inline-flex min-w-0 items-center gap-1.5 rounded-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{entry.email}</span>
                  </a>
                )}
              </div>
            )}
            {entry.notes && <p className="whitespace-pre-line text-[12.5px]">{entry.notes}</p>}
            <RatingPicker
              value={entry.rating}
              onChange={(rating) => updateListEntry(entry.id, { rating })}
            />
          </div>
        )}

        <BookedStep
          board="customer"
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
            id="cc-booking"
            columns={bookable}
            bands={CUSTOMER_BOARD.bands}
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
          <NoteField id="cc-note" value={note} onChange={setNote} />
          <Button type="submit" disabled={!dirty}>
            Save
          </Button>
        </form>

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {customer && (
            <>
              <Button
                variant="soft"
                size="sm"
                onClick={() => {
                  onClose();
                  openLog({ tab: "sale", personId: customer.id });
                }}
              >
                <ShoppingBag /> Log a sale
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/people/$id" params={{ id: customer.id }}>
                  <ArrowUpRight /> Customer profile
                </Link>
              </Button>
            </>
          )}
          {entry?.customerId && !customer && (
            <p className="w-full text-[12px] text-muted-foreground">
              A customer of {card.ownerName}&rsquo;s. Customers are private, so they log the sales.
            </p>
          )}
          {prospect ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/people/$id" params={{ id: prospect.id }}>
                <Kanban /> On the recruiting pipeline
              </Link>
            </Button>
          ) : (
            entry &&
            !entry.prospectId &&
            recruiting.enabled && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const r = addEntryToRecruiting(entry.id);
                  if (r)
                    toastWithUndo(`${entry.name} is on the recruiting pipeline too`, r.undo, {
                      description: "They start in Contact made.",
                      undoneMessage: "Taken off the recruiting pipeline",
                    });
                }}
              >
                <Kanban /> Add to recruiting
              </Button>
            )
          )}
          {entry && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onClose();
                onEdit(entry.id);
              }}
            >
              <Pencil /> Edit details
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
