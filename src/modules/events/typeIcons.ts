/** Icons for event types and for how someone came. */
import type { LucideIcon } from "lucide-react";
import {
  Briefcase,
  GraduationCap,
  Lightbulb,
  MapPin,
  MonitorPlay,
  Moon,
  Ticket,
  Users,
} from "lucide-react";
import type { EventType } from "@/data";

export const EVENT_TYPE_ICON: Record<EventType, LucideIcon> = {
  night_owls: Moon,
  work_session: Briefcase,
  info_session: Lightbulb,
  training: GraduationCap,
  monthly_meeting: Users,
  conference: Ticket,
};

/** Icon for how someone came. */
export const MODE_ICON = { in_person: MapPin, virtual: MonitorPlay } as const;
