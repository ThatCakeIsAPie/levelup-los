import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar, StageChip, ToneChip, useIsDesktop } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  effectiveBizClass,
  removeAttendance,
  updateAttendance,
  useVisiblePeople,
  type Attendance,
  type DesireLevel,
  type AttendMode,
} from "@/data";
import { cn } from "@/lib/utils";
import { usePeopleMap } from "./hooks";
import { riskReasons } from "./lib";
import { Segmented } from "./Segmented";
import { ClearableDate } from "./ClearableDate";

/**
 * Every per-attendee field in one place (desire, ticket, dates, helper,
 * qualifications, attendance, notes). Right-side sheet on desktop, bottom
 * sheet on phones. Changes save as you make them.
 */
export function AttendeeEditSheet({
  attendance,
  open,
  onOpenChange,
  finished,
}: {
  attendance: Attendance | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finished: boolean;
}) {
  const desktop = useIsDesktop();
  const people = usePeopleMap();
  const person = attendance ? people.get(attendance.personId) : undefined;

  return (
    <Sheet open={open && !!attendance} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn(
          "flex flex-col gap-0 p-0",
          desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-card pb-safe",
        )}
      >
        <SheetHeader className="border-b border-line px-5 py-4 text-left">
          <div className="flex items-center gap-3 pr-6">
            {person && (
              <PersonAvatar name={person.name} stage={effectiveBizClass(person)} size="lg" />
            )}
            <div className="min-w-0">
              <SheetTitle className="truncate text-base font-extrabold">
                {person?.name ?? "Attendee"}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px]">
                  {person && <StageChip stage={effectiveBizClass(person)} />}
                  {person && (
                    <Link
                      to="/people/$id"
                      params={{ id: person.id }}
                      className="font-semibold text-primary hover:underline"
                    >
                      Open profile
                    </Link>
                  )}
                </div>
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>
        {attendance && (
          <EditFields
            a={attendance}
            finished={finished}
            onRemoved={() => onOpenChange(false)}
            personName={person?.name ?? "this person"}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function EditFields({
  a,
  finished,
  onRemoved,
  personName,
}: {
  a: Attendance;
  finished: boolean;
  onRemoved: () => void;
  personName: string;
}) {
  const visible = useVisiblePeople();
  const up = (patch: Partial<Attendance>) => updateAttendance(a.id, patch);
  const reasons = finished ? [] : riskReasons(a);
  const fid = (k: string) => `att-${a.id}-${k}`;

  return (
    <>
      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-5 py-4">
        {reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {reasons.map((r) => (
              <ToneChip key={r.label} tone={r.tone}>
                {r.label}
              </ToneChip>
            ))}
          </div>
        )}

        <div className="grid gap-1.5">
          <Label>Wants to go</Label>
          <Segmented<DesireLevel | "unset">
            label="Wants to go"
            value={a.desireToAttend ?? "unset"}
            onChange={(v) => up({ desireToAttend: v === "unset" ? undefined : v })}
            options={[
              { value: "unset", label: "Not asked" },
              { value: "yes", label: "Yes" },
              { value: "maybe", label: "Maybe" },
              { value: "no", label: "No" },
            ]}
          />
        </div>

        <div className="grid gap-1.5">
          <Label>Ticket</Label>
          <Segmented<"yes" | "no">
            label="Ticket"
            value={a.hasTicket ? "yes" : "no"}
            onChange={(v) =>
              up(
                v === "yes"
                  ? { hasTicket: true, mode: a.mode ?? "in_person" }
                  : { hasTicket: false, attended: undefined },
              )
            }
            options={[
              { value: "no", label: "Not yet" },
              { value: "yes", label: "Bought" },
            ]}
          />
          {a.hasTicket ? (
            <Segmented<AttendMode>
              label="Ticket type"
              size="sm"
              className="mt-1"
              value={a.mode ?? "in_person"}
              onChange={(v) => up({ mode: v })}
              options={[
                { value: "in_person", label: "In person" },
                { value: "virtual", label: "Virtual" },
              ]}
            />
          ) : (
            <div className="mt-1 grid gap-1">
              <Label htmlFor={fid("plan")} className="text-xs font-medium text-muted-foreground">
                Plans to buy by
              </Label>
              <ClearableDate
                id={fid("plan")}
                label="plans to buy by date"
                value={a.plannedPurchaseDate}
                onChange={(v) => up({ plannedPurchaseDate: v })}
              />
            </div>
          )}
        </div>

        {a.hasTicket && (
          <div className="grid gap-1.5">
            <Label>Attendance</Label>
            <Segmented<"yes" | "no" | "unknown">
              label="Attendance"
              value={a.attended === true ? "yes" : a.attended === false ? "no" : "unknown"}
              onChange={(v) =>
                up({ attended: v === "yes" ? true : v === "no" ? false : undefined })
              }
              options={[
                { value: "unknown", label: finished ? "Not recorded" : "Not yet" },
                { value: "yes", label: "Attended" },
                { value: "no", label: "No-show" },
              ]}
            />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={fid("fu")}>Follow-up</Label>
            <ClearableDate
              id={fid("fu")}
              label="follow-up date"
              value={a.followUpDate}
              onChange={(v) => up({ followUpDate: v })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={fid("helper")}>Helper</Label>
            <Select
              value={a.helperId ?? "none"}
              onValueChange={(v) => up({ helperId: v === "none" ? null : v })}
            >
              <SelectTrigger id={fid("helper")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No helper</SelectItem>
                {a.helperId && !visible.some((p) => p.id === a.helperId) && (
                  <SelectItem value={a.helperId}>Someone outside your team</SelectItem>
                )}
                {visible
                  .filter((p) => p.id !== a.personId && p.bizClass !== "customer")
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Qualifications</Label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[13px]">
            Leadership qualified
            <Switch
              checked={a.leadershipQualified}
              onCheckedChange={(v) => up({ leadershipQualified: v })}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[13px]">
            Qualified for the additional event
            <Switch
              checked={a.specialEventQualified}
              onCheckedChange={(v) => up({ specialEventQualified: v })}
            />
          </label>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={fid("notes")}>Notes</Label>
          <Textarea
            id={fid("notes")}
            value={a.notes ?? ""}
            onChange={(e) => up({ notes: e.target.value || undefined })}
            placeholder="Anything the team should know"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-bad hover:bg-bad-soft hover:text-bad">
              <Trash2 /> Remove from event
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="w-[calc(100%-2rem)] rounded-card">
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {personName} from this event?</AlertDialogTitle>
              <AlertDialogDescription>
                Their ticket, dates and notes for this event are deleted. They stay on your team.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  removeAttendance(a.id);
                  toast.success(`${personName} removed from the event`);
                  onRemoved();
                }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <span className="text-[11.5px] text-faint">Changes save automatically</span>
      </div>
    </>
  );
}
