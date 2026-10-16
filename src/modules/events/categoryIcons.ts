/** Icons and colors for event categories, and icons for how someone came. */
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Briefcase,
  CalendarDays,
  Coffee,
  GraduationCap,
  Handshake,
  Heart,
  Lightbulb,
  MapPin,
  Mic,
  MonitorPlay,
  Moon,
  Presentation,
  Rocket,
  Star,
  Ticket,
  Trophy,
  Users,
} from "lucide-react";
import { TONE_CLASS, type IconTone } from "@/components/brand";
import type { CategoryIcon, CategoryTone, EventCategory } from "@/data";

export const CATEGORY_ICON: Record<CategoryIcon, LucideIcon> = {
  moon: Moon,
  briefcase: Briefcase,
  lightbulb: Lightbulb,
  graduation: GraduationCap,
  users: Users,
  ticket: Ticket,
  calendar: CalendarDays,
  coffee: Coffee,
  mic: Mic,
  presentation: Presentation,
  handshake: Handshake,
  star: Star,
  rocket: Rocket,
  book: BookOpen,
  trophy: Trophy,
  heart: Heart,
};

/** Words for screen readers and the icon picker. */
export const CATEGORY_ICON_LABEL: Record<CategoryIcon, string> = {
  moon: "Moon",
  briefcase: "Briefcase",
  lightbulb: "Light bulb",
  graduation: "Graduation cap",
  users: "People",
  ticket: "Ticket",
  calendar: "Calendar",
  coffee: "Coffee",
  mic: "Microphone",
  presentation: "Presentation",
  handshake: "Handshake",
  star: "Star",
  rocket: "Rocket",
  book: "Book",
  trophy: "Trophy",
  heart: "Heart",
};

/** The icon for a category (a calendar for unknown keys). */
export const categoryIcon = (c: Pick<EventCategory, "icon"> | undefined): LucideIcon =>
  (c && CATEGORY_ICON[c.icon]) || CalendarDays;

/** Category colors on the design tokens. */
export const CATEGORY_TONE: Record<CategoryTone, IconTone> = {
  neutral: "neutral",
  green: "primary",
  blue: "info",
  amber: "warn",
  rose: "bad",
};

export const CATEGORY_TONE_LABEL: Record<CategoryTone, string> = {
  neutral: "Grey",
  green: "Green",
  blue: "Blue",
  amber: "Amber",
  rose: "Red",
};

/** Tinted classes for a category's icon tile or chip. */
export const categoryToneClass = (c: { tone?: CategoryTone } | undefined) =>
  TONE_CLASS[CATEGORY_TONE[c?.tone ?? "neutral"] ?? "neutral"];

/** Icon for how someone came. */
export const MODE_ICON = { in_person: MapPin, virtual: MonitorPlay } as const;
