import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { effectiveBizClass, useDownline, useSponsorChain, type CrmPerson } from "@/data";
import { PersonAvatar, SectionCard, StageChip } from "@/components/brand";

const ORDER = { ibo: 0, apprentice: 1, prospect: 2, customer: 3 } as const;
const PREVIEW = 5;

/** Sponsor chain → this person → direct downline, in stage colors (mockup "Team"). */
export function TeamCard({ person }: { person: CrmPerson }) {
  const chain = useSponsorChain(person.id, 2);
  const downline = useDownline(person.id, { directOnly: true });
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(
    () =>
      [...downline].sort(
        (a, b) =>
          ORDER[effectiveBizClass(a)] - ORDER[effectiveBizClass(b)] || a.name.localeCompare(b.name),
      ),
    [downline],
  );
  const shown = expanded ? sorted : sorted.slice(0, PREVIEW);
  const selfDepth = chain.length;

  return (
    <SectionCard
      title="Team"
      action={
        <Link
          to="/mindmap"
          className="rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Mindmap
        </Link>
      }
    >
      <ul className="grid gap-2 text-[13px]">
        {chain.map((p, i) => (
          <TeamNode key={p.id} person={p} depth={i} />
        ))}
        <TeamNode person={person} depth={selfDepth} self />
        {shown.map((p) => (
          <TeamNode key={p.id} person={p} depth={selfDepth + 1} />
        ))}
      </ul>
      {downline.length === 0 ? (
        <p className="text-xs text-muted-foreground">No one sponsored yet.</p>
      ) : (
        sorted.length > PREVIEW && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-fit rounded-sm text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {expanded ? "Show fewer" : `Show all ${sorted.length} direct`}
          </button>
        )
      )}
    </SectionCard>
  );
}

function TeamNode({ person, depth, self }: { person: CrmPerson; depth: number; self?: boolean }) {
  const stage = effectiveBizClass(person);
  return (
    <li
      className="flex min-w-0 items-center gap-2.5"
      style={{ paddingLeft: Math.min(depth, 3) * 20 }}
    >
      <PersonAvatar name={person.name} stage={stage} size="sm" />
      {self ? (
        <span className="min-w-0 truncate font-bold" aria-current="page">
          {person.name}
        </span>
      ) : (
        <Link
          to="/people/$id"
          params={{ id: person.id }}
          className="min-w-0 truncate rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {person.name}
        </Link>
      )}
      <StageChip stage={stage} className="ml-auto" />
    </li>
  );
}
