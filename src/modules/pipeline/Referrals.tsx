import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Plus, UserPlus, Users, X } from "lucide-react";
import { ActionRow, PersonAvatar, PhoneInput, RatingPicker, StageChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { toastWithUndo } from "@/components/log/quickLog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  NOT_CONTACTED,
  REFERRAL_SOURCE,
  addListEntry,
  addPipelineProspect,
  referredLine,
  setReferredBy,
  useListOwners,
  useReferralIndex,
  useReferrals,
  useReferrerChoices,
  useReferrerOf,
  useCurrentUser,
  useUnlocks,
  type BoardCard,
  type BoardKind,
  type ContactRating,
  type Ref,
  type ReferralContact,
  type ReferralReminder,
  type ReferrerChoice,
} from "@/data";

const LINK =
  "rounded-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring";

const firstName = (name: string) => name.split(" ")[0] ?? name;

// ---------------------------------------------------------------------------
// Board cards
// ---------------------------------------------------------------------------

/**
 * A board card's referral lines: "Referred 2 people" (or "No names yet" in
 * Referral source) and "Referred by Sarah Kim".
 */
export function CardReferralLines({ card }: { card: BoardCard }) {
  const n = card.referrals ?? 0;
  const source = card.cardColumn === REFERRAL_SOURCE;
  if (!card.referredBy && !n && !source) return null;
  return (
    <>
      {(n > 0 || source) && (
        <div
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-[11px] font-semibold",
            n > 0 ? "text-primary-ink" : "text-faint",
          )}
        >
          <Users className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{referredLine(n)}</span>
        </div>
      )}
      {card.referredBy && (
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <UserPlus className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">Referred by {card.referredBy}</span>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

/**
 * "Referred by (optional)": referral sources first, then everyone else the
 * viewer sees. Opens in place (no popup), so it works inside dialogs and
 * sheets on phones.
 */
export function ReferrerPicker({
  id,
  value,
  onChange,
  exclude,
  label = "Referred by (optional)",
  startOpen = false,
  onClose,
}: {
  id: string;
  value: Ref | null;
  onChange: (ref: Ref | null) => void;
  /** The person or name being edited (they can't refer themselves). */
  exclude?: Ref | null;
  label?: string;
  /** Open the list straight away (editing an existing referral). */
  startOpen?: boolean;
  /** "Close" without picking. */
  onClose?: () => void;
}) {
  const index = useReferralIndex();
  const choices = useReferrerChoices();
  const [open, setOpen] = useState(startOpen);
  const [query, setQuery] = useState("");
  const picked = value ? index.contact(value) : null;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Not themselves, nor someone they referred.
    const referredByThem = (c: ReferrerChoice) => {
      const back = index.referrerOf(c.ref);
      return !!exclude && !!back && index.same(back.ref, exclude);
    };
    const ok = choices.filter(
      (c) =>
        (!exclude || !index.same(c.ref, exclude)) &&
        !referredByThem(c) &&
        (!q || c.name.toLowerCase().includes(q)),
    );
    const sources = ok.filter((c) => c.source);
    const rest = ok.filter((c) => !c.source).slice(0, q ? 40 : 12);
    return { sources, rest };
  }, [choices, query, exclude, index]);

  const pick = (ref: Ref | null) => {
    onChange(ref);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-sm font-medium" id={`${id}-label`}>
        {label}
      </span>
      {!open && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {picked ? (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-primary-soft py-1 pl-1 pr-1 text-[12.5px] font-semibold text-primary-ink">
              <PersonAvatar
                name={picked.name}
                stage={picked.bizClass ?? undefined}
                size="sm"
                className="size-5 text-[8px]"
              />
              <span className="truncate">{picked.name}</span>
              <button
                type="button"
                onClick={() => pick(null)}
                aria-label={`Remove ${picked.name} as who referred them`}
                className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-surface focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="size-3" />
              </button>
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-describedby={`${id}-label`}
            onClick={() => setOpen(true)}
          >
            {picked ? "Change" : "Pick who referred them"} <ChevronDown />
          </Button>
        </div>
      )}
      {open && (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <Command shouldFilter={false}>
            <CommandInput
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search names"
              aria-labelledby={`${id}-label`}
            />
            <CommandList className="max-h-56">
              <CommandEmpty>Nobody by that name.</CommandEmpty>
              {shown.sources.length > 0 && (
                <CommandGroup heading="Referral sources">
                  {shown.sources.map((c) => (
                    <ChoiceItem key={`s-${c.ref.kind}-${c.ref.id}`} c={c} onPick={pick} />
                  ))}
                </CommandGroup>
              )}
              {shown.rest.length > 0 && (
                <CommandGroup heading={shown.sources.length ? "Everyone else" : "People"}>
                  {shown.rest.map((c) => (
                    <ChoiceItem key={`p-${c.ref.kind}-${c.ref.id}`} c={c} onPick={pick} />
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
          <div className="flex justify-end border-t border-line px-2 py-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                onClose?.();
              }}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChoiceItem({
  c,
  onPick,
}: {
  c: ReferralContact & { hint: string };
  onPick: (ref: Ref) => void;
}) {
  return (
    <CommandItem value={`${c.ref.kind}:${c.ref.id}`} onSelect={() => onPick(c.ref)}>
      <PersonAvatar name={c.name} stage={c.bizClass ?? undefined} size="sm" />
      <span className="min-w-0 flex-1 truncate">{c.name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{c.hint}</span>
    </CommandItem>
  );
}

// ---------------------------------------------------------------------------
// Card sheets and the profile
// ---------------------------------------------------------------------------

/** A referred contact: their profile when they're a person the viewer sees, else their name. */
function ContactName({ c }: { c: ReferralContact }) {
  return c.personId ? (
    <Link to="/people/$id" params={{ id: c.personId }} className={LINK}>
      {c.name}
    </Link>
  ) : (
    <b className="font-semibold">{c.name}</b>
  );
}

/**
 * "Referred by" (with Change) and, for a referral source or anyone who
 * referred someone, "Referred N people" with "Add someone they referred".
 * Used by both card sheets and the person profile.
 */
export function ReferralsBlock({
  target,
  name,
  ownerId,
  board,
  source,
  className,
}: {
  /** The prospect or customer (person) or the list name (entry). */
  target: Ref;
  name: string;
  /** Whose card: new names they pass on go on this person's board or list. */
  ownerId: string | null;
  /** Which board the card is on (where "Add someone they referred" starts). */
  board: BoardKind;
  /** In the Referral source column now. */
  source: boolean;
  className?: string;
}) {
  const referrer = useReferrerOf(target);
  const referrals = useReferrals(target);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const first = firstName(name);

  const change = (ref: Ref | null) => {
    const r = setReferredBy(target, ref);
    setEditing(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toastWithUndo(ref ? "Referral saved" : "Referral removed", r.undo, {
      undoneMessage: "Referral put back",
    });
  };

  return (
    <section aria-label="Referrals" className={cn("grid min-w-0 gap-2.5 text-[13px]", className)}>
      {editing ? (
        <ReferrerPicker
          id={`ref-${target.kind}-${target.id}`}
          value={referrer?.ref ?? null}
          onChange={change}
          exclude={target}
          label={`Who referred ${first}?`}
          startOpen
          onClose={() => setEditing(false)}
        />
      ) : (
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <UserPlus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {referrer ? (
            <span className="min-w-0">
              Referred by <ContactName c={referrer} />
            </span>
          ) : (
            <span className="text-muted-foreground">Who referred {first}?</span>
          )}
          <button
            type="button"
            className={cn(LINK, "text-[12.5px]")}
            aria-label={`${referrer ? "Change" : "Add"} who referred ${first}`}
            onClick={() => setEditing(true)}
          >
            {referrer ? "Change" : "Add"}
          </button>
        </p>
      )}

      {(source || referrals.length > 0) && (
        <div className="grid gap-2 rounded-card bg-surface-2 px-3.5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b className="inline-flex items-center gap-1.5">
              <Users className="size-4 text-primary-ink" aria-hidden="true" />
              {referredLine(referrals.length)}
            </b>
          </div>
          {source && referrals.length === 0 && (
            <p className="text-[12.5px] text-muted-foreground">
              Ask {first} who they know who&rsquo;d be a good fit. Add each name here and it shows
              &ldquo;Referred by {first}&rdquo;.
            </p>
          )}
          {referrals.length > 0 && (
            <ul className="grid gap-1.5" aria-label={`People ${first} referred`}>
              {referrals.map((c) => (
                <li key={`${c.ref.kind}-${c.ref.id}`} className="flex min-w-0 items-center gap-2">
                  <PersonAvatar name={c.name} stage={c.bizClass ?? "prospect"} size="sm" />
                  <span className="min-w-0 flex-1 truncate">
                    <ContactName c={c} />
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {c.bizClass === "customer"
                      ? "Customer"
                      : c.personId
                        ? c.bizClass === "prospect"
                          ? "Prospect"
                          : "On the team"
                        : "On a list"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {ownerId && (
            <Button
              type="button"
              variant="soft"
              size="sm"
              className="justify-self-start"
              onClick={() => setAdding(true)}
            >
              <Plus /> Add someone {first} referred
            </Button>
          )}
        </div>
      )}
      {ownerId && (
        <AddReferredDialog
          open={adding}
          onOpenChange={setAdding}
          referrer={target}
          referrerName={name}
          ownerId={ownerId}
          board={board}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// "Add someone they referred"
// ---------------------------------------------------------------------------

/**
 * A new name passed on by a referral source, with "Referred by" filled in: on
 * the recruiting board (a prospect, in Not contacted yet) or on the customer
 * list (a name, not contacted yet) of the referral source's owner.
 */
export function AddReferredDialog({
  open,
  onOpenChange,
  referrer,
  referrerName,
  ownerId,
  board,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  referrer: Ref;
  referrerName: string;
  ownerId: string;
  board: BoardKind;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add someone {firstName(referrerName)} referred</DialogTitle>
          <DialogDescription>
            They start in Not contacted yet and show &ldquo;Referred by {referrerName}&rdquo;.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <AddReferredForm
            referrer={referrer}
            referrerName={referrerName}
            ownerId={ownerId}
            board={board}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddReferredForm({
  referrer,
  referrerName,
  ownerId,
  board,
  onDone,
}: {
  referrer: Ref;
  referrerName: string;
  ownerId: string;
  board: BoardKind;
  onDone: () => void;
}) {
  const unlocks = useUnlocks();
  const owners = useListOwners();
  const canRecruit = unlocks.can.pipeline;
  const canList = owners.some((o) => o.id === ownerId);
  const [where, setWhere] = useState<BoardKind>(
    board === "recruiting"
      ? canRecruit
        ? "recruiting"
        : "customer"
      : canList
        ? "customer"
        : "recruiting",
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [rating, setRating] = useState<ContactRating | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(0);
  const owner = owners.find((o) => o.id === ownerId);
  const whose = !owner || owner.isMe ? "your" : `${firstName(owner.name)}'s`;

  const save = (another: boolean) => {
    if (!name.trim()) return;
    let undo: (() => void) | null = null;
    let label = "";
    if (where === "recruiting") {
      const r = addPipelineProspect({
        name,
        phone,
        sponsorId: ownerId,
        column: NOT_CONTACTED,
        rating,
        referredBy: referrer,
      });
      if (!r) return setError("Couldn't add them. Try again.");
      undo = r.undo;
      label = `${r.person.name} added to ${whose} recruiting board`;
    } else {
      const r = addListEntry({ name, phone, ownerId, rating, referredBy: referrer });
      if (!r.ok) return setError(r.error);
      undo = r.undo;
      label = `${r.entry.name} added to ${whose} list`;
    }
    toastWithUndo(label, undo, {
      description: `Referred by ${referrerName}.`,
      undoneMessage: "Name removed",
    });
    if (another) {
      setName("");
      setPhone("");
      setRating(null);
      setError(null);
      setAdded((n) => n + 1);
      document.getElementById("ar-name")?.focus();
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
      {canRecruit && canList && (
        <div className="grid gap-1.5">
          <span className="text-sm font-medium" id="ar-where">
            Where they go
          </span>
          <div role="group" aria-labelledby="ar-where" className="grid grid-cols-2 gap-1.5">
            {(
              [
                ["recruiting", "Recruiting board"],
                ["customer", "Customer list"],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                aria-pressed={where === value}
                onClick={() => setWhere(value)}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  where === value
                    ? "border-primary bg-primary-soft text-primary-ink"
                    : "border-line text-muted-foreground hover:bg-surface-2",
                )}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="ar-name">Name</Label>
        <Input
          id="ar-name"
          autoFocus
          autoComplete="off"
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="Their name"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ar-phone">Phone (optional)</Label>
        <PhoneInput id="ar-phone" value={phone} onValueChange={setPhone} />
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">How warm are they? (optional)</span>
        <RatingPicker value={rating} onChange={setRating} />
      </div>
      {error && (
        <p className="text-[12.5px] font-semibold text-bad" role="alert">
          {error}
        </p>
      )}
      {added > 0 && (
        <p className="text-[12px] text-muted-foreground" aria-live="polite">
          {added} added so far.
        </p>
      )}
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" disabled={!name.trim()} onClick={() => save(true)}>
          <Plus /> Save and add another
        </Button>
        <Button type="submit" disabled={!name.trim()}>
          <UserPlus /> Add
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Home: "Ask Sarah for names"
// ---------------------------------------------------------------------------

/**
 * A Today row for a referral source of the viewer's with nobody referred
 * after a week: "Ask Hector for names", with "Add names" (the same dialog as
 * the card sheet's).
 */
export function ReferralTodayRow({
  item,
  compact,
}: {
  item: { person: { id: string; name: string }; reminder: ReferralReminder };
  compact: boolean;
}) {
  const me = useCurrentUser();
  const [adding, setAdding] = useState(false);
  const { person: p, reminder: r } = item;
  const list = r.board === "customer";
  const since = `${r.days} days`;
  return (
    <>
      <ActionRow
        icon={Users}
        iconTone="info"
        title={`Ask ${compact ? firstName(p.name) : p.name} for names`}
        link={list ? { to: "/customers" } : { to: "/people/$id", params: { id: p.id } }}
        meta={
          compact ? (
            <span>
              {list ? "On your list" : "Prospect"} · referral source {since}
            </span>
          ) : (
            <>
              {!list && <StageChip stage="prospect" />}
              <span>
                {list ? "On your list · " : ""}Referral source for {since} · nobody referred yet
              </span>
            </>
          )
        }
        action={
          compact ? (
            <Button
              size="icon"
              variant="soft"
              className="size-8"
              aria-label={`Add names ${p.name} passed on`}
              onClick={() => setAdding(true)}
            >
              <Plus />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="soft"
              aria-label={`Add names ${p.name} passed on`}
              onClick={() => setAdding(true)}
            >
              <Plus /> Add names
            </Button>
          )
        }
        className={cn(compact && "gap-2.5 py-[9px]")}
      />
      <AddReferredDialog
        open={adding}
        onOpenChange={setAdding}
        referrer={r.ref}
        referrerName={p.name}
        ownerId={me.personId}
        board={r.board}
      />
    </>
  );
}
