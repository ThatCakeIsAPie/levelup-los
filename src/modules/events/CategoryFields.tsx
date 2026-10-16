/**
 * The pieces of a category form, shared by the event form's "+ New category"
 * and Team settings' "Event categories" card: icon and color pickers and the
 * yes/no settings in plain words.
 */
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CATEGORY_ICONS,
  CATEGORY_QUESTIONS,
  CATEGORY_TONES,
  type CategoryFlags,
  type CategoryIcon,
  type CategoryTone,
} from "@/data";
import { cn } from "@/lib/utils";
import {
  CATEGORY_ICON,
  CATEGORY_ICON_LABEL,
  CATEGORY_TONE_LABEL,
  categoryToneClass,
} from "./categoryIcons";

/** The curated icons as a grid of toggle buttons (one picked). */
export function IconPicker({
  value,
  tone,
  onChange,
  label = "Icon",
}: {
  value: CategoryIcon;
  tone?: CategoryTone;
  onChange: (icon: CategoryIcon) => void;
  label?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <span id={id} className="text-sm font-medium">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-1">
        {CATEGORY_ICONS.map((key) => {
          const Icon = CATEGORY_ICON[key];
          const on = key === value;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={CATEGORY_ICON_LABEL[key]}
              onClick={() => onChange(key)}
              className={cn(
                "grid size-8 place-items-center rounded-md border border-line text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                on && cn("border-transparent ring-2 ring-primary", categoryToneClass({ tone })),
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The color tones as round swatches (one picked). */
export function TonePicker({
  value,
  onChange,
}: {
  value: CategoryTone;
  onChange: (tone: CategoryTone) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <span id={id} className="text-sm font-medium">
        Color
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {CATEGORY_TONES.map((tone) => {
          const on = tone === value;
          return (
            <button
              key={tone}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(tone)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-2.5 text-[12.5px] font-semibold focus-visible:outline-2 focus-visible:outline-ring",
                categoryToneClass({ tone }),
                on && "border-transparent ring-2 ring-primary",
              )}
            >
              {CATEGORY_TONE_LABEL[tone]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The yes/no settings as switches with a plain question and a hint. */
export function FlagQuestions({
  value,
  onChange,
  quickOnly,
  disabled,
}: {
  value: CategoryFlags;
  onChange: (patch: Partial<CategoryFlags>) => void;
  /** Only the questions asked when adding from the event form. */
  quickOnly?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid">
      {CATEGORY_QUESTIONS.filter((q) => !quickOnly || q.quick).map((q) => {
        const sid = `${id}-${q.flag}`;
        return (
          <div
            key={q.flag}
            className="flex items-start gap-3 border-t border-line py-2 first:border-t-0 first:pt-0"
          >
            <div className="min-w-0 flex-1">
              <Label htmlFor={sid} className="text-[13px] font-semibold leading-snug">
                {q.question}
              </Label>
              <p id={`${sid}-hint`} className="text-xs text-muted-foreground">
                {q.hint}
              </p>
            </div>
            <Switch
              id={sid}
              className="mt-0.5"
              checked={value[q.flag]}
              disabled={disabled}
              aria-describedby={`${sid}-hint`}
              onCheckedChange={(on) => onChange({ [q.flag]: on })}
            />
          </div>
        );
      })}
    </div>
  );
}
