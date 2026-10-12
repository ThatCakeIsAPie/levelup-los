import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { visibleCustomers } from "@/lib/db";
import { useOpsStore, type Campaign } from "@/stores/opsStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/campaigns")({
  head: () => ({ meta: [
    { title: "Campaigns — LevelUp LOS" }, { name: "description", content: "Send or schedule email, text, and voice note campaigns to your customers." },
    { property: "og:title", content: "Campaigns — LevelUp LOS" }, { property: "og:description", content: "Send or schedule email, text, and voice note campaigns to your customers." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: CampaignsPage,
});

const kinds = { email: "Email", text: "Text", voice: "Voice note" } as const;

function CampaignsPage() {
  const user = useSessionStore((s) => s.user)!;
  const people = usePeopleStore((s) => s.people);
  const { campaigns, addCampaign } = useOpsStore();
  const customers = visibleCustomers(people, user);
  const [kind, setKind] = useState<Campaign["kind"]>("email");
  const [message, setMessage] = useState("");
  const [when, setWhen] = useState("");
  const mine = campaigns.filter((c) => c.ownerId === user.personId);
  const send = () => {
    addCampaign({ ownerId: user.personId, kind, message, recipients: customers.map((c) => c.id), scheduledFor: when || undefined });
    setMessage(""); setWhen(""); toast.success("Queued — pending send");
  };
  return (
    <div className="h-full overflow-auto p-4 text-xs">
      <h1 className="mb-3 text-sm font-semibold">Campaigns</h1>
      <div className="mb-4 grid max-w-xl gap-2 rounded-md border border-border p-3">
        <div>Audience: <b>My customers ({customers.length})</b></div>
        <select className="h-8 rounded border border-input bg-background px-2" value={kind} onChange={(e) => setKind(e.target.value as Campaign["kind"])}>
          {Object.entries(kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <Textarea placeholder={kind === "voice" ? "Voice note script" : "Message"} value={message} onChange={(e) => setMessage(e.target.value)} />
        <label className="flex items-center gap-2">Schedule (optional) <Input type="datetime-local" className="h-8 w-56" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
        <Button size="sm" disabled={!message.trim() || customers.length === 0} onClick={send}>{when ? "Schedule" : "Send now"}</Button>
      </div>
      <h2 className="mb-2 font-semibold">History</h2>
      <ul className="space-y-1">{mine.map((c) => (
        <li key={c.id} className="rounded border border-border p-2"><b>{kinds[c.kind]}</b> to {c.recipients.length} · {c.scheduledFor ? `scheduled ${c.scheduledFor.replace("T", " ")}` : new Date(c.createdAt).toLocaleString()}
          <div className="text-muted-foreground">{c.message}</div>
          <div className="text-[10px] text-muted-foreground">Pending send — will go out when a messaging provider is connected</div></li>))}
        {mine.length === 0 && <li className="text-muted-foreground">No campaigns yet.</li>}
      </ul>
    </div>
  );
}
