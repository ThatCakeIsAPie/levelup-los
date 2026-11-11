/**
 * The brand mark as a bare SVG. It fills the box the caller gives it
 * (`size-4`, `size-6`, `size-48 lg:size-[30rem]`, ...) and keeps its own aspect
 * ratio inside, so the mark does not have to be square. Colours come from
 * `--brand-mark-*` in tokens.css; never reference src/styles.css here.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ? `shrink-0 ${className}` : "shrink-0"}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10.6"
        fill="none"
        strokeWidth="2.2"
        style={{ stroke: "var(--brand-mark-ring)" }}
      />
      <path d="M12 4.9 17.3 11H6.7Z" style={{ fill: "var(--brand-mark-accent)" }} />
      <path d="M6.7 13h10.6L12 19.1Z" style={{ fill: "var(--brand-mark-ring)" }} />
    </svg>
  );
}
