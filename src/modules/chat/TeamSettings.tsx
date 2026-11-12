import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, Flag, Megaphone, Search, ShieldCheck, ShieldOff, Trash2, X } from "lucide-react";
import {
  EmptyState,
  PageHeader,
  PersonAvatar,
  SectionCard,
  StageChip,
  ToneChip,
} from "@/components/brand";
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
  approveDraft,
  messagePreview,
  rejectDraft,
  resolveReport,
  setWorkspaceRole,
  unblockPerson,
  useAnnouncementDrafts,
  useBlockedIds,
  useChatAccess,
  useChatPeople,
  useFeature,
  useUnlocks,
  useReports,
  useWorkspaceMembers,
  workspaceRoleLabel,
  type ReportView,
} from "@/data";
import { shortAgo } from "./format";
import {
  ActingForBadge,
  DeputiesCard,
  FeatureSwitchesCard,
} from "@/modules/settings/TeamSettingsCards";
import { EventCategoriesCard } from "@/modules/events/EventCategoriesCard";

/**
 * /settings/team: leaders and their deputies switch features on for the team
 * and tidy up the event categories; leaders name deputies. With Chats on: leaders designate moderators and work
 * the report queue; leaders and moderators approve announcement drafts;
 * everyone manages the people they blocked.
 */
export function TeamSettings() {
  const access = useChatAccess();
  const chats = useFeature("chats");
  const { can } = useUnlocks();
  const chatParts = chats && access.eligible;
  return (
    <Page>
      {can.teamSettings && <FeatureSwitchesCard />}
      {can.teamSettings && <DeputiesCard />}
      {can.teamSettings && <EventCategoriesCard />}
      {chatParts && access.isLeader && <Reports />}
      {chatParts && access.canReview && <Drafts />}
      {chatParts && <MembersCard canEdit={access.isLeader} />}
      {chatParts && <Blocked />}
      {!can.teamSettings && !chatParts && (
        <EmptyState
          title="Nothing to set here yet"
          body="Your team's leader and their deputies manage the team's features here."
        />
      )}
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-3xl content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <PageHeader
        title="Team settings"
        subtitle="Features for the team, deputies and, with chats on, moderators and reports"
        crumbs={[{ label: "Settings", link: { to: "/settings" } }, { label: "Team settings" }]}
        actions={<ActingForBadge />}
      />
      {children}
    </div>
  );
}

function Reports() {
  const reports = useReports();
  const open = reports.filter((r) => !r.resolvedAt);
  const [removing, setRemoving] = useState<ReportView | null>(null);
  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Flag className="size-4 text-bad" aria-hidden="true" /> Reports
          {open.length > 0 && <ToneChip tone="bad">{open.length} open</ToneChip>}
        </span>
      }
    >
      {open.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No open reports. Nice and quiet.</p>
      ) : (
        <ul className="grid gap-2.5">
          {open.map((r) => (
            <li key={r.id} className="grid gap-2 rounded-xl border border-line p-3">
              <p className="text-xs text-muted-foreground">
                <b className="font-bold text-foreground">{r.reason}</b> · reported by{" "}
                {r.reporterName} · {shortAgo(r.createdAt)} ago · in {r.conversationTitle}
              </p>
              <blockquote className="rounded-[10px] bg-surface-2 px-3 py-2 text-[13px]">
                <span className="block text-[11px] font-bold text-muted-foreground">
                  {r.authorName}
                </span>
                {r.message ? messagePreview(r.message) : "Message no longer exists"}
              </blockquote>
              <div className="flex flex-wrap gap-2">
                {r.message && !r.message.deletedAt && (
                  <Button size="sm" variant="destructive" onClick={() => setRemoving(r)}>
                    <Trash2 /> Remove message
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resolveReport(r.id) && toast.success("Report closed")}
                >
                  <Check /> Keep message, close report
                </Button>
                {r.message && (
                  <Button asChild size="sm" variant="ghost">
                    <Link
                      to="/chats/$id"
                      params={{ id: r.message.conversationId }}
                      search={{ m: r.message.id }}
                    >
                      Open in chat
                    </Link>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this message?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.authorName}'s message is replaced by “Message deleted” for everyone and the
              report is closed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removing && resolveReport(removing.id, { removeMessage: true })) {
                  toast.success("Message removed and report closed");
                }
              }}
            >
              Remove message
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}

function Drafts() {
  const drafts = useAnnouncementDrafts();
  const people = useChatPeople();
  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Megaphone className="size-4 text-muted-foreground" aria-hidden="true" /> Announcement
          drafts
        </span>
      }
    >
      {drafts.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No drafts waiting for approval.</p>
      ) : (
        <ul className="grid gap-2.5">
          {drafts.map((d) => (
            <li key={d.id} className="grid gap-2 rounded-xl border border-line p-3">
              <div className="text-xs text-muted-foreground">
                <b className="font-bold text-foreground">{people.get(d.authorId)?.name}</b> ·{" "}
                {shortAgo(d.createdAt)} ago
              </div>
              <p className="whitespace-pre-wrap text-[13px]">{d.body}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => approveDraft(d.id) && toast.success("Approved and posted")}
                >
                  <Check /> Approve and post
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => rejectDraft(d.id) && toast("Draft rejected")}
                >
                  <X /> Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function MembersCard({ canEdit }: { canEdit: boolean }) {
  const members = useWorkspaceMembers();
  const access = useChatAccess();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const order = { leader: 0, moderator: 1, member: 2 } as const;
    return members
      .filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((a, b) => order[a.role ?? "member"] - order[b.role ?? "member"]);
  }, [members, q]);
  const mods = members.filter((m) => m.role === "moderator").length;
  return (
    <SectionCard title={`Members (${members.length})`}>
      <p className="text-[12.5px] text-muted-foreground">
        {canEdit
          ? `Moderators approve announcements and remove messages in team chats. ${mods} ${mods === 1 ? "moderator" : "moderators"} now.`
          : "Only leaders designate moderators."}
      </p>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search members"
          aria-label="Search members"
          className="pl-9"
        />
      </div>
      <ul className="max-h-[480px] overflow-y-auto">
        {list.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-line py-2 first:border-t-0"
          >
            <PersonAvatar name={m.name} stage={m.stage} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">
                {m.name}
                {m.id === access.personId && <span className="font-normal text-faint"> (you)</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StageChip stage={m.stage} />
                {m.role && m.role !== "member" && (
                  <ToneChip tone={m.role === "leader" ? "info" : "good"}>
                    {workspaceRoleLabel(m.role)}
                  </ToneChip>
                )}
              </div>
            </div>
            {canEdit && m.role === "member" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setWorkspaceRole(m.id, "moderator") &&
                  toast.success(`${m.name} is now a moderator`)
                }
              >
                <ShieldCheck /> Make moderator
              </Button>
            )}
            {canEdit && m.role === "moderator" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setWorkspaceRole(m.id, "member") &&
                  toast.success(`${m.name} is no longer a moderator`)
                }
              >
                <ShieldOff /> Remove moderator
              </Button>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function Blocked() {
  const blocked = useBlockedIds();
  const people = useChatPeople();
  return (
    <SectionCard title="People you blocked">
      {blocked.size === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          You haven't blocked anyone. Block someone from any message's menu.
        </p>
      ) : (
        <ul>
          {[...blocked].map((id) => {
            const p = people.get(id);
            return (
              <li
                key={id}
                className="flex items-center gap-2.5 border-t border-line py-2 first:border-t-0"
              >
                <PersonAvatar name={p?.name ?? "?"} stage={p?.stage} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {p?.name ?? "Former member"}
                </span>
                <Button size="sm" variant="outline" onClick={() => unblockPerson(id)}>
                  Unblock
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
