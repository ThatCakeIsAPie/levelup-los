import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_CHECK_IN_MONTHS,
  MIN_CHECK_IN_MONTHS,
  setCheckInMonths,
  useCheckInSettings,
  validCheckInMonths,
  type CheckInMonths,
} from "@/data";

const FIELDS: { key: keyof CheckInMonths; label: string }[] = [
  { key: "hot", label: "Hot" },
  { key: "warm", label: "Warm" },
  { key: "cold", label: "Cold" },
  { key: "notInterested", label: "Not interested" },
];

/**
 * "Prospect check-ins" in the Today card's reminder settings: how many months
 * before a prospect shows up in Today, by their rating (and for Not
 * interested). Yours until you reset; if you never set them you use the
 * nearest upline's, and your team uses these until they set their own.
 */
export function ProspectCheckInSettings() {
  const view = useCheckInSettings();
  const { months } = view;
  const save = (patch: Partial<CheckInMonths>) => setCheckInMonths({ ...months, ...patch });
  const reset = () => {
    setCheckInMonths(null);
    toast.success(
      view.inherited.from
        ? `Using ${view.inherited.from}'s check-ins`
        : "Using the default check-ins",
    );
  };
  const whose = view.own
    ? "Your own."
    : view.from
      ? `Using ${view.from}'s.`
      : "Using the defaults.";
  return (
    <section className="grid gap-2.5 border-t border-line pt-3" aria-labelledby="today-checkins">
      <div>
        <p id="today-checkins" className="text-sm font-bold">
          Prospect check-ins
        </p>
        <p className="text-[12.5px] text-muted-foreground">
          A prospect shows up in Today after this many months without contact. No rating counts as
          Warm; Not interested overrides the rating.
        </p>
      </div>
      {FIELDS.map(({ key, label }) => (
        <MonthsField
          key={`${key}-${months[key]}`}
          id={`today-checkin-${key}`}
          label={label}
          value={months[key]}
          onCommit={(n) => save({ [key]: n })}
        />
      ))}
      <p className="text-[12.5px] text-muted-foreground" data-testid="checkin-whose">
        {whose} Your team uses these until they set their own.
      </p>
      {view.own && (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={reset}>
          {view.inherited.from ? `Use ${view.inherited.from}'s` : "Use defaults"}
        </Button>
      )}
    </section>
  );
}

/** Whole months 1–36; saved when you leave the field or press Enter. */
function MonthsField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const n = Number(text);
  const bad = text.trim() === "" || !validCheckInMonths(n);
  const commit = () => {
    if (!bad && n !== value) onCommit(n);
    else if (bad) setText(String(value));
  };
  return (
    <div className="grid gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_72px_auto] items-center gap-2">
        <Label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </Label>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={MIN_CHECK_IN_MONTHS}
          max={MAX_CHECK_IN_MONTHS}
          className="h-8"
          value={text}
          aria-invalid={bad && text !== String(value) ? true : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <span className="text-[12.5px] text-muted-foreground">months</span>
      </div>
      {bad && text !== String(value) && (
        <p className="text-[12px] text-bad">
          Use a whole number from {MIN_CHECK_IN_MONTHS} to {MAX_CHECK_IN_MONTHS}.
        </p>
      )}
    </div>
  );
}
