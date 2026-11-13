import { PersonAvatar } from "@/components/brand";
import { effectiveBizClass, type CrmPerson } from "@/data";
import { cn } from "@/lib/utils";

/**
 * Overlapping initials avatars with a "+N" tail. Earlier avatars sit on top
 * and the overlap is small, so every pair of initials stays readable.
 */
export function AvatarStack({
  people,
  max = 5,
  ringClassName = "ring-card",
  onDark = false,
  className,
}: {
  people: CrmPerson[];
  max?: number;
  /** Ring color that separates the avatars (match the card background). */
  ringClassName?: string;
  /** On a dark card (the next-event card): the "+N" chip is a pale wash with the card's own text, not a light chip. */
  onDark?: boolean;
  className?: string;
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div
      className={cn("flex items-center", className)}
      role="img"
      aria-label={`${people.length} ${people.length === 1 ? "person" : "people"}: ${people
        .slice(0, max)
        .map((p) => p.name)
        .join(", ")}${rest > 0 ? ` and ${rest} more` : ""}`}
    >
      {shown.map((p, i) => (
        <span
          key={p.id}
          className="relative -ml-1 inline-flex first:ml-0"
          style={{ zIndex: shown.length - i + 1 }}
        >
          <PersonAvatar
            name={p.name}
            stage={effectiveBizClass(p)}
            size="sm"
            className={cn("ring-2", ringClassName)}
          />
        </span>
      ))}
      {rest > 0 && (
        <span
          className={cn(
            "relative -ml-1 inline-grid h-6 min-w-6 place-items-center rounded-full px-1 text-[10px] font-bold ring-2",
            // The dark card turns text-muted-foreground into a pale grey: on a light chip that was unreadable.
            onDark ? "bg-white/15 text-event-fg" : "bg-surface-2 text-muted-foreground",
            ringClassName,
          )}
          aria-hidden="true"
        >
          +{rest}
        </span>
      )}
    </div>
  );
}
