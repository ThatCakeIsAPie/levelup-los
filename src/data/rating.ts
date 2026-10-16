/**
 * How warm a new contact is: Hot, Warm or Cold (or not rated, null). One
 * scale for names on a list (`ListEntry.rating`) and prospects on the
 * recruiting board (`PipelineCard.rating`). Pure; the picker and chip are
 * `RatingPicker` / `RatingChip` in @/components/brand.
 */
export type ContactRating = "hot" | "warm" | "cold";

/** Hottest first (the picker's order). */
export const CONTACT_RATINGS: readonly ContactRating[] = ["hot", "warm", "cold"];

export const RATING_LABEL: Record<ContactRating, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
};

/** Sort key: hot, warm, not rated, then cold. */
export function ratingRank(r: ContactRating | null | undefined): number {
  return r === "hot" ? 0 : r === "warm" ? 1 : r === "cold" ? 3 : 2;
}

/** A stored value read leniently (unknown text is "not rated"). */
export function asRating(v: unknown): ContactRating | null {
  return v === "hot" || v === "warm" || v === "cold" ? v : null;
}
