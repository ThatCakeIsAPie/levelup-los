import { useState } from "react";
import { usePeopleStore } from "@/stores/peopleStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useOpsStore, splitCost, type Logistics } from "@/stores/opsStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const sel = "h-7 rounded border border-input bg-background px-1 text-xs";

export function EventLogistics({ eventId }: { eventId: string }) {
  const user = useSessionStore((s) => s.user)!;
  const people = usePeopleStore((s) => s.people);
  const att = useAttendanceStore((s) => s.attendances).filter((a) => a.eventId === eventId);
  const ops = useOpsStore();
  const [name, setName] = useState("");
  const [total, setTotal] = useState(0);
  const costs = ops.costs.filter((c) => c.eventId === eventId);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? id;
  const def: Logistics = { ticket: "planned", mode: "drive", carpool: "solo" };
  const ids = [...new Set([user.personId, ...att.map((a) => a.personId)])];

  return (
    <div className="space-y-4 p-4 text-xs">
      <p className="text-muted-foreground">
        Ticket tracking only — tickets are never sold here. Each person edits their own row.
      </p>
      <table className="w-full">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="font-normal">Attendee</th>
            <th className="font-normal">Ticket</th>
            <th className="font-normal">Travel</th>
            <th className="font-normal">Carpool / van</th>
          </tr>
        </thead>
        <tbody>
          {ids.map((pid) => {
            const l = ops.logistics[`${eventId}:${pid}`] ?? def;
            const mine = pid === user.personId || user.role === "leader";
            const up = (p: Partial<Logistics>) => ops.setLogistics(eventId, pid, { ...l, ...p });
            return (
              <tr key={pid} className="border-t border-border align-top">
                <td className="py-1.5">{nameOf(pid)}</td>
                <td>
                  <fieldset disabled={!mine} className="flex flex-wrap gap-1">
                    <select
                      className={sel}
                      value={l.ticket}
                      onChange={(e) => up({ ticket: e.target.value as Logistics["ticket"] })}
                    >
                      <option value="bought">Bought</option>
                      <option value="planned">Not yet, plan to buy by</option>
                    </select>
                    {l.ticket === "planned" && (
                      <input
                        type="date"
                        className={sel}
                        value={l.planDate ?? ""}
                        onChange={(e) => up({ planDate: e.target.value })}
                      />
                    )}
                  </fieldset>
                </td>
                <td>
                  <fieldset disabled={!mine} className="flex flex-wrap gap-1">
                    <select
                      className={sel}
                      value={l.mode}
                      onChange={(e) => up({ mode: e.target.value as Logistics["mode"] })}
                    >
                      <option value="fly">Fly</option>
                      <option value="drive">Drive</option>
                    </select>
                    {l.mode === "fly" && (
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={!!l.flightBooked}
                          onChange={(e) => up({ flightBooked: e.target.checked })}
                        />
                        Flight booked
                      </label>
                    )}
                  </fieldset>
                </td>
                <td>
                  <fieldset disabled={!mine} className="flex flex-wrap gap-1">
                    <select
                      className={sel}
                      value={l.carpool}
                      onChange={(e) => up({ carpool: e.target.value as Logistics["carpool"] })}
                    >
                      <option value="teammate">Carpool – teammate</option>
                      <option value="other_team">Carpool – other team</option>
                      <option value="solo">Solo</option>
                      <option value="van">Van/bus with organizer</option>
                    </select>
                    {l.carpool === "van" && (
                      <select
                        className={sel}
                        value={l.vanPaid ?? "no"}
                        onChange={(e) => up({ vanPaid: e.target.value as Logistics["vanPaid"] })}
                      >
                        <option value="yes">Paid</option>
                        <option value="no">Not paid</option>
                        <option value="planned">Plan to pay by</option>
                      </select>
                    )}
                    {l.carpool === "van" && l.vanPaid === "planned" && (
                      <input
                        type="date"
                        className={sel}
                        value={l.vanPayDate ?? ""}
                        onChange={(e) => up({ vanPayDate: e.target.value })}
                      />
                    )}
                  </fieldset>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="rounded-md border border-border p-3">
        <div className="mb-2 font-semibold">Shared costs</div>
        {costs.map((c) => {
          const split = splitCost(c);
          const lead = c.ownerId === user.personId;
          return (
            <div key={c.id} className="mb-3 border-t border-border pt-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {c.name} — ${c.total} (by {nameOf(c.ownerId)})
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px]"
                  onClick={() => ops.toggleOptIn(c.id, user.personId)}
                >
                  {c.members.includes(user.personId) ? "Opt out" : "Opt in"}
                </Button>
              </div>
              <ul className="mt-1 space-y-1">
                {c.members.map((m) => (
                  <li key={m} className="flex items-center gap-2">
                    {nameOf(m)}:{" "}
                    {lead ? (
                      <Input
                        type="number"
                        className="h-6 w-24"
                        value={split[m]}
                        onChange={(e) =>
                          ops.setOverride(
                            c.id,
                            m,
                            e.target.value === "" ? null : Number(e.target.value),
                          )
                        }
                      />
                    ) : (
                      <span className="tabular-nums">${split[m]}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {user.role === "leader" || user.role === "ibo" ? (
          <div className="flex gap-2 border-t border-border pt-2">
            <Input
              className="h-7"
              placeholder="Cost name (e.g. Hotel block)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              className="h-7 w-24"
              type="number"
              placeholder="Total"
              value={total || ""}
              onChange={(e) => setTotal(Number(e.target.value))}
            />
            <Button
              size="sm"
              className="h-7"
              disabled={!name || !total}
              onClick={() => {
                ops.addCost({ eventId, name, total, ownerId: user.personId });
                setName("");
                setTotal(0);
                toast.success("Shared cost created");
              }}
            >
              Create
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">Only leaders and IBOs can create shared costs.</p>
        )}
      </div>
    </div>
  );
}
