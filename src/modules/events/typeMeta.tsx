/**
 * How each event type looks: icon, chip, and the in person / virtual chip.
 * The rules (labels, which types can be virtual, tickets, travel) live in
 * @/data (src/data/eventTypes/info.ts).
 */
import { MapPin, MonitorPlay } from "lucide-react";
import { ToneChip } from "@/components/brand";
import {
  EVENT_FORMAT_LABEL,
  EVENT_TYPE_LABEL,
  eventFormat,
  type CrmEvent,
  type EventType,
} from "@/data";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_ICON } from "./typeIcons";

/** Neutral chip with the type's icon and name. `onNavy` for the charcoal event cards. */
export function EventTypeChip({
  type,
  onNavy,
  className,
}: {
  type: EventType;
  onNavy?: boolean;
  className?: string;
}) {
  return (
    <ToneChip
      tone="neutral"
      icon={EVENT_TYPE_ICON[type]}
      className={cn(onNavy && "bg-white/10 text-event-fg", className)}
    >
      {EVENT_TYPE_LABEL[type]}
    </ToneChip>
  );
}

/**
 * "In person", "Virtual" or "In person + virtual". Hidden for in-person-only
 * types unless `always` (nothing to choose there).
 */
export function EventFormatChip({
  event,
  onNavy,
  always,
  className,
}: {
  event: Pick<CrmEvent, "type" | "format">;
  onNavy?: boolean;
  always?: boolean;
  className?: string;
}) {
  const f = eventFormat(event);
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
