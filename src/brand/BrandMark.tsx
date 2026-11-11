/**
 * The brand mark as a bare SVG: a small sponsorship tree, one node on top
 * linked to two below. It fills the box the caller gives it
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
      <path
        d="M12 5.5 5.5 18.5M12 5.5l6.5 13"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        style={{ stroke: "var(--brand-mark-ring)" }}
      />
      <circle cx="12" cy="5.5" r="3.5" style={{ fill: "var(--brand-mark-accent)" }} />
      <circle cx="5.5" cy="18.5" r="3.2" style={{ fill: "var(--brand-mark-ring)" }} />
      <circle cx="18.5" cy="18.5" r="3.2" style={{ fill: "var(--brand-mark-ring)" }} />
    </svg>
  );
}
