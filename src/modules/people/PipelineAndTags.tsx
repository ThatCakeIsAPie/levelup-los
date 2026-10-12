import { usePeopleStore, type CrmPerson, type PipelineStage } from "@/stores/peopleStore";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { X } from "lucide-react";
import { format } from "date-fns";

const stages: { value: PipelineStage; label: string }[] = [
  { value: "prospect", label: "Prospect" },
  { value: "apprentice", label: "Apprentice" },
  { value: "ibo", label: "IBO" },
];

export function PipelineAndTags({ person }: { person: CrmPerson }) {
  const update = usePeopleStore((s) => s.update);
  const [tag, setTag] = useState("");

  const addTag = () => {
    const t = tag.trim();
    if (!t) return;
    const tags = Array.from(new Set([...(person.tags ?? []), t]));
    update(person.id, { tags });
    setTag("");
  };

  const removeTag = (t: string) => {
    update(person.id, { tags: (person.tags ?? []).filter((x) => x !== t) });
  };

  const isCustomer = person.bizClass === "customer";

  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {isCustomer ? "Customer" : "Business Path"}
      </h2>
      <div className="grid gap-3">
        {!isCustomer && (
          <div className="grid gap-1.5">
            <Label className="text-xs">Stage</Label>
            <Select
              value={person.pipelineStage ?? ""}
              onValueChange={(v) => update(person.id, { pipelineStage: v as PipelineStage, bizClass: v as PipelineStage })}
            >
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {stages.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid gap-1.5">
          <Label className="text-xs">Tags</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {(person.tags ?? []).map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[11px]">
                {t}
                <button onClick={() => removeTag(t)} aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input className="h-8" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Add tag…" onKeyDown={(e) => { if (e.key === "Enter") addTag(); }} />
            <Button size="sm" variant="outline" className="h-8" onClick={addTag}>Add</Button>
          </div>
        </div>

        {(person.stageHistory ?? []).length > 0 && (
          <div className="text-[11px] text-muted-foreground">
            <div className="mb-1 font-medium">Stage history</div>
            <ul className="space-y-0.5">
              {(person.stageHistory ?? []).map((h, i) => (
                <li key={i}>{h.stage} — {format(new Date(h.at), "MMM d, yyyy")}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
