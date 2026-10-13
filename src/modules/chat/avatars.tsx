import {
  BookOpen,
  Car,
  Coffee,
  GraduationCap,
  Heart,
  Megaphone,
  MessageCircle,
  Rocket,
  Sparkles,
  Star,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { PersonAvatar } from "@/components/brand";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/data";

/** Conversation icons by lucide name (Conversation.icon). */
export const CHAT_ICONS: Record<string, LucideIcon> = {
  megaphone: Megaphone,
  users: Users,
  trophy: Trophy,
  sparkles: Sparkles,
  car: Car,
  "book-open": BookOpen,
  rocket: Rocket,
  star: Star,
  heart: Heart,
  coffee: Coffee,
  "graduation-cap": GraduationCap,
  "message-circle": MessageCircle,
};

/** Icons offered when creating a group. */
export const GROUP_ICON_CHOICES = [
  "users",
  "car",
  "book-open",
  "rocket",
  "star",
  "heart",
  "coffee",
  "graduation-cap",
];

function tone(c: ConversationSummary["conversation"]): string {
  if (c.kind === "announcements") return "bg-event text-event-fg";
  if (c.kind === "main") return "bg-primary text-primary-foreground";
  if (c.icon === "trophy") return "bg-warn-soft text-amber-strong";
  if (c.icon === "sparkles") return "bg-info-soft text-info-ink";
  return "bg-surface-2 text-muted-foreground";
}

const SIZE = {
  sm: { box: "size-8 rounded-[9px]", icon: "size-4", avatar: "md" as const },
  md: { box: "size-10 rounded-xl", icon: "size-[19px]", avatar: "lg" as const },
};

/** The rounded-square chat icon, or the other person's avatar for a DM. */
export function ConversationAvatar({
  summary,
  size = "md",
  className,
}: {
  summary: Pick<ConversationSummary, "conversation" | "other" | "title">;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const s = SIZE[size];
  if (summary.conversation.kind === "dm") {
    return (
      <PersonAvatar
        name={summary.title}
        stage={summary.other?.stage}
        size={s.avatar}
        className={cn(size === "md" && "size-10 text-[13px]", className)}
      />
    );
  }
  const Icon = CHAT_ICONS[summary.conversation.icon ?? ""] ?? MessageCircle;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center",
        s.box,
        tone(summary.conversation),
        className,
      )}
      aria-hidden="true"
    >
      <Icon className={s.icon} />
    </span>
  );
}
