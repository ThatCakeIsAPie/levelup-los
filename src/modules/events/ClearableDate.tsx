import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * A date input with a "Clear" button (not every browser offers one), for the
 * optional attendee dates: plans to buy by, follow-up.
 */
export function ClearableDate({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  /** What the date is, for the clear button's label ("Clear follow-up date"). */
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Input
        id={id}
        type="date"
        className="min-w-0 flex-1"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          aria-label={`Clear ${label}`}
          onClick={() => onChange(undefined)}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
