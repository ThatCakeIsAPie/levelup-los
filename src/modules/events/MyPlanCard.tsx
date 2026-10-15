import { Ticket } from "lucide-react";
import { toast } from "sonner";
import { SectionCard, ToneChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  assignToEvent,
  localDate,
  updateAttendance,
  useCurrentUser,
  useEvent,
  type Attendance,
  type DesireLevel,
} from "@/data";
import { BuyTicketButton } from "./BuyTicketButton";
import { attendanceStatus, shortDate } from "./lib";
import { Segmented } from "./Segmented";

/** The viewer's own RSVP and ticket for this event (the main card for candidates). */
export function MyPlanCard({
  eventId,
  rows,
  finished,
}: {
  eventId: string;
  rows: Attendance[];
  finished: boolean;
}) {
  const user = useCurrentUser();
  const event = useEvent(eventId);
  const mine = rows.find((a) => a.personId === user.personId);
  const hasLink = !!event?.ticketUrl;

  if (!mine) {
    if (finished) return null;
    return (
      <SectionCard title="Your plan">
        <p className="text-[13px] text-muted-foreground">
          You're not on this event yet. Let your team know if you'd like to go.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              const a = assignToEvent(eventId, user.personId);
              updateAttendance(a.id, { desireToAttend: "yes" });
              toast.success("You're on the list");
            }}
          >
            I want to go
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const a = assignToEvent(eventId, user.personId);
              updateAttendance(a.id, { desireToAttend: "maybe" });
              toast.success("Marked as maybe");
            }}
          >
            Maybe
          </Button>
          {event && <BuyTicketButton event={event} variant="outline" />}
        </div>
      </SectionCard>
    );
  }

  const st = attendanceStatus(mine);
  const up = (patch: Partial<Attendance>) => updateAttendance(mine.id, patch);

  return (
    <SectionCard title="Your plan" action={<ToneChip tone={st.tone}>{st.label}</ToneChip>}>
      {finished ? (
        <p className="text-[13px] text-muted-foreground">
          {mine.attended === true
            ? "You were there. Nice work."
            : mine.hasTicket && mine.attended === false
              ? "You had a ticket but were marked as a no-show."
              : "This event is over."}
        </p>
      ) : (
        <>
          <div className="grid gap-1.5">
            <Label>Are you going?</Label>
            <Segmented<DesireLevel>
              label="Are you going?"
              value={mine.desireToAttend}
              onChange={(v) => v && up({ desireToAttend: v })}
              options={[
                { value: "yes", label: "Yes" },
                { value: "maybe", label: "Maybe" },
                { value: "no", label: "No" },
              ]}
            />
          </div>
          {mine.followUpDate && mine.followUpDate >= localDate() && (
            <p className="text-xs text-muted-foreground">
              Your team plans to check in with you on {shortDate(mine.followUpDate)}.
            </p>
          )}
          {mine.desireToAttend !== "no" &&
            (mine.hasTicket ? (
              <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-surface-2 px-3 py-2.5 text-[13px]">
                <Ticket className="size-4 text-info" aria-hidden="true" />
                {mine.mode === "virtual"
                  ? "You have a virtual ticket."
                  : "You have an in-person ticket."}
                <Button
                  variant="link"
                  size="sm"
                  className="ml-auto h-auto px-0"
                  onClick={() => up({ hasTicket: false, attended: undefined })}
                >
                  Undo
                </Button>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="grid gap-1">
                  <Label htmlFor={`my-plan-${mine.id}`} className="text-xs text-muted-foreground">
                    I plan to buy my ticket by
                  </Label>
                  <Input
                    id={`my-plan-${mine.id}`}
                    type="date"
                    value={mine.plannedPurchaseDate ?? ""}
                    onChange={(e) => up({ plannedPurchaseDate: e.target.value || undefined })}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {event && <BuyTicketButton event={event} />}
                  <Button
                    variant={hasLink ? "outline" : "default"}
                    onClick={() => {
                      up({
                        hasTicket: true,
                        mode: mine.mode ?? "in_person",
                        desireToAttend: "yes",
                      });
                      toast.success("Ticket marked as bought");
                    }}
                  >
                    <Ticket /> I bought my ticket
                  </Button>
                </div>
              </div>
            ))}
        </>
      )}
    </SectionCard>
  );
}
