import { Repeat } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Marks an occurrence of a repeating event where the app lists or heads an event. Only shown for
 * events that repeat; it carries an accessible name and no other text.
 */
export function RepeatIcon({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Repeating event"
      className={cn("inline-flex shrink-0 text-muted-foreground", className)}
    >
      <Repeat className="size-3.5" aria-hidden="true" />
    </span>
  );
}
