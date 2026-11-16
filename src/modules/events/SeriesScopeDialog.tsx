import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type SeriesScope = "this" | "following";

/**
 * The calendar question for a change to an occurrence of a repeating event: "This event" or "This and
 * following events" (and Cancel, which just closes it). Used when saving the event form and when deleting.
 */
export function SeriesScopeDialog({
  open,
  onOpenChange,
  title,
  description,
  destructive,
  thisDisabled,
  busy,
  thisLabel = "This event",
  followingLabel = "This and following events",
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  /** Delete: the two choices are red. */
  destructive?: boolean;
  /** A change that only makes sense for this and the following events (Repeats, Ends). */
  thisDisabled?: boolean;
  busy?: boolean;
  /** The two choices' words (the calendar's drag asks for "Move just this one" and "Move all"). */
  thisLabel?: string;
  followingLabel?: string;
  onChoose: (scope: SeriesScope) => void;
}) {
  const choice = "w-full sm:w-auto";
  const danger = "bg-destructive text-destructive-foreground hover:bg-destructive/90";
  return (
    <AlertDialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <AlertDialogContent className="w-[calc(100%-2rem)] rounded-card">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={busy} className={cn(choice, "mt-0")}>
            Cancel
          </AlertDialogCancel>
          <Button
            type="button"
            variant={destructive ? "default" : "outline"}
            className={cn(choice, destructive && danger)}
            disabled={busy || thisDisabled}
            onClick={() => onChoose("this")}
          >
            {thisLabel}
          </Button>
          <Button
            type="button"
            className={cn(choice, destructive && danger)}
            disabled={busy}
            onClick={() => onChoose("following")}
          >
            {followingLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
