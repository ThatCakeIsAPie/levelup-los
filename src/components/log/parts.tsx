import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { daysSince, type CrmPerson, type PodcastUnit, type ReadingUnit } from "@/data";

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-semibold">
        {label}
      </Label>
      {children}
    </div>
  );
}

export function PersonSelect({
  people,
  value,
  onChange,
  placeholder,
  ages,
  label,
}: {
  people: CrmPerson[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  ages: Map<string, string>;
  label?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label ?? placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {people.map((p) => {
          const age = daysSince(ages.get(p.id));
          return (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {age === null ? "never" : age === 0 ? "today" : `${age}d ago`}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/** Most overdue first, then by name. */
export function byStaleness(ages: Map<string, string>) {
  return (a: CrmPerson, b: CrmPerson) => {
    const da = ages.get(a.id) ?? "";
    const db = ages.get(b.id) ?? "";
    return da === db ? a.name.localeCompare(b.name) : da.localeCompare(db);
  };
}

export interface Option<T extends string> {
  value: T;
  label: string;
  hint: string;
  icon: LucideIcon;
}

/** Two-column grid of big choice tiles (the Log sheet's steps). */
export function OptionGrid<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Option<T>[];
  value?: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === undefined ? undefined : on}
            onClick={() => onChange(o.value)}
            className={cn(
              "grid content-start gap-0.5 rounded-xl border border-line px-2.5 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring",
              on && "border-primary bg-primary-soft text-primary-ink hover:bg-primary-soft",
            )}
          >
            <span className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
              <o.icon className="size-4 shrink-0" aria-hidden="true" />
              {o.label}
            </span>
            {o.hint}
          </button>
        );
      })}
    </div>
  );
}

export const READING_UNITS: { value: ReadingUnit; label: string }[] = [
  { value: "minutes", label: "Minutes" },
  { value: "pages", label: "Pages" },
  { value: "chapters", label: "Chapters" },
];

export const PODCAST_UNITS: { value: PodcastUnit; label: string }[] = [
  { value: "minutes", label: "Minutes" },
  { value: "episodes", label: "Episodes" },
];

/** Small segmented control for picking how something is measured. */
export function UnitToggle<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-surface-2 p-1"
      role="group"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
            value === o.value && "bg-surface text-foreground shadow-sm",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
