import { cn } from "@/lib/utils";

const SIZES = { sm: "size-4", md: "size-6", lg: "size-9" } as const;

/**
 * LevelUp Leadership mark: a grey ring holding a green up-arrow over a grey
 * down-arrow. Set `wordmark` to add "LevelUp LOS" in the typewriter face (and
 * `tagline` for "LevelUp Leadership · LTD"); the wordmark inherits the current
 * text color, so it works on the charcoal sidebar and on cards.
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
  const mark = <LogoMark className={SIZES[size]} />;
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
        <span className="block font-wordmark text-[17px] tracking-[0.01em]">LevelUp LOS</span>
        {tagline && (
          <span className="block text-[10.5px] font-medium tracking-wide opacity-75">
            LevelUp Leadership · LTD
          </span>
        )}
      </span>
    </span>
  );
}

/** The bare mark as an SVG (scales with its box). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("shrink-0", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="10.6" fill="none" className="stroke-logo-ring" strokeWidth="2.2" />
      <path d="M12 4.9 17.3 11H6.7Z" className="fill-sky" />
      <path d="M6.7 13h10.6L12 19.1Z" className="fill-logo-ring" />
    </svg>
  );
}
