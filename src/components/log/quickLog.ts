import { toast } from "sonner";
import { logContact, removeContact } from "@/data";

/**
 * Success toast with an "Undo" action (sonner closes the toast when it's
 * used). Returns the toast id, so another Undo control can dismiss it.
 */
export function toastWithUndo(
  message: string,
  undo: () => void,
  opts: { description?: string; undoneMessage?: string } = {},
): string | number {
  return toast.success(message, {
    description: opts.description,
    action: {
      label: "Undo",
      onClick: () => {
        undo();
        toast(opts.undoneMessage ?? "Undone");
      },
    },
  });
}

/**
 * One-tap check-in (or customer contact) logged for today, with Undo on the
 * toast. `onUndo` runs after the contact is removed by that toast.
 */
export function quickCheckIn(
  personId: string,
  message: string,
  opts: { note?: string; description?: string; onUndo?: () => void } = {},
): { contactId: string; toastId: string | number } {
  const contact = logContact({ personId, note: opts.note });
  const toastId = toastWithUndo(
    message,
    () => {
      removeContact(contact.id);
      opts.onUndo?.();
    },
    { description: opts.description, undoneMessage: "Check-in removed" },
  );
  return { contactId: contact.id, toastId };
}
