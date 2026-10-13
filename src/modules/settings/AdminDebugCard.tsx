import { Bug } from "lucide-react";
import { SectionCard, ToneChip } from "@/components/brand";
import { DATA_SOURCE } from "@/lib/config";
import {
  FEATURES,
  useActingFor,
  useCurrentUser,
  useEvents,
  useFeatureSwitches,
  useUnlocks,
  useVisibleCustomers,
  useVisibleIds,
  type UnlockArea,
} from "@/data";

const STAGE_LABEL = {
  candidate: "Candidate",
  new_apprentice: "New apprentice",
  first_sponsor: "First sponsor",
  builder: "3/10 and up",
  leader: "Leader",
} as const;

/**
 * Settings card for the admin account only: what this login has unlocked, the
 * team's switches against what the admin sees, and what's loaded. Read-only.
 */
export function AdminDebugCard() {
  const user = useCurrentUser();
  const unlocks = useUnlocks();
  const switches = useFeatureSwitches();
  const actingFor = useActingFor();
  const visible = useVisibleIds();
  const customers = useVisibleCustomers();
  const events = useEvents();
  if (!user.admin) return null;
  const areas = Object.entries(unlocks.can) as [UnlockArea, boolean][];
  const row = "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[12.5px]";
  return (
    <SectionCard
      title="Admin tools"
      action={
        <ToneChip tone="info" icon={Bug}>
          Admin only
        </ToneChip>
      }
    >
      <p className="text-[12.5px] text-muted-foreground">
        This login sees every feature, switched on for the team or not. Everyone else follows the
        switches in Team settings.
      </p>
      <dl className="grid gap-1.5 rounded-lg bg-surface-2 px-3 py-2.5">
        <div className={row}>
          <dt className="text-muted-foreground">Data source</dt>
          <dd className="font-mono">{DATA_SOURCE}</dd>
        </div>
        <div className={row}>
          <dt className="text-muted-foreground">Person</dt>
          <dd className="font-mono">
            {user.personId} · {user.role}
          </dd>
        </div>
        <div className={row}>
          <dt className="text-muted-foreground">Unlock stage</dt>
          <dd>{STAGE_LABEL[unlocks.stage]}</dd>
        </div>
        <div className={row}>
          <dt className="text-muted-foreground">Deputy for</dt>
          <dd>{actingFor.length ? actingFor.map((p) => p.name).join(", ") : "nobody"}</dd>
        </div>
        <div className={row}>
          <dt className="text-muted-foreground">Loaded</dt>
          <dd>
            {visible.size} people · {customers.length} own customers · {events.length} events
          </dd>
        </div>
      </dl>
      <div className="grid gap-1.5">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          Feature switches (team)
        </h3>
        <ul className="flex flex-wrap gap-1.5">
          {FEATURES.map((f) => (
            <li key={f.key}>
              <ToneChip tone={switches[f.key] ? "good" : "neutral"}>
                {f.label}: {switches[f.key] ? "on" : "off"} for the team
              </ToneChip>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-1.5">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          Unlocked for this login
        </h3>
        <ul className="flex flex-wrap gap-1">
          {areas.map(([area, on]) => (
            <li
              key={area}
              className={
                on
                  ? "rounded-full bg-good-soft px-2 py-0.5 text-[11px] font-semibold text-good"
                  : "rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground line-through"
              }
            >
              {area}
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}
