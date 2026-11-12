/**
 * How event categories look: the icon tile, the category chip and the in
 * person / virtual chip (icons and colors in ./categoryIcons). The rules
 * (settings, formats, who may edit) live in @/data (src/data/eventCategories).
 */
import { MapPin, MonitorPlay } from "lucide-react";
import { ToneChip } from "@/components/brand";
import {
  EVENT_FORMAT_LABEL,
  eventFormat,
  useEventCategory,
  type CrmEvent,
  type EventCategory,
} from "@/data";
import { cn } from "@/lib/utils";
import { categoryIcon, categoryToneClass } from "./categoryIcons";

/** The category's icon in a small tinted square (lists, pickers). */
export function CategoryTile({
  category,
  className,
}: {
  category: Pick<EventCategory, "icon" | "tone">;
  className?: string;
}) {
  const Icon = categoryIcon(category);
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md",
        categoryToneClass(category),
        className,
      )}
      aria-hidden="true"
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/** Chip with the category's icon and name. `onNavy` for the charcoal event cards. */
export function EventCategoryChip({
  event,
  onNavy,
  className,
}: {
  event: Pick<CrmEvent, "categoryId">;
  onNavy?: boolean;
  className?: string;
}) {
  const category = useEventCategory(event);
  return (
    <ToneChip
      tone="neutral"
      icon={categoryIcon(category)}
      className={cn(categoryToneClass(category), onNavy && "bg-white/10 text-event-fg", className)}
    >
      {category.name}
    </ToneChip>
  );
}

/**
 * "In person", "Virtual" or "In person + virtual". Hidden for in person
 * unless `always` (nothing to choose there).
 */
export function EventFormatChip({
  event,
  onNavy,
  always,
  className,
}: {
  event: Pick<CrmEvent, "categoryId" | "format">;
  onNavy?: boolean;
  always?: boolean;
  className?: string;
}) {
  const category = useEventCategory(event);
  const f = eventFormat(event, category);
  if (f === "in_person" && !always) return null;
  return (
    <ToneChip
      tone={f === "in_person" ? "neutral" : "info"}
      icon={f === "in_person" ? MapPin : MonitorPlay}
      className={cn(onNavy && "bg-white/10 text-event-fg", className)}
    >
      {EVENT_FORMAT_LABEL[f]}
    </ToneChip>
  );
}
