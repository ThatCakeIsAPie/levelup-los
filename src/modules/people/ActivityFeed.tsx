import { useState } from "react";
import { format } from "date-fns";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { parseDate, removeContact, removeSale } from "@/data";
import { EmptyState } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import type { Dot, FeedItem } from "./feed";
import { fmtDate } from "./format";

const DOT_CLASS: Record<Dot, string> = {
  primary: "bg-primary",
  sky: "bg-sky",
  amber: "bg-amber",
  navy: "bg-stage-ibo",
  neutral: "bg-muted-foreground",
};

/**
 * Vertical timeline with colored dots (mockup "Recent activity"). With
 * `removable`, logged check-ins and sales get a row menu with "Remove".
 */
export function FeedList({
  items,
  showSub = false,
  emptyBody,
  removable = false,
}: {
  items: FeedItem[];
  showSub?: boolean;
  emptyBody?: string;
  removable?: boolean;
}) {
  const [removing, setRemoving] = useState<FeedItem | null>(null);
  if (!items.length) {
    return (
      <EmptyState
        title="No activity yet"
        body={emptyBody ?? "Check-ins, events and stage changes will show up here."}
      />
    );
  }
  const withMenu = removable && items.some((it) => it.remove);
  return (
    <>
      <ol className="grid">
        {items.map((it, i) => (
          <li
            key={it.id}
            className={cn(
              "relative grid gap-2.5 py-2 text-[12.5px]",
              withMenu
                ? "grid-cols-[18px_minmax(0,1fr)_auto_28px]"
                : "grid-cols-[18px_minmax(0,1fr)_auto]",
            )}
          >
            {i < items.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute bottom-[-8px] left-2 top-5 w-[1.5px] bg-line"
              />
            )}
            <i
              aria-hidden="true"
              className={cn(
                "relative z-[1] ml-[3px] mt-1 block size-2.5 rounded-full",
                DOT_CLASS[it.dot],
              )}
            />
            <div className="min-w-0">
              <p className="break-words">{it.text}</p>
              {showSub && it.sub && (
                <p className="break-words text-xs text-muted-foreground">{it.sub}</p>
              )}
            </div>
            <time
              className="whitespace-nowrap text-faint"
              dateTime={it.when}
              title={format(it.when.length <= 10 ? parseDate(it.when) : new Date(it.when), "PPP")}
            >
              {fmtDate(it.when.length <= 10 ? it.when : format(new Date(it.when), "yyyy-MM-dd"))}
            </time>
            {withMenu &&
              (it.remove ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-my-1 size-7 text-muted-foreground"
                      aria-label={`More for this ${it.remove.label}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => setRemoving(it)}
                      className="text-bad focus:bg-bad-soft focus:text-bad"
                    >
                      <Trash2 /> Remove {it.remove.label}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span />
              ))}
          </li>
        ))}
      </ol>
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this {removing?.remove?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.text}
              {removing ? ` on ${fmtDate(removing.when.slice(0, 10))}` : ""}. It's removed from the
              timeline and from "last contact" and sales totals. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const r = removing?.remove;
                if (!r) return;
                if (r.kind === "contact") removeContact(r.id);
                else removeSale(r.id);
                toast.success(r.kind === "contact" ? "Check-in removed" : "Sale removed");
                setRemoving(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
