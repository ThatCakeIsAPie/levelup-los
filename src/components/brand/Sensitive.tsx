import type { ReactNode } from "react";
import { sensitive, type SensitiveKind } from "@/lib/sensitive";

/**
 * Inline wrapper for a sensitive value in text (a name, a phone number, a note).
 * It looks and lays out exactly like the text around it; the feedback snapshot
 * paints it as a black bar. See `src/lib/sensitive.ts`.
 */
export function Sensitive({
  kind,
  className,
  children,
}: {
  kind: SensitiveKind;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span className={className} {...sensitive(kind)}>
      {children}
    </span>
  );
}
