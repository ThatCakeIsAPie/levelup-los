import { IS_LOCAL_DEMO } from "@/lib/config";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { BellRing, LogOut, RotateCcw, ShieldCheck, UserCircle } from "lucide-react";
import { ActionRow, PageHeader, PersonAvatar, SectionCard, StageChip } from "@/components/brand";
import { ThemeSwitcher } from "@/components/shell/AppShell";
import { ResetDemoDialog } from "@/components/shell/ResetDemoDialog";
import { useNavAccess } from "@/components/shell/access";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { effectiveBizClass, logout, roleLabel, useCurrentUser, useMe } from "@/data";
import { NOTIFY_OPTIONS, usePrefsStore } from "./prefsStore";

const PAGE =
  "mx-auto grid w-full max-w-2xl content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]";

/** /settings: account, appearance, notification preferences and demo data. */
export function SettingsPage() {
  const [resetOpen, setResetOpen] = useState(false);
  return (
    <div className={PAGE}>
      <PageHeader title="Settings" subtitle="Your account and how the app looks and notifies you" />
      <AccountCard />
      <SectionCard title="Appearance">
        <div className="grid gap-2">
          <ThemeSwitcher />
          <p className="text-[12.5px] text-muted-foreground">
            Auto follows your device's light or dark setting.
          </p>
        </div>
      </SectionCard>
      <NotificationsCard />
      <SectionCard title="Data">
        <div>
          {IS_LOCAL_DEMO && (
            <ActionRow
              icon={RotateCcw}
              iconTone="warn"
              title="Reset demo data"
              meta="Clears everything saved in this browser and reloads the demo"
              action={
                <Button size="sm" variant="outline" onClick={() => setResetOpen(true)}>
                  Reset
                </Button>
              }
            />
          )}
          <ActionRow
            icon={LogOut}
            iconTone="neutral"
            title="Log out"
            meta="Your data stays saved in this browser"
            action={
              <Button size="sm" variant="outline" onClick={() => logout()}>
                Log out
              </Button>
            }
          />
        </div>
      </SectionCard>
      <ResetDemoDialog open={resetOpen} onOpenChange={setResetOpen} />
    </div>
  );
}

function AccountCard() {
  const user = useCurrentUser();
  const me = useMe();
  const { canManageTeam } = useNavAccess();
  const stage = me ? effectiveBizClass(me) : undefined;
  return (
    <SectionCard title="Account">
      <div className="flex flex-wrap items-center gap-3">
        <PersonAvatar name={user.name} stage={stage ?? "ibo"} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">{user.name}</p>
          <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
            {roleLabel[user.role]}
            {stage && <StageChip stage={stage} />}
          </p>
        </div>
        <Button asChild size="sm" variant="soft">
          <Link to="/people/$id" params={{ id: user.personId }}>
            <UserCircle aria-hidden="true" /> My profile
          </Link>
        </Button>
      </div>
      {canManageTeam && (
        <div className="border-t border-line pt-3">
          <ActionRow
            icon={ShieldCheck}
            iconTone="info"
            title="Team settings"
            meta="Moderators, approvals and team chats"
            link={{ to: "/settings/team" }}
          />
        </div>
      )}
    </SectionCard>
  );
}

function NotificationsCard() {
  const notify = usePrefsStore((s) => s.notify);
  const setNotify = usePrefsStore((s) => s.setNotify);
  const { canChat } = useNavAccess();
  const options = NOTIFY_OPTIONS.filter((o) => canChat || !o.chat);
  return (
    <SectionCard title="Notifications">
      <p className="flex items-start gap-2 rounded-[10px] bg-info-soft px-3 py-2.5 text-[12.5px] text-info-ink">
        <BellRing className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Applies when notifications on your devices launch. Until then everything shows in your
        Inbox.
      </p>
      <div className="grid">
        {options.map((o) => {
          const id = `notify-${o.key}`;
          return (
            <div
              key={o.key}
              className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0.5"
            >
              <div className="min-w-0 flex-1">
                <Label htmlFor={id} className="text-[13px] font-semibold">
                  {o.label}
                </Label>
                <p id={`${id}-desc`} className="text-xs text-muted-foreground">
                  {o.description}
                </p>
              </div>
              <Switch
                id={id}
                checked={notify[o.key]}
                onCheckedChange={(on) => setNotify(o.key, on)}
                aria-describedby={`${id}-desc`}
              />
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
