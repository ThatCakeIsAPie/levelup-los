/**
 * Referrals: hooks (re-exported from "@/data"). Everything is limited to what
 * the viewer may see: their visible people (team, prospects, own customers)
 * and the lists they may see. A referrer they can't see isn't shown.
 */
import { useMemo } from "react";
import { localDate } from "@/lib/dates";
import { effectiveBizClass, usePeopleStore, type CrmPerson } from "@/stores/peopleStore";
import type { Viewer } from "../access";
import { useVisibleIds } from "../people";
import { useViewer } from "../session";
import { visibleIdSet } from "../access";
import { useCustomerPipelineStore } from "../customerPipeline/store";
import { visibleEntries } from "../customerPipeline/rules";
import type { ListEntry } from "../customerPipeline/types";
import { usePipelineStore } from "../pipeline/store";
import type { PipelineCard } from "../pipeline/types";
import { REFERRAL_SOURCE } from "../pipeline/types";
import type { CustomerCard } from "../customerPipeline/types";
import { useDoNotContactIds } from "../customerPipeline/hooks";
import {
  referralIndex,
  referralReminders,
  type Ref,
  type ReferralContact,
  type ReferralIndex,
  type ReferralReminder,
  type ReferralSourceCard,
} from "./rules";

let cache: {
  people: CrmPerson[];
  entries: ListEntry[];
  ids: Set<string>;
  index: ReferralIndex;
} | null = null;

/** The index over what the viewer sees (computed once per change of the tables). */
export function buildReferralIndex(
  people: CrmPerson[],
  entries: ListEntry[],
  ids: Set<string>,
  viewer: Viewer,
): ReferralIndex {
  if (cache?.people === people && cache.entries === entries && cache.ids === ids)
    return cache.index;
  const index = referralIndex(
    people.filter((p) => ids.has(p.id)),
    visibleEntries(entries, people, viewer),
  );
  cache = { people, entries, ids, index };
  return index;
}

/** Non-reactive: the index for the signed-in viewer (mutations). */
export function currentReferralIndex(viewer: Viewer): ReferralIndex {
  const people = usePeopleStore.getState().people;
  const entries = useCustomerPipelineStore.getState().entries;
  return buildReferralIndex(people, entries, visibleIdSet(people, viewer), viewer);
}

/** Who referred whom, over everyone and every list name the viewer sees. */
export function useReferralIndex(): ReferralIndex {
  const people = usePeopleStore((s) => s.people);
  const entries = useCustomerPipelineStore((s) => s.entries);
  const ids = useVisibleIds();
  const viewer = useViewer();
  return useMemo(
    () => buildReferralIndex(people, entries, ids, viewer),
    [people, entries, ids, viewer],
  );
}

/** Who referred this person or list name (null: nobody the viewer can see). */
export function useReferrerOf(ref: Ref | null): ReferralContact | null {
  const index = useReferralIndex();
  const kind = ref?.kind;
  const id = ref?.id;
  return useMemo(() => (kind && id ? index.referrerOf({ kind, id }) : null), [index, kind, id]);
}

/** The people and names this contact referred, by name. */
export function useReferrals(ref: Ref | null): ReferralContact[] {
  const index = useReferralIndex();
  const kind = ref?.kind;
  const id = ref?.id;
  return useMemo(() => (kind && id ? index.referralsOf({ kind, id }) : []), [index, kind, id]);
}

/** Cards in Referral source on both boards that the viewer sees. */
function sourceCards(
  people: CrmPerson[],
  ids: Set<string>,
  entries: ListEntry[],
  cards: PipelineCard[],
  customerCards: CustomerCard[],
): ReferralSourceCard[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const out: ReferralSourceCard[] = [];
  for (const c of cards) {
    if (c.column !== REFERRAL_SOURCE || !ids.has(c.personId)) continue;
    const p = byId.get(c.personId);
    if (!p || p.bizClass !== "prospect" || !p.sponsorId) continue;
    out.push({
      board: "recruiting",
      cardId: p.id,
      ref: { kind: "person", id: p.id },
      name: p.name,
      ownerId: p.sponsorId,
      column: c.column,
      enteredAt: c.enteredAt,
      dropped: !!c.droppedAt,
      personIds: [p.id],
    });
  }
  const entryById = new Map(entries.map((e) => [e.id, e]));
  for (const c of customerCards) {
    if (c.column !== REFERRAL_SOURCE) continue;
    const e = entryById.get(c.entryId);
    if (!e) continue;
    out.push({
      board: "customer",
      cardId: e.id,
      ref: { kind: "entry", id: e.id },
      name: e.name,
      ownerId: e.ownerId,
      column: c.column,
      enteredAt: c.enteredAt,
      personIds: [e.customerId, e.prospectId].filter((x): x is string => !!x),
    });
  }
  return out;
}

export interface ReferrerChoice extends ReferralContact {
  /** In a Referral source column now (listed first). */
  source: boolean;
  /** Referral sources: their board ("Recruiting", "Customer list"); others: "Prospect", "IBO"… */
  hint: string;
}

const STAGE_HINT: Record<string, string> = {
  prospect: "Prospect",
  customer: "Customer",
  apprentice: "Apprentice",
  ibo: "IBO",
};

/**
 * Who can be picked as "Referred by": the referral sources on both boards
 * first, then everyone else the viewer sees (not the viewer themselves).
 */
export function useReferrerChoices(): ReferrerChoice[] {
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  const viewer = useViewer();
  const allEntries = useCustomerPipelineStore((s) => s.entries);
  const customerCards = useCustomerPipelineStore((s) => s.cards);
  const cards = usePipelineStore((s) => s.cards);
  const index = useReferralIndex();
  return useMemo(() => {
    if (!viewer) return [];
    const entries = visibleEntries(allEntries, people, viewer);
    const seen = new Set<string>();
    const out: ReferrerChoice[] = [];
    const key = (c: ReferralContact) => `${c.ref.kind}:${c.ref.id}`;
    for (const s of sourceCards(people, ids, entries, cards, customerCards)) {
      const c = index.contact(s.ref);
      if (!c || seen.has(key(c))) continue;
      seen.add(key(c));
      out.push({
        ...c,
        source: true,
        hint: s.board === "customer" ? "Customer list" : "Recruiting",
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    const rest: ReferrerChoice[] = [];
    for (const p of people) {
      if (!ids.has(p.id) || p.id === viewer.personId) continue;
      const c = index.contact({ kind: "person", id: p.id });
      if (!c || seen.has(key(c))) continue;
      seen.add(key(c));
      rest.push({ ...c, source: false, hint: STAGE_HINT[effectiveBizClass(p)] ?? "" });
    }
    rest.sort((a, b) => a.name.localeCompare(b.name));
    return [...out, ...rest];
  }, [people, ids, viewer, allEntries, customerCards, cards, index]);
}

/**
 * Home's "Ask … for names": the viewer's own referral sources (both boards)
 * with nobody referred after a week in the column; "Do not contact" left out.
 */
export function useReferralReminders(): ReferralReminder[] {
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  const viewer = useViewer();
  const allEntries = useCustomerPipelineStore((s) => s.entries);
  const customerCards = useCustomerPipelineStore((s) => s.cards);
  const cards = usePipelineStore((s) => s.cards);
  const index = useReferralIndex();
  const skip = useDoNotContactIds();
  const today = localDate();
  return useMemo(() => {
    if (!viewer || viewer.role === "candidate") return [];
    const entries = visibleEntries(allEntries, people, viewer);
    return referralReminders(
      sourceCards(people, ids, entries, cards, customerCards),
      viewer.personId,
      today,
      (ref) => index.count(ref),
      skip,
    );
  }, [people, ids, viewer, allEntries, customerCards, cards, index, skip, today]);
}
