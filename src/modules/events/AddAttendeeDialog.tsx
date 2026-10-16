import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STAGE_LABEL } from "@/components/brand";
import {
  addPerson,
  assignToEvent,
  effectiveBizClass,
  useCurrentUser,
  useVisiblePeople,
} from "@/data";
import { Segmented } from "./Segmented";

/**
 * Add someone to an event: pick from the people you can see, or create a new
 * prospect (sponsored by you, so they stay visible to you). `customersOnly`
 * (Home's "Invite your customers") offers just your own customers.
 */
export function AddAttendeeDialog({
  eventId,
  existingPersonIds,
  customersOnly = false,
  children,
}: {
  eventId: string;
  existingPersonIds: string[];
  customersOnly?: boolean;
  children: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {children(() => setOpen(true))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100%-2rem)] rounded-card">
          {open && (
            <AddForm
              eventId={eventId}
              existingPersonIds={existingPersonIds}
              customersOnly={customersOnly}
              onDone={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddForm({
  eventId,
  existingPersonIds,
  customersOnly,
  onDone,
}: {
  eventId: string;
  existingPersonIds: string[];
  customersOnly: boolean;
  onDone: () => void;
}) {
  const user = useCurrentUser();
  const people = useVisiblePeople();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [personId, setPersonId] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const available = useMemo(
    () =>
      people
        .filter(
          (p) =>
            !existingPersonIds.includes(p.id) &&
            (!customersOnly || (p.bizClass === "customer" && p.ownerId === user.personId)),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [people, existingPersonIds, customersOnly, user.personId],
  );

  const submit = () => {
    if (mode === "existing") {
      const p = available.find((x) => x.id === personId);
      if (!p) return setError("Pick someone to add.");
      assignToEvent(eventId, p.id);
      toast.success(`${p.name} added`);
    } else {
      const name = newName.trim();
      if (!name) return setError("Type their name.");
      const p = addPerson({ name, bizClass: "prospect", sponsorId: user.personId });
      assignToEvent(eventId, p.id);
      toast.success(`${name} added to your team and this event`);
    }
    onDone();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader className="text-left">
        <DialogTitle>{customersOnly ? "Invite a customer" : "Add attendee"}</DialogTitle>
        <DialogDescription>
          {customersOnly
            ? "Add one of your customers to this event's list. They get the same reminders as everyone else."
            : "Add someone from your team, or someone new, to this event."}
        </DialogDescription>
      </DialogHeader>
      {!customersOnly && (
        <Segmented<"existing" | "new">
          label="Who to add"
          value={mode}
          onChange={(v) => {
            if (v) setMode(v);
            setError(null);
          }}
          options={[
            { value: "existing", label: "From your team" },
            { value: "new", label: "New person" },
          ]}
        />
      )}
      {mode === "existing" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="add-att-person">{customersOnly ? "Customer" : "Person"}</Label>
          {available.length === 0 ? (
            <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-muted-foreground">
              {customersOnly
                ? "All your customers are already on this event."
                : "Everyone you can see is already on this event."}
            </p>
          ) : (
            <Select
              value={personId}
              onValueChange={(v) => {
                setPersonId(v);
                setError(null);
              }}
            >
              <SelectTrigger id="add-att-person">
                <SelectValue placeholder={customersOnly ? "Pick a customer" : "Pick a person"} />
              </SelectTrigger>
              <SelectContent>
                {available.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    <span className="ml-1.5 text-muted-foreground">
                      {STAGE_LABEL[effectiveBizClass(p)]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      ) : (
        <div className="grid gap-1.5">
          <Label htmlFor="add-att-name">Name</Label>
          <Input
            id="add-att-name"
            autoFocus
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              setError(null);
            }}
          />
          <p className="text-xs text-muted-foreground">
            They join your team as a prospect with you as their sponsor.
          </p>
        </div>
      )}
      {error && <p className="-mt-2 text-xs text-bad">{error}</p>}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={mode === "existing" && available.length === 0}>
          {customersOnly ? "Invite" : "Add"}
        </Button>
      </DialogFooter>
    </form>
  );
}
