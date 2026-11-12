import { Flame, Snowflake, Sun, type LucideIcon } from "lucide-react";
import { CONTACT_RATINGS, RATING_LABEL, type ContactRating } from "@/data/rating";
import { cn } from "@/lib/utils";

const ICON: Record<ContactRating, LucideIcon> = { hot: Flame, warm: Sun, cold: Snowflake };

/** Selected button / chip colors per rating (tones, never brand colors). */
const ON: Record<ContactRating, string> = {
  hot: "border-bad bg-bad-soft text-bad",
  warm: "border-warn bg-warn-soft text-warn-ink",
  cold: "border-info bg-info-soft text-info-ink",
};
const CHIP: Record<ContactRating, string> = {
  hot: "bg-bad-soft text-bad",
  warm: "bg-warn-soft text-warn-ink",
  cold: "bg-info-soft text-info-ink",
};

/**
 * Hot / Warm / Cold for a new contact (one control everywhere a contact is
 * added or edited). Tapping the selected one again clears it (not rated).
 */
export function RatingPicker({
  value,
  onChange,
  label = "How warm are they?",
  className,
}: {
  value: ContactRating | null;
  onChange: (v: ContactRating | null) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex gap-1.5", className)}>
      {CONTACT_RATINGS.map((r) => {
        const on = value === r;
        const Icon = ICON[r];
        return (
          <button
            key={r}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : r)}
            className={cn(
              "inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              on ? ON[r] : "border-line text-muted-foreground hover:bg-surface-2",
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            {RATING_LABEL[r]}
          </button>
        );
      })}
    </div>
  );
}

/** "Hot" / "Warm" / "Cold" pill for cards and rows; nothing when not rated. */
export function RatingChip({
  rating,
  size = "sm",
  className,
}: {
  rating: ContactRating | null | undefined;
  size?: "xs" | "sm";
  className?: string;
}) {
  if (!rating) return null;
  const Icon = ICON[rating];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-extrabold",
        size === "xs" ? "px-1.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        CHIP[rating],
        className,
      )}
    >
      {size === "sm" && <Icon className="size-3" aria-hidden="true" />}
      {RATING_LABEL[rating]}
    </span>
  );
}
