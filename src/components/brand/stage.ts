import type { BizClass } from "@/stores/peopleStore";

/** Display label per stage. */
export const STAGE_LABEL: Record<BizClass, string> = {
  prospect: "Prospect",
  apprentice: "Apprentice",
  ibo: "IBO",
  customer: "Customer",
};

/** Chip / avatar colors per stage (IBO is a solid navy chip; others are soft). */
export const STAGE_CHIP_CLASS: Record<BizClass, string> = {
  ibo: "bg-stage-ibo text-stage-ibo-fg",
  apprentice: "bg-stage-apprentice-soft text-stage-apprentice-ink",
  prospect: "bg-stage-prospect-soft text-stage-prospect-ink",
  customer: "bg-stage-customer-soft text-stage-customer-ink",
};

/** Solid fill per stage, for bars, dots and legends. */
export const STAGE_SOLID_CLASS: Record<BizClass, string> = {
  ibo: "bg-stage-ibo",
  apprentice: "bg-stage-apprentice",
  prospect: "bg-stage-prospect",
  customer: "bg-stage-customer",
};

/** Semantic tones shared by ToneChip and ActionRow icons. */
export type Tone = "good" | "warn" | "bad" | "info" | "neutral";
/** ActionRow icon tones: the semantic tones plus the teal "primary" tint. */
export type IconTone = Tone | "primary";

export const TONE_CLASS: Record<IconTone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn-ink",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info-ink",
  neutral: "bg-surface-2 text-muted-foreground",
  primary: "bg-primary-soft text-primary-ink",
};

/** "Maria Reyes" -> "MR"; single names give one letter. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}
