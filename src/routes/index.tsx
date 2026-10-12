import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { usePeopleStore } from "@/stores/peopleStore";
import { useSessionStore } from "@/stores/sessionStore";
import { downlineIds, visibleCustomers } from "@/lib/db";
import {
  useCrmStore, lastContactDate, daysSince, learningStreak, today, type LearningKind, type Learning,
} from "@/stores/crmStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — LevelUp ERP" },
      { name: "description", content: "Log learning, track streaks, and see who needs a check-in." },
      { property: "og:title", content: "Dashboard — LevelUp ERP" },
      { property: "og:description", content: "Log learning, track streaks, and see who needs a check-in." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

const kindLabel: Record<LearningKind, string> = {
  podcast: "Podcasts", pages: "Pages read", workshop: "Workshops", conference: "Conferences",
};

function totals(entries: Learning[], sinceDays: number) {
  const cutoff = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const out: Record<LearningKind, number> = { podcast: 0, pages: 0, workshop: 0, conference: 0 };
  for (const e of entries) if (e.date >= cutoff) out[e.kind] += e.amount;
  return out;
}

function Dashboard() {
  const user = useSessionStore((s) => s.user)!;
  const people = usePeopleStore((s) => s.people);
  const { learning, contacts, settings, setSettings, logContact } = useCrmStore();
  const mine = learning.filter((l) => l.personId === user.personId);
  const week = totals(mine, 7);
  const month = totals(mine, 30);
  const streak = learningStreak(mine);

  const team = [...downlineIds(people, user.personId)].filter((id) => id !== user.personId);
  const teamPeople = people.filter((p) => team.includes(p.id));
  const dueTeam = user.role === "candidate" ? [] : teamPeople
    .map((p) => ({ p, age: daysSince(lastContactDate(contacts, p.id)) }))
    .filter((x) => x.age === null || x.age > settings.teamDays)
    .sort((a, b) => (b.age ?? 9999) - (a.age ?? 9999));
  const dueCustomers = visibleCustomers(people, user)
    .map((p) => ({ p, age: daysSince(lastContactDate(contacts, p.id)) }))
    .filter((x) => x.age === null || x.age > settings.customerDays);

  return (
    <div className="h-full overflow-auto p-4">
      <h1 className="mb-4 text-sm font-semibold">Welcome back, {user.name.split(" ")[0]}</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">My learning</h2>
          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Streak (days)" value={streak} />
            <Stat label="Pages this week" value={week.pages} />
            <Stat label="Podcasts this week" value={week.podcast} />
          </div>
          <table className="mb-4 w-full text-xs">
            <thead><tr className="text-muted-foreground"><th className="text-left font-normal">Type</th><th className="text-right font-normal">This week</th><th className="text-right font-normal">This month</th></tr></thead>
            <tbody>
              {(Object.keys(kindLabel) as LearningKind[]).map((k) => (
                <tr key={k}><td>{kindLabel[k]}</td><td className="text-right tabular-nums">{week[k]}</td><td className="text-right tabular-nums">{month[k]}</td></tr>
              ))}
            </tbody>
          </table>
          <LogLearningForm personId={user.personId} />
        </section>

        <section className="rounded-md border border-border p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Due for contact</h2>
          <div className="mb-3 flex flex-wrap gap-3 text-xs">
            <label className="flex items-center gap-1">Team after
              <Input type="number" className="h-7 w-16" value={settings.teamDays} onChange={(e) => setSettings({ teamDays: Number(e.target.value) || 1 })} /> days
            </label>
            <label className="flex items-center gap-1">Customers after
              <Input type="number" className="h-7 w-16" value={settings.customerDays} onChange={(e) => setSettings({ customerDays: Number(e.target.value) || 1 })} /> days
            </label>
          </div>
          <DueList title="Team members" items={dueTeam} onCheck={(id) => { logContact({ personId: id, byId: user.personId, date: today() }); toast.success("Check-in logged"); }} />
          <DueList title="Customers" items={dueCustomers} onCheck={(id) => { logContact({ personId: id, byId: user.personId, date: today() }); toast.success("Contact logged"); }} />
        </section>

        {user.role === "leader" && (
          <section className="rounded-md border border-border p-4 lg:col-span-2">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Team learning (last 7 days)</h2>
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground"><th className="text-left font-normal">Person</th>{(Object.keys(kindLabel) as LearningKind[]).map((k) => <th key={k} className="text-right font-normal">{kindLabel[k]}</th>)}<th className="text-right font-normal">Streak</th></tr></thead>
              <tbody>
                {teamPeople.map((p) => {
                  const e = learning.filter((l) => l.personId === p.id);
                  const t = totals(e, 7);
                  return (
                    <tr key={p.id} className="border-t border-border">
                      <td className="py-1"><Link to="/people/$id" params={{ id: p.id }} className="hover:underline">{p.name}</Link></td>
                      {(Object.keys(kindLabel) as LearningKind[]).map((k) => <td key={k} className="text-right tabular-nums">{t[k]}</td>)}
                      <td className="text-right tabular-nums">{learningStreak(e)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function DueList({ title, items, onCheck }: { title: string; items: { p: { id: string; name: string }; age: number | null }[]; onCheck: (id: string) => void }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-medium">{title} ({items.length})</div>
      {items.length === 0 ? <div className="text-xs text-muted-foreground">All caught up.</div> : (
        <ul className="space-y-1">
          {items.map(({ p, age }) => (
            <li key={p.id} className="flex items-center justify-between text-xs">
              <Link to="/people/$id" params={{ id: p.id }} className="hover:underline">{p.name}</Link>
              <span className="flex items-center gap-2">
                <span className="text-destructive">{age === null ? "Never" : `${age}d ago`}</span>
                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onCheck(p.id)}>Check in</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LogLearningForm({ personId }: { personId: string }) {
  const logLearning = useCrmStore((s) => s.logLearning);
  const [kind, setKind] = useState<LearningKind>("podcast");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState(1);
  const [date, setDate] = useState(today());
  const save = () => {
    if (!title.trim()) return;
    logLearning({ personId, kind, title: title.trim(), amount: kind === "pages" ? amount : 1, date });
    toast.success("Learning logged");
    setTitle("");
  };
  return (
    <div className="grid gap-2 border-t border-border pt-3">
      <div className="text-xs font-medium">Log learning</div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as LearningKind)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="podcast">Podcast</SelectItem>
            <SelectItem value="pages">Pages read</SelectItem>
            <SelectItem value="workshop">Workshop</SelectItem>
            <SelectItem value="conference">Conference</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" className="h-8" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="grid gap-1"><Label className="sr-only">Title</Label><Input className="h-8" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        {kind === "pages" && <Input type="number" className="h-8 w-20" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} aria-label="Pages" />}
      </div>
      <Button size="sm" onClick={save} disabled={!title.trim()}>Save</Button>
    </div>
  );
}
