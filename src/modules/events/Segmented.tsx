import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/**
 * Pill-style segmented control (the mockup's ".seg"): one value at a time,
 * clicking the active option does not clear it unless `allowEmpty`.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  allowEmpty,
  disabled,
  className,
  size = "md",
}: {
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
  label: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <ToggleGroup
      type="single"
      aria-label={label}
      value={value ?? ""}
      disabled={disabled}
      onValueChange={(v) => {
        if (!v && !allowEmpty) return;
        onChange((v || undefined) as T | undefined);
      }}
      className={cn("inline-flex w-full gap-0.5 rounded-lg bg-surface-2 p-0.5", className)}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className={cn(
            "flex-1 rounded-md px-2 font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-2 data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm",
            size === "sm" ? "h-7 text-xs" : "h-8 text-[12.5px]",
          )}
        >
          {o.icon && <o.icon className="size-3.5" />}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
