import { brand, BrandMark } from "@/brand";
import { cn } from "@/lib/utils";

const SIZES = { sm: "size-4", md: "size-6", lg: "size-9" } as const;

/**
 * The brand mark; set `wordmark` to add the app name in the wordmark face (and
 * `tagline` for the org line, when the brand has one). The wordmark inherits
 * the current text color, so it works on the dark sidebar and on cards. The
 * mark itself, name and org line come from src/brand.
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
  const mark = <BrandMark className={SIZES[size]} />;
  if (!wordmark) {
    return (
      <span className={cn("inline-flex", className)} role="img" aria-label={brand.name}>
        {mark}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {mark}
      <span className="leading-tight">
        <span className="block font-wordmark text-[17px] tracking-[0.01em]">{brand.wordmark}</span>
        {tagline && brand.orgLine && (
          <span className="block text-[10.5px] font-medium tracking-wide opacity-75">
            {brand.orgLine}
          </span>
        )}
      </span>
    </span>
  );
}

/** The bare mark (alias of BrandMark, kept so existing imports work). */
export { BrandMark as LogoMark };
