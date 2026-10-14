import type { ReactNode } from "react";
import { useIsDesktop } from "@/components/brand";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Side sheet on desktop, bottom sheet on phones (like the Log sheet), with a
 * scrolling body and a fixed footer for the actions.
 */
export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer: ReactNode;
  wide?: boolean;
}) {
  const desktop = useIsDesktop();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn(
          "flex flex-col gap-0 p-0",
          desktop
            ? cn("w-full", wide ? "sm:max-w-lg" : "sm:max-w-md")
            : "max-h-[92dvh] rounded-t-card pb-safe",
        )}
      >
        <SheetHeader className="border-b border-line px-5 pt-5 pb-3 text-left">
          {!desktop && (
            <span className="mx-auto mb-2 h-1 w-10 rounded-full bg-track" aria-hidden="true" />
          )}
          <SheetTitle className="text-base font-extrabold">{title}</SheetTitle>
          {description && <SheetDescription className="text-xs">{description}</SheetDescription>}
        </SheetHeader>
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-4">
          {children}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
          {footer}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Label + control + optional hint. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-[12.5px] font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Red list of validation problems. */
export function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <ul role="alert" className="grid gap-0.5 rounded-lg bg-bad-soft px-3 py-2 text-[12px] text-bad">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}
