import {
  BookOpen,
  CalendarCheck,
  FileText,
  Flag,
  GraduationCap,
  Headphones,
  HeartHandshake,
  Lightbulb,
  Mic,
  Play,
  Presentation,
  Rocket,
  ShoppingBag,
  Sprout,
  Star,
  Target,
  Trophy,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogKind, ChannelColor } from "@/data";

/** The curated channel icons (CHANNEL_ICONS) by lucide name. */
export const CHANNEL_ICON: Record<string, LucideIcon> = {
  flag: Flag,
  "user-plus": UserPlus,
  "shopping-bag": ShoppingBag,
  sprout: Sprout,
  mic: Mic,
  "calendar-check": CalendarCheck,
  "book-open": BookOpen,
  "graduation-cap": GraduationCap,
  lightbulb: Lightbulb,
  target: Target,
  trophy: Trophy,
  rocket: Rocket,
  "heart-handshake": HeartHandshake,
  star: Star,
};

/** Channel tile / icon colors (tokens only; see docs/design/library-mockup.html). */
export const CHANNEL_COLOR_CLASS: Record<ChannelColor, string> = {
  navy: "bg-stage-ibo text-stage-ibo-fg",
  teal: "bg-primary text-primary-foreground",
  amber: "bg-amber text-on-amber",
  green: "bg-good-soft text-good",
  sky: "bg-sky text-on-sky",
  mist: "bg-info-soft text-info-ink",
};

export const CHANNEL_COLOR_LABEL: Record<ChannelColor, string> = {
  navy: "Navy",
  teal: "Teal",
  amber: "Amber",
  green: "Green",
  sky: "Sky",
  mist: "Mist",
};

export const KIND_ICON: Record<CatalogKind, LucideIcon> = {
  audio: Headphones,
  video: Play,
  slides: Presentation,
  document: FileText,
};

export const KIND_TONE: Record<CatalogKind, string> = {
  audio: "bg-info-soft text-info-ink",
  video: "bg-primary-soft text-primary-ink",
  slides: "bg-surface-2 text-muted-foreground",
  document: "bg-surface-2 text-muted-foreground",
};

const CHANNEL_SIZE = {
  sm: "size-[30px] rounded-[9px] [&_svg]:size-4",
  md: "size-[38px] rounded-[11px] [&_svg]:size-[18px]",
  xl: "size-[72px] rounded-[18px] [&_svg]:size-8",
} as const;

/** A channel's colored icon square. */
export function ChannelIcon({
  icon,
  color,
  size = "md",
  className,
}: {
  icon: string;
  color: ChannelColor;
  size?: keyof typeof CHANNEL_SIZE;
  className?: string;
}) {
  const Icon = CHANNEL_ICON[icon] ?? BookOpen;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center",
        CHANNEL_SIZE[size],
        CHANNEL_COLOR_CLASS[color],
        className,
      )}
      aria-hidden="true"
    >
      <Icon />
    </span>
  );
}

const KIND_SIZE = {
  sm: "size-[30px] rounded-[8px] [&_svg]:size-[15px]",
  md: "size-[34px] rounded-[9px] [&_svg]:size-4",
  lg: "size-11 rounded-xl [&_svg]:size-5",
} as const;

/** The audio / video / slides / document icon square. */
export function KindIcon({
  kind,
  size = "md",
  className,
}: {
  kind: CatalogKind;
  size?: keyof typeof KIND_SIZE;
  className?: string;
}) {
  const Icon = KIND_ICON[kind];
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center",
        KIND_SIZE[size],
        KIND_TONE[kind],
        className,
      )}
      aria-hidden="true"
    >
      <Icon />
    </span>
  );
}
