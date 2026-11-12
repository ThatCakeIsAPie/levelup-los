/**
 * Team settings › Event categories (leaders and their deputies): rename,
 * change the icon, color and settings, reorder (drag, or arrow keys on the
 * handle), add, archive (with Undo) and merge one into another. Archived
 * categories stay on old events and can be brought back.
 */
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  ChevronDown,
  GitMerge,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react";
import { SectionCard } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastWithUndo } from "@/components/log/quickLog";
import {
  DEFAULT_FLAGS,
  MAX_CATEGORY_NAME,
  addEventCategory,
  archiveEventCategory,
  categoryNameError,
  categorySummary,
  mergeEventCategories,
  reorderEventCategories,
  restoreEventCategory,
  updateEventCategory,
  useAllEventCategories,
  useCanEditCategories,
  useCategoryEventCounts,
  type CategoryFlags,
  type CategoryIcon,
  type CategoryTone,
  type EventCategory,
} from "@/data";
import { cn } from "@/lib/utils";
import { ActingForBadge } from "@/modules/settings/TeamSettingsCards";
import { CategoryTile } from "./categoryMeta";
import { FlagQuestions, IconPicker, TonePicker } from "./CategoryFields";

const eventsText = (n: number) => (n === 1 ? "1 event" : `${n} events`);

export function EventCategoriesCard() {
  const canEdit = useCanEditCategories();
  const all = useAllEventCategories();
  const counts = useCategoryEventCounts();
  const active = useMemo(() => all.filter((c) => !c.archivedAt), [all]);
  const archived = useMemo(() => all.filter((c) => c.archivedAt), [all]);
  const [editing, setEditing] = useState<EventCategory | "new" | null>(null);
  const [merging, setMerging] = useState<EventCategory | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  if (!canEdit) return null;

  const archive = (c: EventCategory) => {
    const undo = archiveEventCategory(c.id);
    toastWithUndo(`${c.name} archived`, undo, {
      description: "Its events keep it. Nobody can pick it for new events.",
      undoneMessage: `${c.name} is back`,
    });
  };

  return (
    <SectionCard
      title="Event categories"
      action={
        <Button size="sm" variant="soft" onClick={() => setEditing("new")}>
          <Plus /> Add
        </Button>
      }
    >
      <div className="-mt-1 grid gap-2">
        <p className="text-[12.5px] text-muted-foreground">
          The kinds of events your team runs. People pick one when they plan an event, and its
          settings decide what the event page tracks. Drag to change the order.
        </p>
        <ActingForBadge className="w-fit" />
      </div>
      <CategoryList
        categories={active}
        counts={counts}
        onEdit={setEditing}
        onMerge={setMerging}
        onArchive={archive}
      />
      {archived.length > 0 && (
        <div className="grid gap-1.5">
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="flex w-fit items-center gap-1 rounded-sm text-[12.5px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronDown
              className={cn("size-4 transition-transform", showArchived && "rotate-180")}
              aria-hidden="true"
            />
            Archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="grid gap-1.5" aria-label="Archived categories">
              {archived.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-line p-1.5 pl-2.5"
                >
                  <CategoryTile category={c} className="opacity-70" />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-sm font-semibold text-muted-foreground">
                      {c.name}
                    </span>
                    <span className="truncate text-xs text-faint">
                      {eventsText(counts.get(c.id) ?? 0)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const error = restoreEventCategory(c.id);
                      if (error) toast.error(error);
                      else toast.success(`${c.name} is back`);
                    }}
                  >
                    <RotateCcw /> Bring back
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <CategoryDialog
        category={editing}
        categories={all}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <MergeDialog
        from={merging}
        categories={active}
        counts={counts}
        onOpenChange={(o) => !o && setMerging(null)}
      />
    </SectionCard>
  );
}

/**
 * The active categories, one compact row each: grip (drag, or arrow keys) ·
 * icon · name and settings · edit · more (merge, archive). The new order is
 * saved when the drag ends.
 */
function CategoryList({
  categories,
  counts,
  onEdit,
  onMerge,
  onArchive,
}: {
  categories: EventCategory[];
  counts: Map<string, number>;
  onEdit: (c: EventCategory) => void;
  onMerge: (c: EventCategory) => void;
  onArchive: (c: EventCategory) => void;
}) {
  const rows = useRef(new Map<string, HTMLLIElement>());
  const [dragging, setDragging] = useState<string | null>(null);
  // While dragging, the order lives here; it's saved on release.
  const [order, setOrder] = useState<string[] | null>(null);
  const [announce, setAnnounce] = useState("");
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const ids = order ?? categories.map((c) => c.id);
  const list = ids.map((id) => byId.get(id)).filter((c): c is EventCategory => !!c);

  const moveTo = (id: string, to: number, current: string[]) => {
    const from = current.indexOf(id);
    if (from < 0 || to < 0 || to >= current.length || to === from) return null;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, id);
    setAnnounce(`${byId.get(id)?.name} moved to position ${to + 1} of ${current.length}.`);
    return next;
  };

  /** The slot under the pointer: how many other rows have their middle above it. */
  const slotAt = (id: string, y: number) =>
    ids.filter((other) => {
      if (other === id) return false;
      const r = rows.current.get(other)?.getBoundingClientRect();
      return !!r && y > r.top + r.height / 2;
    }).length;

  const finish = () => {
    if (order) reorderEventCategories(order);
    setOrder(null);
    setDragging(null);
  };

  if (!list.length)
    return (
      <p className="text-[12.5px] text-muted-foreground">
        No categories yet. Add one so people can plan events.
      </p>
    );

  return (
    <>
      <ul className="grid gap-1.5" aria-label="Event categories, in order">
        {list.map((c, i) => (
          <li
            key={c.id}
            ref={(el) => {
              if (el) rows.current.set(c.id, el);
              else rows.current.delete(c.id);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border border-line bg-surface p-1",
              dragging === c.id && "relative z-10 shadow-md ring-2 ring-ring",
            )}
          >
            <button
              type="button"
              className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-faint hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
              aria-label={`Move ${c.name}, ${i + 1} of ${list.length}. Use the up and down arrow keys.`}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const next = moveTo(c.id, i + (e.key === "ArrowUp" ? -1 : 1), ids);
                  if (next) reorderEventCategories(next);
                }
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                // Keep getting moves while the pointer leaves the handle.
                e.currentTarget.setPointerCapture?.(e.pointerId);
                setDragging(c.id);
                setOrder(ids);
              }}
              onPointerMove={(e) => {
                if (dragging !== c.id) return;
                const next = moveTo(c.id, slotAt(c.id, e.clientY), ids);
                if (next) setOrder(next);
              }}
              onPointerUp={finish}
              onPointerCancel={finish}
            >
              <GripVertical className="size-4" aria-hidden="true" />
            </button>
            <CategoryTile category={c} />
            <span className="grid min-w-0 flex-1 pl-1">
              <span className="truncate text-sm font-semibold">{c.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {categorySummary(c)} · {eventsText(counts.get(c.id) ?? 0)}
              </span>
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              aria-label={`Edit ${c.name}`}
              onClick={() => onEdit(c)}
            >
              <Pencil />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0"
                  aria-label={`More for ${c.name}`}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onMerge(c)} disabled={list.length < 2}>
                  <GitMerge /> Merge into another…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onArchive(c)}>
                  <Archive /> Archive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </>
  );
}

/** Add (`"new"`) or edit a category: name, icon, color and every setting. */
function CategoryDialog({
  category,
  categories,
  onOpenChange,
}: {
  category: EventCategory | "new" | null;
  categories: EventCategory[];
  onOpenChange: (open: boolean) => void;
}) {
  // Keep the form while the dialog animates closed.
  const [last, setLast] = useState(category);
  if (category !== null && category !== last) setLast(category);
  const shown = category ?? last;
  return (
    <Dialog open={category !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-card">
        {shown !== null && (
          <CategoryForm
            key={shown === "new" ? "new" : shown.id}
            category={shown === "new" ? undefined : shown}
            categories={categories}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  category,
  categories,
  onDone,
}: {
  category?: EventCategory;
  categories: EventCategory[];
  onDone: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState<CategoryIcon>(category?.icon ?? "calendar");
  const [tone, setTone] = useState<CategoryTone>(category?.tone ?? "neutral");
  const [flags, setFlags] = useState<CategoryFlags>(() =>
    category
      ? {
          allowsVirtual: category.allowsVirtual,
          usesTickets: category.usesTickets,
          usesTravel: category.usesTravel,
          countsForMissed: category.countsForMissed,
          welcomesCustomers: category.welcomesCustomers,
        }
      : DEFAULT_FLAGS,
  );
  const [touched, setTouched] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const nameError = touched
    ? (saveError ?? categoryNameError(name, categories, category?.id))
    : null;

  const save = () => {
    setTouched(true);
    if (categoryNameError(name, categories, category?.id)) return;
    if (category) {
      const error = updateEventCategory(category.id, { name, icon, tone, ...flags });
      if (error) return setSaveError(error);
      toast.success(`${name.trim()} saved`);
    } else {
      const r = addEventCategory({ name, icon, tone, ...flags });
      if (!r.ok) return setSaveError(r.error);
      toast.success(`${r.category.name} added`);
    }
    onDone();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <DialogHeader className="text-left">
        <DialogTitle>{category ? `Edit ${category.name}` : "New event category"}</DialogTitle>
        <DialogDescription>
          {category
            ? "Changes show on every event in this category, past and upcoming."
            : "Everyone on the team can pick it when they plan an event."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="cat-name">Name</Label>
        <Input
          id="cat-name"
          value={name}
          maxLength={MAX_CATEGORY_NAME}
          placeholder="Book club, Couples night…"
          aria-invalid={!!nameError || undefined}
          aria-describedby={nameError ? "cat-name-err" : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setSaveError(null);
          }}
        />
        {nameError && (
          <p id="cat-name-err" className="text-xs text-bad">
            {nameError}
          </p>
        )}
      </div>
      <IconPicker value={icon} tone={tone} onChange={setIcon} />
      <TonePicker value={tone} onChange={setTone} />
      <FlagQuestions value={flags} onChange={(p) => setFlags((f) => ({ ...f, ...p }))} />
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">{category ? "Save" : "Add category"}</Button>
      </DialogFooter>
    </form>
  );
}

/** Merge one category into another: confirm, with what happens to the events. */
function MergeDialog({
  from,
  categories,
  counts,
  onOpenChange,
}: {
  from: EventCategory | null;
  categories: EventCategory[];
  counts: Map<string, number>;
  onOpenChange: (open: boolean) => void;
}) {
  const [into, setInto] = useState("");
  // Keep what was shown while the dialog animates closed (after a merge the
  // category has no events left, and `from` is already cleared).
  const [shown, setShown] = useState<{ from: EventCategory; n: number } | null>(null);
  if (from && shown?.from !== from) setShown({ from, n: counts.get(from.id) ?? 0 });
  const source = from ?? shown?.from;
  const n = shown?.n ?? 0;
  const targets = categories.filter((c) => c.id !== source?.id);
  const target = targets.find((c) => c.id === into);
  const losesOnline = !!source?.allowsVirtual && !!target && !target.allowsVirtual;

  return (
    <AlertDialog
      open={!!from}
      onOpenChange={(o) => {
        if (!o) setInto("");
        onOpenChange(o);
      }}
    >
      <AlertDialogContent className="w-[calc(100%-2rem)] rounded-card">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle>Merge {source?.name} into another category</AlertDialogTitle>
          <AlertDialogDescription>
            {n === 0
              ? `${source?.name} has no events. It's archived once merged.`
              : `${n === 1 ? "Its 1 event moves" : `All ${n} of its events move`} over, with their attendance and follow-ups. Then ${source?.name} is archived. This can't be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="merge-into">Merge into</Label>
          <Select value={into} onValueChange={setInto}>
            <SelectTrigger id="merge-into">
              <SelectValue placeholder="Pick a category" />
            </SelectTrigger>
            <SelectContent>
              {targets.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {target && (
            <p className="text-xs text-muted-foreground">
              They'll follow {target.name}'s settings: {categorySummary(target).toLowerCase()}.
              {losesOnline && " Events set to online become in person."}
            </p>
          )}
        </div>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!target}
            onClick={() => {
              if (!from || !target) return;
              const r = mergeEventCategories(from.id, target.id);
              if (!r.ok) toast.error(r.error);
              else
                toast.success(
                  `${from.name} merged into ${target.name}${r.moved ? ` · ${eventsText(r.moved)} moved` : ""}`,
                );
              setInto("");
            }}
          >
            Merge
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
