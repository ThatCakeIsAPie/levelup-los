import type { ComponentType, ReactNode } from "react";
import type { BizClass } from "@/stores/peopleStore";
import { cn } from "@/lib/utils";
import { STAGE_CHIP_CLASS, STAGE_LABEL, TONE_CLASS, initials, type Tone } from "./stage";

const CHIP =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold leading-[1.45] [&_svg]:size-3 [&_svg]:shrink-0";

/** Stage pill: "Prospect" (sky), "Apprentice" (teal), "IBO" (solid navy), "Customer" (amber). */
export function StageChip({ stage, className }: { stage: BizClass; className?: string }) {
  return <span className={cn(CHIP, STAGE_CHIP_CLASS[stage], className)}>{STAGE_LABEL[stage]}</span>;
}

/** Status pill in a semantic tone, with an optional leading lucide icon. */
export function ToneChip({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: Tone;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(CHIP, TONE_CLASS[tone], className)}>
      {Icon && <Icon aria-hidden="true" />}
      {children}
    </span>
  );
}

const AVATAR_SIZE = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-11 text-sm",
  xl: "size-[68px] text-[22px]",
} as const;

/** Round initials avatar colored by stage (neutral when no stage is given). */
export function PersonAvatar({
  name,
  stage,
  size = "md",
  className,
}: {
  name: string;
  stage?: BizClass;
  size?: keyof typeof AVATAR_SIZE;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-bold",
        AVATAR_SIZE[size],
        stage ? STAGE_CHIP_CLASS[stage] : "bg-surface-2 text-muted-foreground",
        className,
      )}
      aria-hidden="true"
      title={name}
    >
      {initials(name)}
    </span>
  );
}
