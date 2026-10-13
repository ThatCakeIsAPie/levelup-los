import { useMemo, useState, type ReactNode } from "react";
import {
  Kanban,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { EmptyState, PageHeader, PersonAvatar, SectionCard, ToneChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DropdownMenuSeparator,
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  addEntryToRecruiting,
  removeListEntry,
  startListEntry,
  useListOwners,
  useListUpline,
  usePipelineAccess,
  useYourList,
  type ListRow,
} from "@/data";
import { plural } from "@/modules/pipeline/format";
import { ListEntryDialog, type EntryDialogMode } from "./ListEntryDialog";

const PAGE = "grid w-full min-w-0 content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]";
const first = (name: string) => name.split(" ")[0] ?? name;

/**
 * Your list: everyone you could talk to about the products, built with your
 * upline (who sees it and can add names). "Start" moves a name to Contact on
 * the customer pipeline. Uplines can open each downline's list.
 */
export function YourListTab({
  tabs,
  ownerId,
  onOwner,
}: {
  tabs: ReactNode;
  ownerId: string;
  onOwner: (id: string) => void;
}) {
  const owners = useListOwners();
  const list = useYourList(ownerId);
  const upline = useListUpline();
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<EntryDialogMode | null>(null);
  const [removing, setRemoving] = useState<ListRow | null>(null);
  const owner = list.owner;
  const mine = !!owner?.isMe;

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      list.rows.filter(
        (r) =>
          !q ||
          r.entry.name.toLowerCase().includes(q) ||
          r.entry.howKnown?.toLowerCase().includes(q),
      ),
    [list.rows, q],
  );

  const addButton = list.canEdit && (
    <Button size="sm" className="h-9" onClick={() => setDialog({ kind: "list", ownerId })}>
      <Plus /> Add names
    </Button>
  );

  return (
    <div className={PAGE}>
      <PageHeader
        title="Customers"
        subtitle={
          owner
            ? `${mine ? "Your list" : `${owner.name}'s list`} · ${plural(list.rows.length, "name")} · ${list.notContacted} not contacted yet`
            : "Your list"
        }
        actions={
          <>
            {owners.length > 1 && (
              <Select value={ownerId} onValueChange={onOwner}>
                <SelectTrigger
                  className="h-9 w-auto min-w-0 max-w-[13rem] gap-1.5 text-[13px] font-semibold"
                  aria-label="Whose list"
                >
                  <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {owners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.isMe ? "My list" : `${o.name}'s list`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {addButton}
          </>
        }
      />
      {tabs}

      {owner && (
        <p className="flex items-start gap-2 rounded-card bg-primary-soft px-3.5 py-2.5 text-[12.5px] text-primary-ink">
          <Users className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {mine
            ? upline
              ? `${upline} (your upline) can see and add to your list.`
              : "Your list is yours and your team's leaders'. Your downline's lists show here too."
            : `You're looking at ${first(owner.name)}'s list. ${first(owner.name)} sees what you add.`}
        </p>
      )}

      {!owner ? (
        <EmptyState
          icon={<ListChecks />}
          title="That list isn't one you can see"
          body="You can open your own list and the lists of the people on your team."
        />
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={mine ? "Start your list" : `${first(owner.name)}'s list is empty`}
          body="Write down everyone you know: friends, family, coworkers, neighbors, people from the gym or church. Don't judge who'd be interested: just the names."
          action={
            list.canEdit && (
              <Button onClick={() => setDialog({ kind: "list", ownerId })}>
                <Plus /> Add names
              </Button>
            )
          }
        />
      ) : (
        <SectionCard>
          {list.rows.length > 8 && (
            <div className="relative mb-2 max-w-xs">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search names"
                aria-label="Search the list"
                className="pl-9"
              />
            </div>
          )}
          <ul className="grid" aria-label={mine ? "Your list" : `${owner.name}'s list`}>
            {shown.map((r) => (
              <ListItem
                key={r.entry.id}
                row={r}
                canEdit={list.canEdit}
                onEdit={() => setDialog({ kind: "edit", entryId: r.entry.id })}
                onRemove={() => setRemoving(r)}
              />
            ))}
          </ul>
          {shown.length === 0 && (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              No names match &ldquo;{query}&rdquo;.
            </p>
          )}
        </SectionCard>
      )}

      <ListEntryDialog mode={dialog} onOpenChange={(o) => !o && setDialog(null)} />
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.entry.name} from the list?</AlertDialogTitle>
            <AlertDialogDescription>
              They leave the list and the customer board. Past moves still count in the numbers
              {removing?.customer ? ", and they stay a customer" : ""}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing) {
                  removeListEntry(removing.entry.id);
                  toast.success(`${removing.entry.name} removed from the list`);
                }
                setRemoving(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ListItem({
  row,
  canEdit,
  onEdit,
  onRemove,
}: {
  row: ListRow;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const recruiting = usePipelineAccess();
  const e = row.entry;
  const sub = [e.howKnown, e.rating, row.addedByName ? `added by ${row.addedByName}` : null].filter(
    Boolean,
  );
  const start = () => {
    const r = startListEntry(e.id);
    if (r.ok)
      toastWithUndo(`${e.name} moved to Contact`, r.undo, {
        description: "Good luck! Their card is on the Pipeline tab.",
        undoneMessage: "Back on the list",
      });
  };
  return (
    <li className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-line py-2.5 first:border-t-0">
      <PersonAvatar name={e.name} stage={row.customer ? "customer" : "prospect"} />
      <button
        type="button"
        onClick={canEdit ? onEdit : undefined}
        disabled={!canEdit}
        className="min-w-0 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
      >
        <b className="block truncate text-[13px]">{e.name}</b>
        <small className="block truncate text-[11.5px] text-muted-foreground">
          {sub.join(" · ") || " "}
        </small>
      </button>
      <span className="flex items-center gap-1">
        {row.notContacted ? (
          canEdit && (
            <Button size="sm" variant="soft" className="h-8" onClick={start}>
              Start
            </Button>
          )
        ) : (
          <ToneChip
            tone={row.band === "out" ? "neutral" : row.band === "on_ditto" ? "good" : "info"}
            className={cn(row.band === "out" && "text-muted-foreground")}
          >
            {row.column?.label ?? "On the board"}
          </ToneChip>
        )}
        {canEdit && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label={`More for ${e.name}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Edit details
              </DropdownMenuItem>
              {recruiting.enabled && !e.prospectId && (
                <DropdownMenuItem
                  onSelect={() => {
                    const r = addEntryToRecruiting(e.id);
                    if (r)
                      toastWithUndo(`${e.name} is on the recruiting pipeline too`, r.undo, {
                        description: "They start in Contact made.",
                        undoneMessage: "Taken off the recruiting pipeline",
                      });
                  }}
                >
                  <Kanban /> Add to recruiting
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onRemove} className="text-bad focus:text-bad">
                <Trash2 /> Remove from list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </span>
    </li>
  );
}
