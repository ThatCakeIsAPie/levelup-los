import { useState } from "react";
import { Flame, Plus, Save, Thermometer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toastWithUndo } from "@/components/log/quickLog";
import { cn } from "@/lib/utils";
import {
  MAX_ENTRY_NAME,
  MAX_ENTRY_NOTES,
  MAX_HOW_KNOWN,
  NEW_CONTACT,
  NOT_CONTACTED,
  addCustomerContact,
  addListEntry,
  updateListEntry,
  useListOwners,
  useListEntry,
  type ListRating,
} from "@/data";

/** Where "Add someone" can put a new name on the board. */
const START_IN = [
  { id: NEW_CONTACT, label: "New contacts (met them just now)" },
  { id: NOT_CONTACTED, label: "Not contacted yet (on your list)" },
  { id: "contact", label: "Contact (already reached out)" },
  { id: "first_meeting", label: "First meeting (already met)" },
];

export type EntryDialogMode =
  { kind: "list"; ownerId: string } | { kind: "board" } | { kind: "edit"; entryId: string };

/**
 * Add names to a list (yours or a downline's), add someone straight onto the
 * board ("Add someone": New contacts by default), or edit a name.
 */
export function ListEntryDialog({
  mode,
  onOpenChange,
}: {
  mode: EntryDialogMode | null;
  onOpenChange: (open: boolean) => void;
}) {
  const title =
    mode?.kind === "edit" ? "Edit name" : mode?.kind === "board" ? "Add someone" : "Add names";
  const description =
    mode?.kind === "board"
      ? "They go on your list and onto the board, in New contacts unless you pick another column."
      : mode?.kind === "list"
        ? "Everyone you know is a name: friends, family, coworkers, neighbors. Only the name is needed."
        : "Changes show for everyone who can see this list.";
  return (
    <Dialog open={!!mode} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {mode && (
          <EntryForm
            key={mode.kind === "edit" ? mode.entryId : mode.kind}
            mode={mode}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({ mode, onDone }: { mode: EntryDialogMode; onDone: () => void }) {
  const owners = useListOwners();
  const existing = useListEntry(mode.kind === "edit" ? mode.entryId : null);
  const [name, setName] = useState(existing?.name ?? "");
  const [howKnown, setHowKnown] = useState(existing?.howKnown ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [rating, setRating] = useState<ListRating | null>(existing?.rating ?? null);
  const [column, setColumn] = useState<string>(NEW_CONTACT);
  const [ownerId, setOwnerId] = useState(
    mode.kind === "list" ? mode.ownerId : (owners.find((o) => o.isMe)?.id ?? ""),
  );
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(0);
  const owner = owners.find((o) => o.id === ownerId);

  const reset = () => {
    setName("");
    setHowKnown("");
    setPhone("");
    setEmail("");
    setNotes("");
    setRating(null);
    setError(null);
  };

  const save = (another: boolean) => {
    const input = { name, howKnown, phone, email, notes, rating };
    if (mode.kind === "edit") {
      const r = updateListEntry(mode.entryId, input);
      if (!r.ok) return setError(r.error);
      onDone();
      return;
    }
    const r =
      mode.kind === "board"
        ? addCustomerContact({ ...input, ownerId, column })
        : addListEntry({ ...input, ownerId });
    if (!r.ok) return setError(r.error);
    const whose = owner && !owner.isMe ? `${owner.name.split(" ")[0]}'s list` : "your list";
    toastWithUndo(
      mode.kind === "board" && column !== NOT_CONTACTED
        ? `${r.entry.name} added to the board`
        : `${r.entry.name} added to ${whose}`,
      r.undo,
      { undoneMessage: "Name removed" },
    );
    if (another) {
      reset();
      setAdded((n) => n + 1);
      document.getElementById("le-name")?.focus();
    } else onDone();
  };

  return (
    <form
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      {mode.kind === "board" && owners.length > 1 && (
        <div className="grid gap-1.5">
          <Label htmlFor="le-owner">Whose list</Label>
          <Select value={ownerId} onValueChange={setOwnerId}>
            <SelectTrigger id="le-owner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {owners.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.isMe ? "Mine" : o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="le-name">Name</Label>
        <Input
          id="le-name"
          autoFocus
          autoComplete="off"
          value={name}
          maxLength={MAX_ENTRY_NAME}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="Their name"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="le-how">How you know them (optional)</Label>
        <Input
          id="le-how"
          value={howKnown}
          maxLength={MAX_HOW_KNOWN}
          onChange={(e) => setHowKnown(e.target.value)}
          placeholder="e.g. Work friend, Gym, Neighbor"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="le-phone">Phone (optional)</Label>
          <Input
            id="le-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="le-email">Email (optional)</Label>
          <Input
            id="le-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
        </div>
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">How warm are they?</legend>
        <RatingPicker value={rating} onChange={setRating} />
      </fieldset>
      {mode.kind === "board" && (
        <div className="grid gap-1.5">
          <Label htmlFor="le-column">Start in</Label>
          <Select value={column} onValueChange={setColumn}>
            <SelectTrigger id="le-column">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {START_IN.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="le-notes">Notes (optional)</Label>
        <Textarea
          id="le-notes"
          value={notes}
          maxLength={MAX_ENTRY_NOTES}
          rows={2}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything worth remembering"
        />
      </div>
      {error && <p className="text-[12.5px] font-semibold text-bad">{error}</p>}
      {added > 0 && (
        <p className="text-[12px] text-muted-foreground" aria-live="polite">
          {added} added so far.
        </p>
      )}
      <DialogFooter className="gap-2">
        {mode.kind === "list" && (
          <Button
            type="button"
            variant="outline"
            disabled={!name.trim()}
            onClick={() => save(true)}
          >
            <Plus /> Save and add another
          </Button>
        )}
        <Button type="submit" disabled={!name.trim()}>
          {mode.kind === "edit" ? (
            <>
              <Save /> Save
            </>
          ) : (
            <>
              <Plus /> {mode.kind === "board" ? "Add to the board" : "Add to the list"}
            </>
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** None / Warm / Hot. */
export function RatingPicker({
  value,
  onChange,
}: {
  value: ListRating | null;
  onChange: (v: ListRating | null) => void;
}) {
  const options: { v: ListRating | null; label: string; icon?: typeof Flame }[] = [
    { v: null, label: "Not sure" },
    { v: "warm", label: "Warm", icon: Thermometer },
    { v: "hot", label: "Hot", icon: Flame },
  ];
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="How warm are they?">
      {options.map((o) => {
        const on = value === o.v;
        const Icon = o.icon;
        return (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.v)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              on
                ? o.v === "hot"
                  ? "border-bad bg-bad-soft text-bad"
                  : o.v === "warm"
                    ? "border-warn bg-warn-soft text-warn-ink"
                    : "border-foreground bg-surface-2 text-foreground"
                : "border-line text-muted-foreground hover:bg-surface-2",
            )}
          >
            {Icon && <Icon className="size-3.5" aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
