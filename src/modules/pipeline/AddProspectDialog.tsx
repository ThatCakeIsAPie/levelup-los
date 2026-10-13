import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastWithUndo } from "@/components/log/quickLog";
import {
  MILESTONES,
  MILESTONE_LABEL,
  addPipelineProspect,
  useCurrentUser,
  useVisibleTeam,
  type PipelineColumn,
} from "@/data";

/** Add a prospect straight onto the board (a new person, a "New contact" and a card). */
export function AddProspectDialog({
  open,
  onOpenChange,
  columns,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: PipelineColumn[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add prospect</DialogTitle>
          <DialogDescription>
            They join your People list as a prospect and start on the board. Logging it counts as a
            contact made today.
          </DialogDescription>
        </DialogHeader>
        {open && <AddForm columns={columns} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AddForm({ columns, onDone }: { columns: PipelineColumn[]; onDone: () => void }) {
  const me = useCurrentUser();
  const team = useVisibleTeam();
  const sponsors = useMemo(
    () =>
      team
        .filter((p) => p.bizClass === "apprentice" || p.bizClass === "ibo")
        .sort(
          (a, b) =>
            Number(b.id === me.personId) - Number(a.id === me.personId) ||
            a.name.localeCompare(b.name),
        ),
    [team, me.personId],
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [column, setColumn] = useState("contact");
  const [sponsorId, setSponsorId] = useState(me.personId);
  const [next, setNext] = useState("");
  const [date, setDate] = useState("");
  const choices = columns.filter((c) => c.id !== "registered");

  const save = () => {
    const r = addPipelineProspect({
      name,
      phone,
      source,
      column,
      sponsorId,
      nextStep: next,
      nextStepDate: date,
    });
    if (!r) return;
    toastWithUndo(`${r.person.name} added to the board`, r.undo, {
      undoneMessage: "Prospect removed",
    });
    onDone();
  };

  return (
    <form
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="ap-name">Name</Label>
        <Input
          id="ap-name"
          autoFocus
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Their name"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="ap-phone">Phone (optional)</Label>
          <Input
            id="ap-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ap-source">Where you met</Label>
          <Input
            id="ap-source"
            value={source}
            maxLength={30}
            onChange={(e) => setSource(e.target.value)}
            placeholder="e.g. Gym"
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="ap-column">Start in</Label>
          <Select value={column} onValueChange={setColumn}>
            <SelectTrigger id="ap-column">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MILESTONES.filter((m) => m !== "registered").map((m) => (
                <SelectGroup key={m}>
                  <SelectLabel className="text-[10px] uppercase tracking-[.08em] text-faint">
                    {MILESTONE_LABEL[m]}
                  </SelectLabel>
                  {choices
                    .filter((c) => c.band === m)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        {sponsors.length > 1 && (
          <div className="grid gap-1.5">
            <Label htmlFor="ap-owner">Whose prospect</Label>
            <Select value={sponsorId} onValueChange={setSponsorId}>
              <SelectTrigger id="ap-owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {sponsors.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.id === me.personId ? "Mine" : p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="ap-next">Next step (optional)</Label>
          <Input
            id="ap-next"
            value={next}
            maxLength={40}
            onChange={(e) => setNext(e.target.value)}
            placeholder="e.g. Share story"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ap-date">When</Label>
          <Input
            id="ap-date"
            type="date"
            className="min-w-0"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={!name.trim()}>
          <Plus /> Add prospect
        </Button>
      </DialogFooter>
    </form>
  );
}
