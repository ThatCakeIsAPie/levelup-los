import { cn } from "@/lib/utils";

const SIZES = {
  sm: { box: "h-4 gap-[1.5px]", bar: "w-[5px]", h: ["h-[7px]", "h-[11px]", "h-4"] },
  md: { box: "h-5 gap-[2px]", bar: "w-1.5", h: ["h-[9px]", "h-[14px]", "h-5"] },
  lg: { box: "h-8 gap-[3px]", bar: "w-2.5", h: ["h-[14px]", "h-[22px]", "h-8"] },
} as const;

/**
 * LevelUp LOS mark: three rising bars (navy-ish, teal, sky). Set `wordmark`
 * to add "LevelUp LOS" (and `tagline` for "LTD · LevelUp team"); the wordmark
 * inherits the current text color, so it works on the navy sidebar and on cards.
 */
export function Logo({
  size = "md",
  wordmark = false,
  tagline = false,
  className,
}: {
  size?: keyof typeof SIZES;
  wordmark?: boolean;
  tagline?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  const mark = (
    <span className={cn("inline-flex shrink-0 items-end", s.box)} aria-hidden="true">
      <i className={cn("block rounded-[1.5px] bg-logo-1", s.bar, s.h[0])} />
      <i className={cn("block rounded-[1.5px] bg-logo-2", s.bar, s.h[1])} />
      <i className={cn("block rounded-[1.5px] bg-sky", s.bar, s.h[2])} />
    </span>
  );
  if (!wordmark) {
    return (
      <span className={cn("inline-flex", className)} role="img" aria-label="LevelUp LOS">
        {mark}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {mark}
      <span className="leading-tight">
        <span className="block text-[15px] font-extrabold tracking-tight">LevelUp LOS</span>
        {tagline && (
          <span className="block text-[10.5px] font-medium tracking-wide opacity-75">
            LTD · LevelUp team
          </span>
        )}
      </span>
    </span>
  );
}
