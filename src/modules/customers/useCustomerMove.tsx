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
  CUSTOMER_BAND_LABEL,
  DO_NOT_CONTACT,
  REFERRAL_SOURCE,
  closeLog,
  getListEntry,
  getPerson,
  isSaleBand,
  moveCustomerCard,
  openLog,
  useCurrentUser,
  type CustomerBand,
  type CustomerMoveFailure,
  type PipelineColumn,
} from "@/data";

const FAILURE: Record<CustomerMoveFailure, string> = {
  "no-access": "Your customer pipeline starts when you register.",
  "not-found": "That name isn't on a list you can see.",
  "unknown-column": "That column isn't on this board.",
  "same-column": "Already there.",
};

const first = (name: string) => name.split(" ")[0] ?? name;

/**
 * Move a customer card with an Undo toast. A move that makes someone a
 * customer (First sale, or straight past it) asks first, then opens the
 * existing "Made a sale" form for them (the list's owner logs it). Render
 * `dialog` once.
 */
export function useCustomerMove(columns: PipelineColumn<CustomerBand>[]) {
  const me = useCurrentUser();
  const [confirm, setConfirm] = useState<{ id: string; name: string; to: string } | null>(null);

  const doMove = (id: string, name: string, to: string) => {
    const r = moveCustomerCard(id, to);
    if (!r.ok) {
      if (r.reason !== "same-column") toast.error(FAILURE[r.reason]);
      return;
    }
    const label = columns.find((c) => c.id === to)?.label ?? CUSTOMER_BAND_LABEL[r.band];
    const opts = { undoneMessage: "Move undone" };
    if (r.becameCustomer && r.customerId) {
      // Customers are private to their owner: an upline moving a downline's
      // card makes the customer for them, and they log the sale.
      const mine = r.move.ownerId === me.personId && !!getPerson(r.customerId);
      const owner = mine ? "" : first(getPerson(r.move.ownerId)?.name ?? "their");
      // Undoing takes the new customer away again: close the sale form opened for them.
      const undo = () => {
        r.undo();
        if (mine) closeLog();
      };
      toastWithUndo(
        mine ? `${name} is now your customer` : `${name} is now ${owner}'s customer`,
        undo,
        {
          ...opts,
          description: mine
            ? `${r.setDitto ? "On Ditto too. " : ""}Log the sale in the form that just opened.`
            : `${owner} logs the sale from their Customers.`,
        },
      );
      if (mine) openLog({ tab: "sale", personId: r.customerId });
      return;
    }
    if (r.setDitto) {
      toastWithUndo(`${name} is on Ditto`, r.undo, {
        ...opts,
        description: "Marked as a subscription customer.",
      });
      return;
    }
    toastWithUndo(`${name} moved to ${label}`, r.undo, {
      ...opts,
      description:
        to === DO_NOT_CONTACT
          ? "They won't show up in any reminders."
          : to === REFERRAL_SOURCE
            ? "Open their card to add the names they pass on."
            : undefined,
    });
  };

  const move = (id: string, name: string, to: string) => {
    const band = columns.find((c) => c.id === to)?.band;
    const entry = getListEntry(id);
    if (band && isSaleBand(band) && entry && !entry.customerId) setConfirm({ id, name, to });
    else doMove(id, name, to);
  };

  const owner = confirm ? getListEntry(confirm.id)?.ownerId : undefined;
  const yours = !owner || owner === me.personId;
  const dialog = (
    <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Did {confirm ? first(confirm.name) : ""} make a first sale?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {yours
              ? "They become your customer, and the sale form opens so you can log what they bought."
              : `They become ${first(getPerson(owner ?? "")?.name ?? "your teammate")}'s customer (customers are private to them), and they log the sale.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (confirm) doMove(confirm.id, confirm.name, confirm.to);
              setConfirm(null);
            }}
          >
            Yes, first sale
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { move, dialog };
}
