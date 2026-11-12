/**
 * The event form's category picker: one searchable list of the team's
 * categories, and "+ New category" for people who may plan events (name,
 * icon and the yes/no settings in plain words). Leaders and deputies tidy
 * the list up in Team settings.
 */
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DEFAULT_FLAGS,
  MAX_CATEGORY_NAME,
  addEventCategory,
  categoryChoices,
  categoryNameError,
  categorySummary,
  useAllEventCategories,
  useCanCreateCategories,
  type CategoryFlags,
  type CategoryIcon,
  type EventCategory,
} from "@/data";
import { cn } from "@/lib/utils";
import { CategoryTile } from "./categoryMeta";
import { FlagQuestions, IconPicker } from "./CategoryFields";

export function CategoryPicker({
  id,
  value,
  onChange,
  keepId,
}: {
  id: string;
  value: string;
  onChange: (category: EventCategory) => void;
  /** The event's own category: still offered when it has been archived since. */
  keepId?: string;
}) {
  const all = useAllEventCategories();
  const choices = useMemo(() => categoryChoices(all, keepId), [all, keepId]);
  const canCreate = useCanCreateCategories();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const selected = all.find((c) => c.id === value);

  const pick = (c: EventCategory) => {
    onChange(c);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Category</Label>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-auto min-h-11 w-full justify-between gap-2 px-2.5 py-1.5 font-normal"
          >
            {selected ? (
              <span className="flex min-w-0 items-center gap-2.5 text-left">
                <CategoryTile category={selected} />
                <span className="grid min-w-0">
                  <span className="truncate text-[13.5px] font-semibold">{selected.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {categorySummary(selected)}
                    {selected.archivedAt && " · Archived"}
                  </span>
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">Pick a category</span>
            )}
            <ChevronsUpDown className="size-4 shrink-0 text-faint" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-[240px] p-0"
        >
          <Command>
            <CommandInput
              placeholder="Search categories"
              value={query}
              onValueChange={setQuery}
              aria-label="Search categories"
            />
            <CommandList className="max-h-[min(18rem,45dvh)]">
              <CommandEmpty>No category called that.</CommandEmpty>
              <CommandGroup>
                {choices.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`${c.name} ${c.id}`}
                    keywords={[c.name]}
                    onSelect={() => pick(c)}
                    className="gap-2.5"
                  >
                    <CategoryTile category={c} />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-semibold">{c.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {categorySummary(c)}
                        {c.archivedAt && " · Archived"}
                      </span>
                    </span>
                    <Check
                      className={cn("text-primary", c.id === value ? "opacity-100" : "opacity-0")}
                      aria-hidden="true"
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            {/* Outside the list so it's always in view, however long the list is. */}
            {canCreate && (
              <div className="border-t border-line p-1">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(query.trim());
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm font-semibold text-primary-ink hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <Plus className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {query.trim() ? `New category "${query.trim()}"` : "New category"}
                  </span>
                </button>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
      {creating !== null && (
        <NewCategoryPanel
          initialName={creating}
          categories={all}
          onCancel={() => setCreating(null)}
          onCreated={(c) => {
            setCreating(null);
            onChange(c);
          }}
        />
      )}
    </div>
  );
}

/**
 * "+ New category" inside the event form: a name, an icon and the yes/no
 * settings. Not a nested form: Enter in the name adds the category instead of
 * saving the event.
 */
function NewCategoryPanel({
  initialName,
  categories,
  onCancel,
  onCreated,
}: {
  initialName: string;
  categories: EventCategory[];
  onCancel: () => void;
  onCreated: (c: EventCategory) => void;
}) {
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState<CategoryIcon>("calendar");
  const [flags, setFlags] = useState<CategoryFlags>(DEFAULT_FLAGS);
  const [touched, setTouched] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const error = touched ? (saveError ?? categoryNameError(name, categories)) : null;

  const add = () => {
    setTouched(true);
    if (categoryNameError(name, categories)) return;
    const r = addEventCategory({ name, icon, ...flags });
    if (!r.ok) {
      setSaveError(r.error);
      return;
    }
    onCreated(r.category);
  };

  return (
    <div
      role="group"
      aria-labelledby="new-cat-title"
      className="mt-1 grid gap-3 rounded-lg border border-line bg-surface-2 p-3"
    >
      <p id="new-cat-title" className="text-[13px] font-bold">
        New category
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="new-cat-name">Name</Label>
        <Input
          id="new-cat-name"
          autoFocus
          value={name}
          maxLength={MAX_CATEGORY_NAME}
          placeholder="Book club, Couples night…"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? "new-cat-name-err" : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setSaveError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="bg-surface"
        />
        {error && (
          <p id="new-cat-name-err" className="text-xs text-bad">
            {error}
          </p>
        )}
      </div>
      <IconPicker value={icon} onChange={setIcon} />
      <FlagQuestions value={flags} onChange={(p) => setFlags((f) => ({ ...f, ...p }))} quickOnly />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="soft" size="sm" onClick={add}>
          Add category
        </Button>
      </div>
    </div>
  );
}
