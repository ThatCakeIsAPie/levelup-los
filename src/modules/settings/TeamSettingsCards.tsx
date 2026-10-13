import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, ShieldCheck, UserMinus, UserPlus, UserRoundCog } from "lucide-react";
import { PersonAvatar, SectionCard, ToneChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { cn } from "@/lib/utils";
import {
  FEATURES,
  addDeputy,
  removeDeputy,
  setFeatureSwitch,
  useActingFor,
  useCanEditSwitches,
  useCurrentUser,
  useDeputies,
  useFeatureSwitchRows,
  useFeatureSwitches,
  useVisiblePeople,
  type CrmPerson,
} from "@/data";

const first = (name: string) => name.split(" ")[0];

/**
 * "Acting for Maria": shown to a leader's deputy where they edit on the
 * leader's behalf (Team settings, the event form). Nothing for anyone else.
 */
export function ActingForBadge({ className }: { className?: string }) {
  const actingFor = useActingFor();
  if (!actingFor.length) return null;
  return (
    <ToneChip tone="info" icon={UserRoundCog} className={className}>
      Acting for {actingFor.map((p) => first(p.name)).join(" & ")}
    </ToneChip>
  );
}

function shortDay(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Chats, Library and Campaigns on or off for the whole team. */
export function FeatureSwitchesCard() {
  const user = useCurrentUser();
  const switches = useFeatureSwitches();
  const rows = useFeatureSwitchRows();
  const canEdit = useCanEditSwitches();
  const people = useVisiblePeople();
  const nameOf = (id?: string) =>
    !id ? "" : id === user.personId ? "you" : (people.find((p) => p.id === id)?.name ?? "a leader");
  return (
    <SectionCard title="Features for your team">
      <p className="text-[12.5px] text-muted-foreground">
        These are built for later phases and stay off until you switch them on. Wallet is always on.
        {user.admin && " Your admin login sees all of them either way."}
      </p>
      <div className="grid">
        {FEATURES.map((f) => {
          const id = `feature-${f.key}`;
          const row = rows.find((r) => r.feature === f.key);
          const by = row?.updatedBy ? nameOf(row.updatedBy) : "";
          return (
            <div
              key={f.key}
              className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0.5"
            >
              <div className="min-w-0 flex-1">
                <Label
                  htmlFor={id}
                  className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold"
                >
                  {f.label}
                  <ToneChip tone="neutral">Phase {f.phase}</ToneChip>
                </Label>
                <p id={`${id}-desc`} className="text-xs text-muted-foreground">
                  {f.description}
                  {by && (
                    <>
                      {" "}
                      Switched {switches[f.key] ? "on" : "off"} by {by}
                      {row?.updatedAt ? ` on ${shortDay(row.updatedAt)}` : ""}.
                    </>
                  )}
                </p>
              </div>
              <Switch
                id={id}
                checked={switches[f.key]}
                disabled={!canEdit}
                aria-describedby={`${id}-desc`}
                onCheckedChange={(on) => {
                  if (setFeatureSwitch(f.key, on))
                    toast.success(`${f.label} is ${on ? "on" : "off"} for the team`);
                }}
              />
            </div>
          );
        })}
      </div>
      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          Only your team's leader and their deputies change these.
        </p>
      )}
    </SectionCard>
  );
}

/**
 * Deputies: a leader names people on their team who see everything the
 * leader sees and edit on the leader's behalf. A deputy sees who they act for
 * and can step down.
 */
export function DeputiesCard() {
  const user = useCurrentUser();
  const { canManage, rows, candidates } = useDeputies();
  const actingFor = useActingFor();
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<{
    leaderId: string;
    deputyId: string;
    name: string;
  } | null>(null);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return candidates.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [candidates, query]);

  if (!canManage && !actingFor.length) return null;

  const add = (p: CrmPerson) => {
    const err = addDeputy(p.id);
    if (err) toast.error(err);
    else {
      toast.success(`${p.name} is now your deputy`);
      setQuery("");
    }
  };

  return (
    <SectionCard title="Deputies">
      {canManage && (
        <>
          <p className="text-[12.5px] text-muted-foreground">
            Deputies see everything you see and can edit on your behalf, for example while you're
            away. Your customers stay private. Every change they make is recorded as theirs.
          </p>
          {rows.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No deputies yet.</p>
          ) : (
            <ul className="grid" aria-label="Your deputies">
              {rows.map(({ deputy, person }) => {
                const name = person?.name ?? "Someone on your team";
                return (
                  <li
                    key={deputy.deputyId}
                    className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0.5"
                  >
                    <PersonAvatar name={name} stage={person?.bizClass ?? "ibo"} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold">{name}</p>
                      {deputy.addedAt && (
                        <p className="text-xs text-muted-foreground">
                          Deputy since {shortDay(deputy.addedAt)}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setRemoving({ leaderId: deputy.leaderId, deputyId: deputy.deputyId, name })
                      }
                    >
                      <UserMinus /> Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="grid gap-2 border-t border-line pt-3">
            <Label htmlFor="deputy-search" className="text-[13px] font-semibold">
              Add a deputy
            </Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
                aria-hidden="true"
              />
              <Input
                id="deputy-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search apprentices and IBOs on your team"
                className="pl-8"
                autoComplete="off"
              />
            </div>
            {query.trim() && (
              <ul className="grid gap-1" aria-label="Matching people">
                {matches.length === 0 ? (
                  <li className="text-[12.5px] text-muted-foreground">
                    Nobody on your team matches. Deputies are registered apprentices or IBOs.
                  </li>
                ) : (
                  matches.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => add(p)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2",
                          "focus-visible:outline-2 focus-visible:outline-ring",
                        )}
                      >
                        <PersonAvatar name={p.name} stage={p.bizClass} size="sm" />
                        <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                        <UserPlus className="size-4 text-primary" aria-hidden="true" />
                        <span className="sr-only">Make deputy</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        </>
      )}
      {actingFor.map((leader) => (
        <div
          key={leader.id}
          className="flex flex-wrap items-center gap-3 rounded-[10px] bg-info-soft px-3 py-2.5 text-info-ink"
        >
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[12.5px]">
            You're {first(leader.name)}'s deputy: you see what {first(leader.name)} sees and can
            edit for {first(leader.name)}. Changes you make are recorded as yours.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setRemoving({ leaderId: leader.id, deputyId: user.personId, name: leader.name })
            }
          >
            Step down
          </Button>
        </div>
      ))}
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removing?.deputyId === user.personId
                ? `Stop being ${removing ? first(removing.name) : ""}'s deputy?`
                : `Remove ${removing?.name} as your deputy?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.deputyId === user.personId
                ? "You'll go back to seeing only your own team."
                : "They'll go back to seeing only their own team. You can name them again any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing && removeDeputy(removing.leaderId, removing.deputyId))
                  toast.success(
                    removing.deputyId === user.personId ? "You stepped down" : "Deputy removed",
                  );
                setRemoving(null);
              }}
            >
              {removing?.deputyId === user.personId ? "Step down" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}
