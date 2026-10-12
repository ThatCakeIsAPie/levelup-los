import { Link } from "@tanstack/react-router";
import { usePeopleStore } from "@/stores/peopleStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SponsorMiniTree({ personId }: { personId: string }) {
  const people = usePeopleStore((s) => s.people);
  const person = people.find((p) => p.id === personId);
  if (!person) return null;

  // Sponsor chain up to 3 levels
  const chain: typeof people = [];
  let cur = person;
  while (cur.sponsorId && chain.length < 3) {
    const sp = people.find((p) => p.id === cur.sponsorId);
    if (!sp) break;
    chain.unshift(sp);
    cur = sp;
  }
  const downline = people.filter((p) => p.sponsorId === personId);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
          Sponsor & downline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {chain.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {chain.map((p) => (
              <span key={p.id} className="flex items-center gap-1">
                <Link to="/people/$id" params={{ id: p.id }} className="hover:underline">{p.name}</Link>
                <span>›</span>
              </span>
            ))}
            <span className="font-semibold text-foreground">{person.name}</span>
          </div>
        )}
        {chain.length === 0 && <p className="text-xs text-muted-foreground">No sponsor on file.</p>}
        <div className="pt-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            Downline ({downline.length})
          </div>
          {downline.length === 0 ? (
            <p className="text-xs text-muted-foreground">No direct downline.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {downline.map((p) => (
                <li key={p.id}>
                  <Link
                    to="/people/$id"
                    params={{ id: p.id }}
                    className="inline-flex rounded bg-muted px-2 py-0.5 text-xs hover:bg-muted/70"
                  >
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="pt-1">
          <Link to="/mindmap" className="text-xs text-primary hover:underline">
            Open in mindmap →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
