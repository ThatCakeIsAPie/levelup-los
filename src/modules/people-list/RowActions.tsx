import { useNavigate } from "@tanstack/react-router";
import { Check, MessageSquarePlus, MoreHorizontal, ShoppingBag, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logContact, openLog } from "@/data";
import { cn } from "@/lib/utils";
import type { PersonRow } from "./model";

/** One-tap check-in (logs a contact for today). */
function checkIn(row: PersonRow) {
  logContact({ personId: row.person.id });
  const customer = row.person.bizClass === "customer";
  toast.success(
    customer ? `Contact with ${row.person.name} logged` : `Check-in with ${row.person.name} logged`,
  );
}

/** Check-in button plus a menu (open profile, log with a note, log a sale). */
export function RowActions({ row, className }: { row: PersonRow; className?: string }) {
  const navigate = useNavigate();
  const customer = row.person.bizClass === "customer";
  const doneToday = row.contact.days === 0;
  const name = row.person.name;

  return (
    <div className={cn("flex items-center justify-end gap-1", className)}>
      {!row.isSelf &&
        (doneToday ? (
          <span className="inline-flex h-8 items-center gap-1 whitespace-nowrap px-2 text-xs font-semibold text-good">
            <Check className="size-3.5" aria-hidden="true" />
            Done today
          </span>
        ) : (
          <Button
            size="sm"
            variant="soft"
            onClick={() => checkIn(row)}
            aria-label={customer ? `Log contact with ${name}` : `Check in with ${name}`}
          >
            <Check />
            {customer ? "Log contact" : "Check in"}
          </Button>
        ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-8" aria-label={`More for ${name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onSelect={() => navigate({ to: "/people/$id", params: { id: row.person.id } })}
          >
            <UserRound /> Open profile
          </DropdownMenuItem>
          {!row.isSelf && (
            <DropdownMenuItem
              onSelect={() =>
                openLog({ tab: customer ? "customer" : "checkin", personId: row.person.id })
              }
            >
              <MessageSquarePlus /> {customer ? "Log contact with a note" : "Check in with a note"}
            </DropdownMenuItem>
          )}
          {customer && (
            <DropdownMenuItem onSelect={() => openLog({ tab: "sale", personId: row.person.id })}>
              <ShoppingBag /> Log a sale
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
