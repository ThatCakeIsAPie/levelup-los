import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  usePeopleStore,
  type BizClass,
  type CrmPerson,
  type PipelineStage,
  type PersonPath,
  missingRequiredFields,
  bizClassShort,
  personPath,
  apprenticeAlertLevel,
  apprenticeAlertLabel,
} from "@/stores/peopleStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import { useEventsStore } from "@/stores/eventsStore";
import { getPersonShowRate } from "@/lib/selectors";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, AlertCircle, Download, Calendar } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csvExport";
import { toast } from "sonner";
import { useCrmStore, lastContactDate, daysSince, today } from "@/stores/crmStore";
import { useSessionStore } from "@/stores/sessionStore";

export const Route = createFileRoute("/people/")({
  head: () => ({ meta: [{ title: "People — LevelUp LOS" }] }),
  component: PeoplePage,
});

const bizClassOptions: { value: BizClass; label: string }[] = [
  { value: "ibo", label: "IBO" },
  { value: "apprentice", label: "Apprentice" },
  { value: "prospect", label: "Prospect" },
  { value: "customer", label: "Customer" },
];

const stageOptions: { value: PipelineStage; label: string }[] = [
  { value: "prospect", label: "Prospect" },
  { value: "apprentice", label: "Apprentice" },
  { value: "ibo", label: "IBO" },
];

const shortLabel: Record<BizClass, string> = bizClassShort;

function bizBadge(s: BizClass) {
  const map: Record<BizClass, string> = {
    ibo: "bg-primary/15 text-primary",
    apprentice: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    prospect: "bg-muted text-muted-foreground",
    customer: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  };
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-medium ${map[s]}`}>
      {shortLabel[s]}
    </span>
  );
}

type SortKey = "name" | "showRate" | "lastUpdated" | "nextFollowUp";

function PeoplePage() {
  const people = usePeopleStore((s) => s.people);
  const attendances = useAttendanceStore((s) => s.attendances);
  const events = useEventsStore((s) => s.events);
  const addAttendance = useAttendanceStore((s) => s.add);
  const bulkUpdateAttendance = useAttendanceStore((s) => s.bulkUpdate);

  const [q, setQ] = useState("");
  const [bizFilter, setBizFilter] = useState<BizClass | "all">("all");
  const [pathFilter, setPathFilter] = useState<PersonPath | "all">("all");
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">("all");
  const [locationFilter, setLocationFilter] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const enriched = useMemo(() => {
    return people.map((p) => {
      const rate = getPersonShowRate(p.id, attendances, events);
      const nextFollowUp = attendances
        .filter((a) => a.personId === p.id && a.followUpDate)
        .map((a) => a.followUpDate!)
        .sort()[0];
      return { p, rate, nextFollowUp, missing: missingRequiredFields(p) };
    });
  }, [people, attendances, events]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const locNeedle = locationFilter.trim().toLowerCase();
    const list = enriched.filter(({ p, missing }) => {
      if (pathFilter !== "all" && personPath(p) !== pathFilter) return false;
      if (bizFilter !== "all" && p.bizClass !== bizFilter) return false;
      if (stageFilter !== "all" && p.pipelineStage !== stageFilter) return false;
      if (locNeedle && !(p.location ?? "").toLowerCase().includes(locNeedle)) return false;
      if (missingOnly && missing.length === 0) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        (p.email ?? "").toLowerCase().includes(needle) ||
        (p.iboNumber ?? "").toLowerCase().includes(needle) ||
        (p.ltdNumber ?? "").toLowerCase().includes(needle) ||
        (p.location ?? "").toLowerCase().includes(needle)
      );
    });
    list.sort((a, b) => {
      switch (sort) {
        case "showRate":
          return b.rate.pct - a.rate.pct;
        case "lastUpdated":
          return (b.p.lastUpdatedAt ?? "").localeCompare(a.p.lastUpdatedAt ?? "");
        case "nextFollowUp":
          return (a.nextFollowUp ?? "9999").localeCompare(b.nextFollowUp ?? "9999");
        default:
          return a.p.name.localeCompare(b.p.name);
      }
    });
    return list;
  }, [enriched, q, pathFilter, bizFilter, stageFilter, locationFilter, missingOnly, sort]);

  const allChecked = filtered.length > 0 && filtered.every(({ p }) => selected.has(p.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(filtered.map(({ p }) => p.id)));
  };

  const exportCsv = () => {
    const rows = filtered.map(({ p, rate }) => ({
      ID: p.id,
      Name: p.name,
      BizClass: shortLabel[p.bizClass],
      "IBO#": p.iboNumber ?? "",
      "LTD#": p.ltdNumber ?? "",
      Location: p.location ?? "",
      Email: p.email ?? "",
      Phone: p.phone ?? "",
      Sponsor: people.find((x) => x.id === p.sponsorId)?.name ?? "",
      JoinedDate: p.joinedDate ?? "",
      PipelineStage: p.pipelineStage ?? "",
      ShowRate: `${rate.pct}%`,
      Tags: (p.tags ?? []).join("; "),
    }));
    downloadCsv("people.csv", toCsv(rows));
    toast.success(`Exported ${rows.length} people`);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <h1 className="text-sm font-semibold tracking-tight">People</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
          <AddPersonDialog />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Input
          placeholder="Search name, email, IBO#, LTD#, location…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-8 max-w-xs"
        />
        <Select value={pathFilter} onValueChange={(v) => setPathFilter(v as PersonPath | "all")}>
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Both paths</SelectItem>
            <SelectItem value="business">Business</SelectItem>
            <SelectItem value="customer">Customers</SelectItem>
          </SelectContent>
        </Select>
        <Select value={bizFilter} onValueChange={(v) => setBizFilter(v as BizClass | "all")}>
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All biz classes</SelectItem>
            {bizClassOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={stageFilter}
          onValueChange={(v) => setStageFilter(v as PipelineStage | "all")}
        >
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {stageOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Location"
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="h-8 w-[140px]"
        />
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox checked={missingOnly} onCheckedChange={(v) => setMissingOnly(!!v)} />
          Missing required
        </label>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Sort: Name</SelectItem>
            <SelectItem value="showRate">Sort: Show rate</SelectItem>
            <SelectItem value="lastUpdated">Sort: Last touched</SelectItem>
            <SelectItem value="nextFollowUp">Sort: Next follow-up</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {people.length}
        </span>
      </div>

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          clear={() => setSelected(new Set())}
          onAssign={(eventId) => {
            selected.forEach((pid) => addAttendance(eventId, pid));
            toast.success(`Assigned ${selected.size} to event`);
            setSelected(new Set());
          }}
          onSetFollowUp={(date) => {
            const ids = attendances.filter((a) => selected.has(a.personId)).map((a) => a.id);
            bulkUpdateAttendance(ids, { followUpDate: date });
            toast.success("Follow-up date set");
          }}
        />
      )}

      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Biz</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>IBO#</TableHead>
              <TableHead>LTD#</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Business start</TableHead>
              <TableHead>Sponsor / Owner</TableHead>
              <TableHead className="text-right">Show rate</TableHead>
              <TableHead>Next follow-up</TableHead>
              <TableHead>Last connected</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(({ p, rate, nextFollowUp, missing }) => (
              <PersonRow
                key={p.id}
                person={p}
                sponsorName={
                  people.find((x) => x.id === (p.bizClass === "customer" ? p.ownerId : p.sponsorId))
                    ?.name
                }
                rate={rate.pct}
                eligible={rate.eligible}
                nextFollowUp={nextFollowUp}
                missing={missing}
                checked={selected.has(p.id)}
                toggle={() => {
                  const next = new Set(selected);
                  if (next.has(p.id)) next.delete(p.id);
                  else next.add(p.id);
                  setSelected(next);
                }}
              />
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-sm text-muted-foreground">
                  No people match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function BulkBar({
  count,
  clear,
  onAssign,
  onSetFollowUp,
}: {
  count: number;
  clear: () => void;
  onAssign: (eventId: string) => void;
  onSetFollowUp: (date: string) => void;
}) {
  const events = useEventsStore((s) => s.events);
  const [eventId, setEventId] = useState("");
  const [date, setDate] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs">
      <span className="font-medium">{count} selected</span>
      <Select value={eventId} onValueChange={setEventId}>
        <SelectTrigger className="h-7 w-[200px]">
          <SelectValue placeholder="Assign to event…" />
        </SelectTrigger>
        <SelectContent>
          {events.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        disabled={!eventId}
        onClick={() => {
          onAssign(eventId);
          setEventId("");
        }}
      >
        Assign
      </Button>
      <Input
        type="date"
        className="h-7 w-[140px]"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        disabled={!date}
        onClick={() => {
          onSetFollowUp(date);
          setDate("");
        }}
      >
        <Calendar className="h-3 w-3" /> Set follow-up
      </Button>
      <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={clear}>
        Clear
      </Button>
    </div>
  );
}

function LastConnectedCell({ personId }: { personId: string }) {
  const contacts = useCrmStore((s) => s.contacts);
  const logContact = useCrmStore((s) => s.logContact);
  const limit = useCrmStore((s) => s.settings.teamDays);
  const user = useSessionStore((s) => s.user);
  const last = lastContactDate(contacts, personId);
  const age = daysSince(last);
  const overdue = age === null || age > limit;
  return (
    <TableCell className="whitespace-nowrap text-xs">
      <span className={overdue ? "text-destructive" : ""}>
        {last ? `${last} (${age}d)` : "Never"}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="ml-2 h-6 px-2 text-[11px]"
        onClick={() => {
          logContact({ personId, byId: user?.personId ?? "", date: today() });
          toast.success("Check-in logged");
        }}
      >
        Check in
      </Button>
    </TableCell>
  );
}

function PersonRow({
  person,
  sponsorName,
  rate,
  eligible,
  nextFollowUp,
  missing,
  checked,
  toggle,
}: {
  person: CrmPerson;
  sponsorName?: string;
  rate: number;
  eligible: number;
  nextFollowUp?: string;
  missing: string[];
  checked: boolean;
  toggle: () => void;
}) {
  const alert = apprenticeAlertLevel(person);
  return (
    <TableRow data-state={checked ? "selected" : undefined}>
      <TableCell>
        <Checkbox checked={checked} onCheckedChange={toggle} />
      </TableCell>
      <TableCell>
        <Link to="/people/$id" params={{ id: person.id }} className="font-medium hover:underline">
          {person.name}
        </Link>
        {missing.length > 0 && (
          <span
            title={`Missing: ${missing.join(", ")}`}
            className="ml-1.5 inline-flex align-middle text-destructive"
          >
            <AlertCircle className="h-3 w-3" />
          </span>
        )}
        {alert && (
          <span
            title={apprenticeAlertLabel(alert)}
            className={`ml-1.5 inline-flex rounded px-1.5 py-0.5 align-middle text-[10px] ${
              alert === "90d"
                ? "bg-muted text-muted-foreground"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
            }`}
          >
            {alert === "due" ? "IBO now" : alert === "30d" ? "IBO in 30d" : "IBO in 90d"}
          </span>
        )}
      </TableCell>
      <TableCell>{bizBadge(person.bizClass)}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {person.bizClass === "customer"
          ? `${person.monthlyVolume ?? 0} PV/mo`
          : (person.pipelineStage ?? "—")}
      </TableCell>
      <TableCell className="font-mono text-xs">{person.iboNumber ?? "—"}</TableCell>
      <TableCell className="font-mono text-xs">{person.ltdNumber ?? "—"}</TableCell>
      <TableCell className="text-sm">{person.location ?? "—"}</TableCell>
      <TableCell className="text-xs">
        {person.businessStartDate ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{sponsorName ?? "—"}</TableCell>
      <TableCell className="text-right text-xs tabular-nums">
        {eligible > 0 ? `${rate}%` : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-xs">
        {nextFollowUp ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
      <LastConnectedCell personId={person.id} />
      <TableCell />
    </TableRow>
  );
}

function AddPersonDialog() {
  const add = usePeopleStore((s) => s.add);
  const people = usePeopleStore((s) => s.people);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Omit<CrmPerson, "id"> & { id?: string }>({
    name: "",
    bizClass: "prospect",
    sponsorId: null,
  });
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (
      (form.bizClass === "ibo" || form.bizClass === "apprentice") &&
      (!form.iboNumber?.trim() || !form.ltdNumber?.trim())
    ) {
      setError("IBO# and LTD# are required for IBOs and Apprentices.");
      return;
    }
    if (form.bizClass === "apprentice" && !form.businessStartDate) {
      setError("Business start date is required for Apprentices.");
      return;
    }
    if (form.bizClass === "customer" && !form.ownerId) {
      setError("Choose the IBO or Apprentice who owns this customer.");
      return;
    }
    setError(null);
    add(form);
    setForm({ name: "", bizClass: "prospect", sponsorId: null });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-3.5 w-3.5" /> Add person
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add person</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Phone</Label>
              <Input
                value={form.phone ?? ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Biz Class</Label>
              <Select
                value={form.bizClass}
                onValueChange={(v) => setForm({ ...form, bizClass: v as BizClass })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bizClassOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Joined date</Label>
              <Input
                type="date"
                value={form.joinedDate ?? ""}
                onChange={(e) => setForm({ ...form, joinedDate: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>
                IBO#{form.bizClass === "ibo" || form.bizClass === "apprentice" ? " *" : ""}
              </Label>
              <Input
                value={form.iboNumber ?? ""}
                onChange={(e) => setForm({ ...form, iboNumber: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>
                LTD#{form.bizClass === "ibo" || form.bizClass === "apprentice" ? " *" : ""}
              </Label>
              <Input
                value={form.ltdNumber ?? ""}
                onChange={(e) => setForm({ ...form, ltdNumber: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Location</Label>
            <Input
              value={form.location ?? ""}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="City, State"
            />
          </div>
          {(form.bizClass === "apprentice" || form.bizClass === "ibo") && (
            <div className="grid gap-1.5">
              <Label>Business start date{form.bizClass === "apprentice" ? " *" : ""}</Label>
              <Input
                type="date"
                value={form.businessStartDate ?? ""}
                onChange={(e) => setForm({ ...form, businessStartDate: e.target.value })}
              />
            </div>
          )}
          {form.bizClass === "customer" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Owner (IBO/Apprentice) *</Label>
                <Select
                  value={form.ownerId ?? "none"}
                  onValueChange={(v) => setForm({ ...form, ownerId: v === "none" ? undefined : v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Choose —</SelectItem>
                    {people
                      .filter((p) => p.bizClass === "ibo" || p.bizClass === "apprentice")
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Monthly volume (PV)</Label>
                <Input
                  type="number"
                  value={form.monthlyVolume ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      monthlyVolume: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Sponsor</Label>
            <Select
              value={form.sponsorId ?? "none"}
              onValueChange={(v) => setForm({ ...form, sponsorId: v === "none" ? null : v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
