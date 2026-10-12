import { useShallow } from "zustand/react/shallow";
import { useMemo } from "react";
import { useAttendanceStore, type Attendance, type DesireLevel } from "@/stores/attendanceStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@tanstack/react-router";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

type ColKey = "potential" | "desire" | "date" | "ticket" | "attended";

const COLS: { key: ColKey; label: string }[] = [
  { key: "potential", label: "Potential" },
  { key: "desire", label: "Desire" },
  { key: "date", label: "Date Committed" },
  { key: "ticket", label: "Ticket" },
  { key: "attended", label: "Attended" },
];

function classify(a: Attendance): ColKey {
  if (a.attended === true) return "attended";
  if (a.hasTicket) return "ticket";
  if (!a.hasTicket && a.plannedPurchaseDate) return "date";
  if (a.desireToAttend === "yes" || a.desireToAttend === "maybe") return "desire";
  return "potential";
}

export function AttendeeKanban({ eventId }: { eventId: string }) {
  const attendances = useAttendanceStore(useShallow((s) => s.forEvent(eventId)));
  const update = useAttendanceStore((s) => s.update);
  const getPerson = usePeopleStore((s) => s.getById);

  const grouped = useMemo(() => {
    const g: Record<ColKey, Attendance[]> = { potential: [], desire: [], date: [], ticket: [], attended: [] };
    attendances.forEach((a) => g[classify(a)].push(a));
    return g;
  }, [attendances]);

  const moveTo = (a: Attendance, target: ColKey) => {
    const patch: Partial<Attendance> = {};
    switch (target) {
      case "potential":
        patch.desireToAttend = undefined; patch.plannedPurchaseDate = undefined; patch.hasTicket = false; patch.attended = undefined; break;
      case "desire":
        patch.desireToAttend = "yes"; patch.hasTicket = false; patch.attended = undefined; break;
      case "date":
        patch.desireToAttend = a.desireToAttend ?? "yes"; patch.hasTicket = false;
        patch.plannedPurchaseDate = a.plannedPurchaseDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        patch.attended = undefined; break;
      case "ticket":
        patch.hasTicket = true; patch.attended = undefined; break;
      case "attended":
        patch.hasTicket = true; patch.attended = true; break;
    }
    update(a.id, patch);
  };

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
      {COLS.map((c) => (
        <Card key={c.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
              {c.label} <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">{grouped[c.key].length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {grouped[c.key].length === 0 && <p className="text-[11px] text-muted-foreground">—</p>}
            {grouped[c.key].map((a) => {
              const p = getPerson(a.personId);
              return (
                <div key={a.id} className="rounded border border-border p-2 text-xs">
                  <div className="flex items-center justify-between">
                    {p ? (
                      <Link to="/people/$id" params={{ id: p.id }} className="font-medium hover:underline">{p.name}</Link>
                    ) : "—"}
                  </div>
                  {c.key === "desire" && (
                    <div className="mt-1 flex items-center gap-1">
                      <Select value={a.desireToAttend ?? ""} onValueChange={(v) => update(a.id, { desireToAttend: v as DesireLevel })}>
                        <SelectTrigger className="h-6 w-full text-[11px]"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="maybe">Maybe</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {c.key === "attended" && (
                    <label className="mt-1 flex items-center gap-1 text-[11px]">
                      <Checkbox checked={a.attended === true} onCheckedChange={(v) => update(a.id, { attended: !!v })} /> Attended
                    </label>
                  )}
                  <div className="mt-1.5">
                    <Select value="" onValueChange={(v) => moveTo(a, v as ColKey)}>
                      <SelectTrigger className="h-6 w-full text-[10px]"><SelectValue placeholder="Move →" /></SelectTrigger>
                      <SelectContent>
                        {COLS.filter((x) => x.key !== c.key).map((x) => (
                          <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
