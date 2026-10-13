import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { PersonAvatar, StageChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createGroup,
  createOrOpenDm,
  useChatAccess,
  useDmCandidates,
  useWorkspaceMembers,
  type ChatPerson,
} from "@/data";
import { CHAT_ICONS, GROUP_ICON_CHOICES } from "./avatars";

export type NewChatMode = "group" | "dm";

/** New group (name, icon, members) or new direct message (people you may DM). */
export function NewChatDialog({
  mode,
  onOpenChange,
}: {
  mode: NewChatMode | null;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={!!mode} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-md flex-col rounded-card">
        {mode === "group" && <NewGroup onDone={() => onOpenChange(false)} />}
        {mode === "dm" && <NewDm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NewGroup({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const access = useChatAccess();
  const members = useWorkspaceMembers();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("users");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const options = members.filter((p) => p.id !== access.personId);

  const create = () => {
    const id = createGroup({ title, description, icon, memberIds: [...picked] });
    if (!id) {
      toast.error("The group couldn't be created.");
      return;
    }
    toast.success(`${title.trim()} created`, { description: "You're its admin." });
    onDone();
    navigate({ to: "/chats/$id", params: { id } });
  };

  return (
    <form
      className="flex min-h-0 flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) create();
      }}
    >
      <DialogHeader>
        <DialogTitle>New group</DialogTitle>
        <DialogDescription>
          For side conversations: a carpool, a study group, new apprentices. You'll be its admin.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="group-name" className="text-xs font-semibold">
          Name
        </Label>
        <Input
          id="group-name"
          value={title}
          maxLength={60}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Spring apprentices"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="group-about" className="text-xs font-semibold">
          About (optional)
        </Label>
        <Textarea
          id="group-about"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this group for?"
        />
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-xs font-semibold">Icon</legend>
        <div className="flex flex-wrap gap-1.5">
          {GROUP_ICON_CHOICES.map((name) => {
            const Icon = CHAT_ICONS[name];
            return (
              <button
                key={name}
                type="button"
                aria-pressed={icon === name}
                aria-label={name.replace("-", " ")}
                onClick={() => setIcon(name)}
                className={cn(
                  "grid size-9 place-items-center rounded-[10px] border border-line text-muted-foreground hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring",
                  icon === name && "border-primary bg-primary-soft text-primary-ink",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </fieldset>
      <MemberPicker
        people={options}
        picked={picked}
        onChange={setPicked}
        label="Members"
        className="min-h-0 flex-1"
      />
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!title.trim()}>
          Create group{picked.size ? ` (${picked.size + 1})` : ""}
        </Button>
      </DialogFooter>
    </form>
  );
}

function NewDm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const people = useDmCandidates();
  const [q, setQ] = useState("");
  const list = useMemo(
    () => people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())),
    [people, q],
  );
  const open = (p: ChatPerson) => {
    const id = createOrOpenDm(p.id);
    if (!id) {
      toast.error(`You can't message ${p.name}.`);
      return;
    }
    onDone();
    navigate({ to: "/chats/$id", params: { id } });
  };
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <DialogHeader>
        <DialogTitle>New direct message</DialogTitle>
        <DialogDescription>You can message anyone you share a chat with.</DialogDescription>
      </DialogHeader>
      <SearchBox value={q} onChange={setQ} label="Search people" />
      <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto" aria-label="People">
        {list.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => open(p)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <PersonAvatar name={p.name} stage={p.stage} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.name}</span>
              <StageChip stage={p.stage} />
            </button>
          </li>
        ))}
        {list.length === 0 && (
          <li className="px-2 py-6 text-center text-[13px] text-muted-foreground">
            Nobody matches.
          </li>
        )}
      </ul>
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        className="pl-9"
      />
    </div>
  );
}

/** Searchable checkbox list of people. */
export function MemberPicker({
  people,
  picked,
  onChange,
  label,
  className,
}: {
  people: ChatPerson[];
  picked: Set<string>;
  onChange: (s: Set<string>) => void;
  label: string;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const list = people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <fieldset className={cn("flex flex-col gap-2", className)}>
      <legend className="mb-1.5 text-xs font-semibold">
        {label}
        {picked.size > 0 && (
          <span className="ml-1 text-muted-foreground">· {picked.size} picked</span>
        )}
      </legend>
      <SearchBox value={q} onChange={setQ} label="Search people" />
      <ul className="max-h-56 min-h-0 overflow-y-auto rounded-lg border border-line">
        {list.map((p) => (
          <li key={p.id} className="border-t border-line first:border-t-0">
            <label className="flex cursor-pointer items-center gap-2.5 px-2.5 py-1.5 hover:bg-surface-2">
              <Checkbox checked={picked.has(p.id)} onCheckedChange={() => toggle(p.id)} />
              <PersonAvatar name={p.name} stage={p.stage} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[13px]">{p.name}</span>
              <StageChip stage={p.stage} />
            </label>
          </li>
        ))}
        {list.length === 0 && (
          <li className="px-2 py-4 text-center text-[13px] text-muted-foreground">
            Nobody matches.
          </li>
        )}
      </ul>
    </fieldset>
  );
}
