import { SectionCard } from "@/components/brand";
import {
  REFERRAL_SOURCE,
  useProspectPipeline,
  useReferrals,
  useReferrerOf,
  useViewer,
  type CrmPerson,
  type Ref,
} from "@/data";
import { ReferralsBlock } from "@/modules/pipeline/Referrals";

/**
 * "Referred by …" and "Referred N people" on a profile. Prospects and
 * customers always get it (to note who referred them); anyone else only when
 * there's something to show.
 */
export function ReferralsCard({ person }: { person: CrmPerson }) {
  const viewer = useViewer();
  const target: Ref = { kind: "person", id: person.id };
  const referrer = useReferrerOf(target);
  const referrals = useReferrals(target);
  const pipeline = useProspectPipeline(person.id);
  if (!viewer || viewer.role === "candidate") return null;
  const contact = person.bizClass === "prospect" || person.bizClass === "customer";
  if (!contact && !referrer && referrals.length === 0) return null;
  const source = pipeline?.onBoard === true && pipeline.card?.column === REFERRAL_SOURCE;
  const ownerId =
    person.bizClass === "prospect"
      ? (person.sponsorId ?? null)
      : person.bizClass === "customer"
        ? (person.ownerId ?? null)
        : null;
  return (
    <SectionCard title="Referrals">
      <ReferralsBlock
        target={target}
        name={person.name}
        ownerId={ownerId}
        board={person.bizClass === "customer" ? "customer" : "recruiting"}
        source={source}
      />
    </SectionCard>
  );
}
