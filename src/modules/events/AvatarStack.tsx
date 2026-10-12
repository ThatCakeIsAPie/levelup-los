import { PersonAvatar } from "@/components/brand";
import { effectiveBizClass, type CrmPerson } from "@/data";
import { cn } from "@/lib/utils";

/** Overlapping initials avatars with a "+N" tail. */
export function AvatarStack({
  people,
  max = 5,
  ringClassName = "ring-card",
  className,
}: {
  people: CrmPerson[];
  max?: number;
  /** Ring color that separates the avatars (match the card background). */
  ringClassName?: string;
  className?: string;
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div
      className={cn("flex items-center -space-x-1.5", className)}
      role="img"
      aria-label={`${people.length} ${people.length === 1 ? "person" : "people"}: ${people
        .slice(0, max)
        .map((p) => p.name)
        .join(", ")}${rest > 0 ? ` and ${rest} more` : ""}`}
    >
      {shown.map((p) => (
        <PersonAvatar
          key={p.id}
          name={p.name}
          stage={effectiveBizClass(p)}
          size="sm"
          className={cn("ring-2", ringClassName)}
        />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            "inline-grid h-6 min-w-6 place-items-center rounded-full bg-surface-2 px-1 text-[10px] font-bold text-muted-foreground ring-2",
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
