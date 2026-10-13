import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Ban,
  Bell,
  History,
  LogOut,
  MessageSquareText,
  Mic,
  MoreHorizontal,
  Pencil,
  Pin,
  ShieldCheck,
  ShieldOff,
  UserMinus,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import { PersonAvatar, StageChip, ToneChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  addMembers,
  blockPerson,
  canManageGroup,
  canOpenPerson,
  createOrOpenDm,
  leaveConversation,
  RETENTION_OPTIONS,
  removeMember,
  setMemberRole,
  setMuted,
  setRetention,
  unblockPerson,
  updateGroup,
  useChatAccess,
  useConversation,
  useConversationMembers,
  useMessages,
  useSharedMedia,
  useWorkspaceMembers,
  workspaceRoleLabel,
  type ConversationSummary,
  type MemberView,
} from "@/data";
import { ConversationAvatar } from "./avatars";
import { ImageThumb } from "./media";
import { MemberPicker } from "./NewChatDialog";
import { duration, plural } from "./format";
import { TAB_LABEL, togglePin } from "./chatTab";

const retentionLabel = (d: number | null) => (d === null ? "Keep forever" : `${d} days`);

/** Chat details: about, members and roles, shared media, notifications, history, leave. */
export function DetailsPanel({ id, onClose }: { id: string; onClose?: () => void }) {
  const conv = useConversation(id);
  if (!conv) return null;
  return <Details key={conv.id} conv={conv} onClose={onClose} />;
}

function Details({ conv, onClose }: { conv: ConversationSummary; onClose?: () => void }) {
  const access = useChatAccess();
  const members = useConversationMembers(conv.id);
  const c = conv.conversation;
  const isDm = c.kind === "dm";
  const admin = canManageGroup({ conversation: c, conversationRole: conv.myRole });
  const canRetention = isDm || (conv.team ? access.isLeader : conv.myRole === "admin");
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  return (
    <div className="grid content-start gap-5 text-[12.5px]">
      <div className="flex items-start gap-2.5">
        <ConversationAvatar summary={conv} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-extrabold">{conv.title}</h2>
          <p className="text-[11.5px] text-muted-foreground">
            {isDm ? "Direct message" : plural(conv.memberCount, "member")}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="grid size-7 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {isDm && conv.other ? (
        <DmPerson conv={conv} />
      ) : (
        <Section
          title="About"
          action={
            admin && (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="inline-flex items-center gap-1 rounded text-xs font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Pencil className="size-3" aria-hidden="true" /> Edit
              </button>
            )
          }
        >
          <p className="text-muted-foreground">{c.description || "No description yet."}</p>
        </Section>
      )}

      {!isDm && (
        <Members
          conv={conv}
          members={members}
          admin={admin}
          meId={access.personId}
          onAdd={() => setAddOpen(true)}
        />
      )}

      <SharedMedia id={conv.id} />

      <Section title="Settings">
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <Pin className="size-4 text-muted-foreground" aria-hidden="true" />
            <Label htmlFor={`pin-${conv.id}`} className="flex-1 text-[12.5px] font-normal">
              Pin to top
              <span className="block text-[11px] text-faint">
                {conv.pinned ? "At the top of " : "Keep it at the top of "}
                {TAB_LABEL[conv.tab]}. Only you see your pins.
              </span>
            </Label>
            <Switch
              id={`pin-${conv.id}`}
              checked={conv.pinned}
              onCheckedChange={() => togglePin(conv)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-muted-foreground" aria-hidden="true" />
            <Label htmlFor={`mute-${conv.id}`} className="flex-1 text-[12.5px] font-normal">
              Mentions only
              <span className="block text-[11px] text-faint">
                {conv.muted
                  ? "No unread badge; only @mentions notify you"
                  : "Every message counts as unread"}
              </span>
            </Label>
            <Switch
              id={`mute-${conv.id}`}
              checked={conv.muted}
              onCheckedChange={(v) => setMuted(conv.id, v)}
            />
          </div>
          <Retention conv={conv} editable={canRetention} />
        </div>
      </Section>

      {c.kind === "group" && !c.pinned && (
        <Button
          variant="outline"
          className="justify-start text-destructive hover:text-destructive"
          onClick={() => setLeaveOpen(true)}
        >
          <LogOut /> Leave group
        </Button>
      )}

      <EditGroupDialog conv={conv} open={editOpen} onOpenChange={setEditOpen} />
      <AddMembersDialog conv={conv} members={members} open={addOpen} onOpenChange={setAddOpen} />
      <LeaveDialog conv={conv} open={leaveOpen} onOpenChange={setLeaveOpen} />
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12.5px] font-bold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function DmPerson({ conv }: { conv: ConversationSummary }) {
  const other = conv.other!;
  const visible = canOpenPerson(other.id);
  const [confirm, setConfirm] = useState(false);
  return (
    <Section title="About">
      <div className="flex items-center gap-2.5">
        <PersonAvatar name={other.name} stage={other.stage} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{other.name}</div>
          <div className="flex items-center gap-1.5">
            <StageChip stage={other.stage} />
            {other.role && other.role !== "member" && (
              <ToneChip tone="info">{workspaceRoleLabel(other.role)}</ToneChip>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {visible && (
          <Button asChild size="sm" variant="outline">
            <Link to="/people/$id" params={{ id: other.id }}>
              <UserRound /> Profile
            </Link>
          </Button>
        )}
        {conv.blocked === "me" ? (
          <Button size="sm" variant="outline" onClick={() => unblockPerson(other.id)}>
            <Ban /> Unblock
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirm(true)}
          >
            <Ban /> Block
          </Button>
        )}
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {other.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their messages are hidden for you and neither of you can message the other directly.
              They aren't told.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => blockPerson(other.id)}
            >
              Block
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

const CONV_ROLE: Record<MemberView["conversationRole"], string> = {
  admin: "Admin",
  moderator: "Moderator",
  member: "Member",
};

function Members({
  conv,
  members,
  admin,
  meId,
  onAdd,
}: {
  conv: ConversationSummary;
  members: MemberView[];
  admin: boolean;
  meId: string;
  onAdd: () => void;
}) {
  const [all, setAll] = useState(!conv.team);
  const leads = members.filter((m) => m.conversationRole !== "member");
  const rest = members.filter((m) => m.conversationRole === "member");
  return (
    <Section
      title={conv.team ? "Admins" : "Members"}
      action={
        admin && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 rounded text-xs font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <UserPlus className="size-3.5" aria-hidden="true" /> Add
          </button>
        )
      }
    >
      <ul className="grid gap-2">
        {leads.map((m) => (
          <MemberRow key={m.id} m={m} conv={conv} admin={admin} meId={meId} team={conv.team} />
        ))}
        {all &&
          rest.map((m) => (
            <MemberRow key={m.id} m={m} conv={conv} admin={admin} meId={meId} team={conv.team} />
          ))}
      </ul>
      {conv.team && rest.length > 0 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="justify-self-start rounded text-xs font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {all ? "Show fewer" : `Show all ${plural(members.length, "member")}`}
        </button>
      )}
    </Section>
  );
}

function MemberRow({
  m,
  conv,
  admin,
  meId,
  team,
}: {
  m: MemberView;
  conv: ConversationSummary;
  admin: boolean;
  meId: string;
  team: boolean;
}) {
  const navigate = useNavigate();
  const self = m.id === meId;
  // Team chats show the workspace role (Leader / Moderator); groups their own roles.
  const roleText =
    team && m.role && m.role !== "member"
      ? workspaceRoleLabel(m.role)
      : m.conversationRole !== "member"
        ? CONV_ROLE[m.conversationRole]
        : null;
  return (
    <li className="flex items-center gap-2">
      <PersonAvatar name={m.name} stage={m.stage} size="sm" className="size-[26px]" />
      <span className="min-w-0 flex-1 truncate">
        {m.name}
        {self && <span className="text-faint"> (you)</span>}
      </span>
      {roleText && (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-bold",
            roleText === "Leader" || roleText === "Admin"
              ? "bg-stage-ibo text-stage-ibo-fg"
              : "bg-primary-soft text-primary-ink",
          )}
        >
          {roleText}
        </span>
      )}
      {!self && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${m.name}`}
              className="grid size-6 place-items-center rounded text-faint hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              onSelect={() => {
                const id = createOrOpenDm(m.id);
                if (id) navigate({ to: "/chats/$id", params: { id } });
                else toast.error(`You can't message ${m.name}.`);
              }}
            >
              <MessageSquareText /> Message
            </DropdownMenuItem>
            {admin && m.conversationRole === "member" && (
              <DropdownMenuItem
                onSelect={() =>
                  setMemberRole(conv.id, m.id, "moderator") &&
                  toast.success(`${m.name} is now a moderator`)
                }
              >
                <ShieldCheck /> Make moderator
              </DropdownMenuItem>
            )}
            {admin && m.conversationRole === "moderator" && (
              <DropdownMenuItem
                onSelect={() =>
                  setMemberRole(conv.id, m.id, "member") &&
                  toast.success(`${m.name} is no longer a moderator`)
                }
              >
                <ShieldOff /> Remove as moderator
              </DropdownMenuItem>
            )}
            {admin && m.conversationRole !== "admin" && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() =>
                  removeMember(conv.id, m.id) && toast.success(`${m.name} removed from the group`)
                }
              >
                <UserMinus /> Remove from group
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function SharedMedia({ id }: { id: string }) {
  const media = useSharedMedia(id);
  return (
    <Section title="Shared media">
      {media.length === 0 ? (
        <p className="text-muted-foreground">Photos and voice notes shared here show up here.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5">
          {media.slice(0, 9).map((a) => (
            <li key={a.id} className="aspect-square overflow-hidden rounded-lg bg-surface-2">
              {a.kind === "image" ? (
                <ImageThumb attachment={a} alt="Shared photo" fill />
              ) : (
                <span className="grid size-full place-items-center gap-0.5 text-faint">
                  <Mic className="size-4" aria-hidden="true" />
                  <span className="text-[10.5px] tabular-nums">{duration(a.durationMs)}</span>
                  <span className="sr-only">Voice note</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Retention({ conv, editable }: { conv: ConversationSummary; editable: boolean }) {
  const messages = useMessages(conv.id);
  const current = conv.conversation.retentionDays;
  const [pending, setPending] = useState<number | null | undefined>(undefined);
  const affected = useMemo(() => {
    if (pending === undefined || pending === null) return 0;
    const cutoff = Date.now() - pending * 86_400_000;
    return messages.filter((m) => Date.parse(m.createdAt) < cutoff).length;
  }, [messages, pending]);
  return (
    <div className="flex items-center gap-2">
      <History className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="flex-1" id={`history-${conv.id}`}>
        Message history
      </span>
      {editable ? (
        <Select
          value={String(current)}
          onValueChange={(v) => setPending(v === "null" ? null : Number(v))}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs" aria-labelledby={`history-${conv.id}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RETENTION_OPTIONS.map((d) => (
              <SelectItem key={String(d)} value={String(d)}>
                {retentionLabel(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-faint">{retentionLabel(current)}</span>
      )}
      <AlertDialog open={pending !== undefined} onOpenChange={(o) => !o && setPending(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === null
                ? "Keep messages forever?"
                : `Delete messages after ${pending} days?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === null
                ? "Messages in this chat won't be deleted automatically any more."
                : `Messages older than ${pending} days are deleted for everyone in ${conv.title}, from now on.${
                    affected ? ` ${plural(affected, "message")} will be deleted right away.` : ""
                  } This can't be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                pending !== null &&
                  "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              )}
              onClick={() => {
                if (pending !== undefined && setRetention(conv.id, pending)) {
                  toast.success(`Message history: ${retentionLabel(pending).toLowerCase()}`);
                }
                setPending(undefined);
              }}
            >
              {pending === null ? "Keep forever" : "Delete old messages"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditGroupDialog({
  conv,
  open,
  onOpenChange,
}: {
  conv: ConversationSummary;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-card">
        {open && <EditGroupForm conv={conv} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EditGroupForm({ conv, onDone }: { conv: ConversationSummary; onDone: () => void }) {
  const [title, setTitle] = useState(conv.title);
  const [description, setDescription] = useState(conv.conversation.description ?? "");
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (updateGroup(conv.id, { title, description })) {
          toast.success("Group updated");
          onDone();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit group</DialogTitle>
        <DialogDescription>Only the group's admin can change these.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="edit-group-name" className="text-xs font-semibold">
          Name
        </Label>
        <Input id="edit-group-name" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="edit-group-about" className="text-xs font-semibold">
          About
        </Label>
        <Textarea
          id="edit-group-about"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!title.trim()}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function AddMembersDialog({
  conv,
  members,
  open,
  onOpenChange,
}: {
  conv: ConversationSummary;
  members: MemberView[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const everyone = useWorkspaceMembers();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const inGroup = new Set(members.map((m) => m.id));
  const options = everyone.filter((p) => !inGroup.has(p.id));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setPicked(new Set());
      }}
    >
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-md flex-col rounded-card">
        <DialogHeader>
          <DialogTitle>Add members</DialogTitle>
          <DialogDescription>Add people from the team to {conv.title}.</DialogDescription>
        </DialogHeader>
        <MemberPicker people={options} picked={picked} onChange={setPicked} label="People" />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={picked.size === 0}
            onClick={() => {
              if (addMembers(conv.id, [...picked])) {
                toast.success(`Added ${plural(picked.size, "person", "people")}`);
                setPicked(new Set());
                onOpenChange(false);
              }
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaveDialog({
  conv,
  open,
  onOpenChange,
}: {
  conv: ConversationSummary;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave {conv.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            You'll stop getting its messages. An admin can add you back.
            {conv.myRole === "admin" ? " Someone else in the group becomes its admin." : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (leaveConversation(conv.id)) {
                toast.success(`You left ${conv.title}`);
                navigate({ to: "/chats" });
              }
            }}
          >
            Leave group
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
