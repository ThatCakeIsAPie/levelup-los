/**
 * Booked next steps for Home (re-exported from "@/data"): the steps due today
 * or overdue on the cards the viewer owns, on both boards. The rules are
 * pure (`dueBookings` in ./booking.ts).
 */
import { useMemo } from "react";
import { localDate } from "@/lib/dates";
import { usePeopleStore } from "@/stores/peopleStore";
import { useViewer } from "../session";
import { useUnlocks } from "../team/hooks";
import { useCustomerPipelineStore } from "../customerPipeline/store";
import { useCustomerColumns, useDoNotContactIds } from "../customerPipeline/hooks";
import { entryCards } from "../customerPipeline/rules";
import { usePipelineStore } from "./store";
import { usePipelineColumns } from "./hooks";
import { boardCards } from "./rules";
import { bookingOf, dueBookings, type BookingCandidate, type DueBooking } from "./booking";

const NONE: DueBooking[] = [];

/** Booked steps due today or overdue on the viewer's own cards (both boards), oldest first. */
export function useDueBookings(): DueBooking[] {
  const viewer = useViewer();
  const { can } = useUnlocks();
  const people = usePeopleStore((s) => s.people);
  const cards = usePipelineStore((s) => s.cards);
  const entries = useCustomerPipelineStore((s) => s.entries);
  const customerCards = useCustomerPipelineStore((s) => s.cards);
  const me = viewer && viewer.role !== "candidate" ? viewer.personId : undefined;
  const recruiting = usePipelineColumns(me);
  const customer = useCustomerColumns(me);
  const skip = useDoNotContactIds();
  const today = localDate();
  return useMemo(() => {
    if (!me) return NONE;
    const out: BookingCandidate[] = [];
    if (can.pipeline) {
      const mine = people.filter((p) => p.sponsorId === me && p.bizClass === "prospect");
      for (const { person, card } of boardCards(mine, cards)) {
        if (!card.nextColumn) continue;
        out.push({
          board: "recruiting",
          cardId: person.id,
          name: person.name,
          ownerId: me,
          personIds: [person.id],
          booking: bookingOf(card),
          column: card.column,
          dropped: !!card.droppedAt,
          columns: recruiting,
        });
      }
    }
    if (can.customers) {
      const mine = entries.filter((e) => e.ownerId === me);
      for (const { entry, card } of entryCards(mine, customerCards)) {
        if (!card.nextColumn) continue;
        out.push({
          board: "customer",
          cardId: entry.id,
          name: entry.name,
          ownerId: me,
          personIds: [entry.customerId, entry.prospectId].filter((x): x is string => !!x),
          booking: bookingOf(card),
          column: card.column,
          dropped: false,
          columns: customer,
        });
      }
    }
    const due = dueBookings(out, me, today, skip);
    return due.length ? due : NONE;
  }, [
    me,
    can.pipeline,
    can.customers,
    people,
    cards,
    entries,
    customerCards,
    recruiting,
    customer,
    skip,
    today,
  ]);
}
