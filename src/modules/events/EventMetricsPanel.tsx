import { useAttendancesForEvent, useVisibleTeam } from "@/data";
import { usePeopleStore } from "@/stores/peopleStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function EventMetricsPanel({ eventId }: { eventId: string }) {
  const attendances = useAttendancesForEvent(eventId);
  const people = useVisibleTeam();
  const getPerson = usePeopleStore((s) => s.getById);

  const ibos = attendances.filter((a) => getPerson(a.personId)?.bizClass === "ibo").length;
  const apprentices = attendances.filter(
    (a) => getPerson(a.personId)?.bizClass === "apprentice",
  ).length;
  const candidates = attendances.filter(
    (a) => getPerson(a.personId)?.bizClass === "prospect",
  ).length;

  const potential = people.length;
  const desire = attendances.filter((a) => a.desireToAttend === "yes").length;
  const outs = attendances.filter((a) => a.desireToAttend === "no").length;
  const actual = attendances.filter((a) => a.hasTicket).length;

  const inPerson = attendances.filter((a) => a.hasTicket && a.ticketType === "in_person").length;
  const stream = attendances.filter((a) => a.hasTicket && a.ticketType === "stream").length;
  const noShows = attendances.filter((a) => a.hasTicket && a.attended === false).length;

  const followUps = attendances.filter((a) => !!a.followUpDate).length;
  const dates = attendances.filter((a) => !a.hasTicket && !!a.plannedPurchaseDate).length;

  const leadership = attendances.filter((a) => a.leadershipQualified).length;
  const special = attendances.filter((a) => a.specialEventQualified).length;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
            Roster mix
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Stat label="IBOs" value={ibos} />
          <Stat label="Apprentices" value={apprentices} />
          <Stat label="Prospects" value={candidates} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
            Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Stat label="Potential" value={potential} />
          <Stat label="Desire" value={desire} />
          <Stat label="Actual" value={actual} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
            Ticketing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Stat label="In Person" value={inPerson} />
          <Stat label="Stream" value={stream} />
          <Stat label="No Shows" value={noShows} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
            Engagement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Stat label="Follow Ups" value={followUps} />
          <Stat label="Dates" value={dates} />
          <Stat label="Outs" value={outs} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
            Qualifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Stat label="Leadership" value={leadership} />
          <Stat label="Additional Event" value={special} />
        </CardContent>
      </Card>
    </div>
  );
}
