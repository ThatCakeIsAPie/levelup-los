/**
 * Referrals (pure, unit-tested in rules.test.ts): who referred whom.
 *
 * A referral source is someone who isn't a fit or isn't interested but passes
 * on names of people who are (the "Referral source" column on both boards).
 * The people they pass on record who referred them:
 *
 *  - Prospects and customers are people: `CrmPerson.referredBy` (a person) or
 *    `referredByEntry` (a name on a list).
 *  - Names on a list aren't people: `ListEntry.referredBy` /
 *    `referredByEntry`, the same two links.
 *
 * A referrer is a person or a list name because the customer board's
 * Referral source column holds list names. One contact can be several rows
 * (a name on a list that became a prospect, `prospectId`, or a customer,
 * `customerId`), so the rules work on contacts: a name and the people it
 * became are one contact. A referral on any of its rows is the contact's, and
 * a contact counts once in "Referred N people". Nothing is copied when a name
 * becomes a prospect or customer.
 */
import { differenceInCalendarDays } from "date-fns";
import { parseDate } from "@/lib/dates";
import type { BizClass } from "@/stores/peopleStore";
import { REFERRAL_SOURCE, type BoardKind } from "../pipeline/types";

export type RefKind = "person" | "entry";
/** A person or a name on a list. */
export interface Ref {
  kind: RefKind;
  id: string;
}

/** What the rules need of a person. */
export interface RefPerson {
  id: string;
  name: string;
  bizClass: BizClass;
  referredBy?: string | null;
  referredByEntry?: string | null;
}

/** What the rules need of a name on a list. */
export interface RefEntry {
  id: string;
  name: string;
  ownerId: string;
  customerId: string | null;
  prospectId: string | null;
  referredBy: string | null;
  referredByEntry: string | null;
}

/** One contact as the viewer sees it. */
export interface ReferralContact {
  /** The row a link points at: the person when there is one, else the name. */
  ref: Ref;
  name: string;
  /** A person the viewer can see (prospect, customer or team member). */
  personId: string | null;
  bizClass: BizClass | null;
  /** The name on a list, when there is one the viewer can see. */
  entryId: string | null;
}

/** The two link fields a referred row carries. */
export interface ReferralLinks {
  referredBy: string | null;
  referredByEntry: string | null;
}

/** Days in Referral source with nobody referred before Home says "Ask … for names". */
export const REFERRAL_ASK_DAYS = 7;

export const NO_LINKS: ReferralLinks = { referredBy: null, referredByEntry: null };

const keyOf = (r: Ref): string => `${r.kind === "person" ? "p" : "e"}:${r.id}`;
export const sameRef = (a: Ref | null, b: Ref | null): boolean =>
  !!a && !!b && a.kind === b.kind && a.id === b.id;

/** The referrer a row's links name (the person link wins), or null. */
export function referrerRef(x: {
  referredBy?: string | null;
  referredByEntry?: string | null;
}): Ref | null {
  if (x.referredBy) return { kind: "person", id: x.referredBy };
  if (x.referredByEntry) return { kind: "entry", id: x.referredByEntry };
  return null;
}

/** The link fields that name `ref` (null: nobody). */
export function linksFor(ref: Ref | null): ReferralLinks {
  if (!ref) return { ...NO_LINKS };
  return ref.kind === "person"
    ? { referredBy: ref.id, referredByEntry: null }
    : { referredBy: null, referredByEntry: ref.id };
}

export interface ReferralIndex {
  /** The contact a row belongs to (null when the viewer sees none of its rows). */
  contact(ref: Ref): ReferralContact | null;
  /** Do two rows belong to the same contact? */
  same(a: Ref, b: Ref): boolean;
  /** Every row of the contact the viewer sees (names first, then people). */
  rows(ref: Ref): Ref[];
  /** Who referred this contact (null: nobody, or nobody the viewer can see). */
  referrerOf(ref: Ref): ReferralContact | null;
  /** The contacts this one referred, by name. */
  referralsOf(ref: Ref): ReferralContact[];
  count(ref: Ref): number;
}

/**
 * Index the people and list names the viewer sees. Links to rows outside them
 * still group (a name's prospect the viewer can't see), but a contact the
 * viewer sees none of is never shown.
 */
export function referralIndex(people: RefPerson[], entries: RefEntry[]): ReferralIndex {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (c !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const e of entries) {
    const k = keyOf({ kind: "entry", id: e.id });
    if (!parent.has(k)) parent.set(k, k);
    if (e.customerId) union(k, keyOf({ kind: "person", id: e.customerId }));
    if (e.prospectId) union(k, keyOf({ kind: "person", id: e.prospectId }));
  }

  // Visible rows per contact: names first, then people (the link a contact
  // shows is the first one set in this order).
  const members = new Map<
    string,
    { ref: Ref; name: string; bizClass?: BizClass; links: Ref | null }[]
  >();
  const add = (ref: Ref, name: string, links: Ref | null, bizClass?: BizClass) => {
    const g = find(keyOf(ref));
    const list = members.get(g) ?? [];
    list.push({ ref, name, bizClass, links });
    members.set(g, list);
  };
  for (const e of entries) add({ kind: "entry", id: e.id }, e.name, referrerRef(e));
  for (const p of people) add({ kind: "person", id: p.id }, p.name, referrerRef(p), p.bizClass);

  const contactOf = (g: string): ReferralContact | null => {
    const list = members.get(g);
    if (!list?.length) return null;
    const person = list.find((m) => m.ref.kind === "person");
    const entry = list.find((m) => m.ref.kind === "entry");
    const main = person ?? entry!;
    return {
      ref: main.ref,
      name: main.name,
      personId: person?.ref.id ?? null,
      bizClass: person?.bizClass ?? null,
      entryId: entry?.ref.id ?? null,
    };
  };

  // Each contact's referrer contact (by group), and who each one referred.
  const referrerGroup = new Map<string, string>();
  const referred = new Map<string, Set<string>>();
  for (const [g, list] of members) {
    const link = list.find((m) => m.links)?.links;
    if (!link) continue;
    const rg = find(keyOf(link));
    if (rg === g) continue;
    referrerGroup.set(g, rg);
    const set = referred.get(rg) ?? new Set<string>();
    set.add(g);
    referred.set(rg, set);
  }

  const group = (ref: Ref) => find(keyOf(ref));
  /** Contacts referred by a contact the viewer sees (none for one they don't). */
  const referredBy = (ref: Ref): string[] => {
    const g = group(ref);
    if (!members.has(g)) return [];
    return [...(referred.get(g) ?? [])].filter((x) => members.has(x));
  };
  return {
    contact: (ref) => contactOf(group(ref)),
    same: (a, b) => group(a) === group(b),
    rows: (ref) => (members.get(group(ref)) ?? []).map((m) => m.ref),
    referrerOf: (ref) => {
      const rg = referrerGroup.get(group(ref));
      return rg ? contactOf(rg) : null;
    },
    referralsOf: (ref) =>
      referredBy(ref)
        .map((g) => contactOf(g)!)
        .sort((a, b) => a.name.localeCompare(b.name)),
    count: (ref) => referredBy(ref).length,
  };
}

/**
 * Why `referrer` can't be recorded for `target` (null: it can). Nobody refers
 * themselves (any row of the same contact) or someone who referred them, and
 * the referrer must be someone the viewer sees.
 */
export function referralError(index: ReferralIndex, target: Ref, referrer: Ref): string | null {
  if (!index.contact(referrer)) return "Pick someone you can see.";
  if (index.same(target, referrer)) return "Someone can't refer themselves.";
  const back = index.referrerOf(referrer);
  if (back && index.same(back.ref, target))
    return `${index.contact(referrer)!.name} was referred by them, not the other way round.`;
  return null;
}

/**
 * The link changes that make `referrer` (or nobody) the contact's referrer:
 * the link goes on the contact's first row (its name on a list when there is
 * one, else the person), and the other rows' links are cleared so the contact
 * has one referrer. Rows already right are left out.
 */
export function referralWrites(
  rows: { ref: Ref; links: ReferralLinks }[],
  referrer: Ref | null,
): { ref: Ref; links: ReferralLinks }[] {
  const out: { ref: Ref; links: ReferralLinks }[] = [];
  rows.forEach((r, i) => {
    const want = i === 0 ? linksFor(referrer) : { ...NO_LINKS };
    if (r.links.referredBy !== want.referredBy || r.links.referredByEntry !== want.referredByEntry)
      out.push({ ref: r.ref, links: want });
  });
  return out;
}

/** "Referred 1 person" / "Referred 3 people" / "No names yet". */
export function referredLine(n: number): string {
  if (n === 0) return "No names yet";
  return `Referred ${n} ${n === 1 ? "person" : "people"}`;
}

// ---------------------------------------------------------------------------
// Reminders: "Ask Sarah for names"
// ---------------------------------------------------------------------------

/** A card in Referral source, on either board. */
export interface ReferralSourceCard {
  board: BoardKind;
  /** A prospect's person id, or a list entry id. */
  cardId: string;
  ref: Ref;
  name: string;
  /** Whose card (the prospect's sponsor, the list's owner). */
  ownerId: string;
  column: string;
  enteredAt: string;
  dropped?: boolean;
  /** People behind the card (the prospect; a name's customer and prospect), for "Do not contact". */
  personIds: string[];
}

export interface ReferralReminder {
  board: BoardKind;
  cardId: string;
  ref: Ref;
  name: string;
  /** Days in Referral source. */
  days: number;
}

/**
 * One reminder per referral source on the viewer's own cards that has
 * referred nobody after REFERRAL_ASK_DAYS days in the column (people in "Do
 * not contact" left out), longest waiting first.
 */
export function referralReminders(
  cards: ReferralSourceCard[],
  viewerId: string,
  today: string,
  count: (ref: Ref) => number,
  skip?: ReadonlySet<string>,
): ReferralReminder[] {
  const out: ReferralReminder[] = [];
  for (const c of cards) {
    if (c.column !== REFERRAL_SOURCE || c.dropped || c.ownerId !== viewerId) continue;
    if (c.personIds.some((id) => skip?.has(id))) continue;
    const days = differenceInCalendarDays(parseDate(today), parseDate(c.enteredAt));
    if (days < REFERRAL_ASK_DAYS || count(c.ref) > 0) continue;
    out.push({ board: c.board, cardId: c.cardId, ref: c.ref, name: c.name, days });
  }
  return out.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Conversions: a referral source isn't a lost contact
// ---------------------------------------------------------------------------

/** What these rules need of a move (recruiting and customer moves both fit). */
export interface ReferralMoveLike {
  /** A prospect's person id, or a list entry id. */
  personId: string;
  ownerId: string;
  to: string;
  movedAt: string;
}

/** Local "YYYY-MM-DD" of a move (the same day reachesOf uses). */
type DayOf = (iso: string) => string;

/**
 * Cards moved into Referral source between two days (inclusive) by these
 * owners' cards, each counted once ("3 became referral sources").
 */
export function newReferralSources(
  moves: readonly ReferralMoveLike[],
  owners: ReadonlySet<string> | null,
  from: string,
  to: string,
  dayOf: DayOf,
): number {
  const seen = new Set<string>();
  for (const m of moves) {
    if (m.to !== REFERRAL_SOURCE || (owners && !owners.has(m.ownerId))) continue;
    const day = dayOf(m.movedAt);
    if (day >= from && day <= to) seen.add(m.personId);
  }
  return seen.size;
}

/**
 * Of the people who reached each milestone in the period but never the next
 * one, how many went to Referral source instead (one number per step between
 * milestones, in order). The funnel says so next to "never met", so passing
 * on names doesn't read as a plain loss.
 */
export function referralSourcesByStep<B extends string>(
  moves: readonly ReferralMoveLike[],
  reaches: readonly { personId: string; ownerId: string; milestone: B; day: string }[],
  owners: ReadonlySet<string> | null,
  from: string,
  to: string,
  milestones: readonly B[],
): number[] {
  const sources = new Set(moves.filter((m) => m.to === REFERRAL_SOURCE).map((m) => m.personId));
  const reached = new Map<string, Set<B>>();
  for (const r of reaches) {
    const s = reached.get(r.personId) ?? new Set<B>();
    s.add(r.milestone);
    reached.set(r.personId, s);
  }
  return milestones.slice(0, -1).map((m, i) => {
    const next = milestones[i + 1];
    const people = new Set<string>();
    for (const r of reaches) {
      if (r.milestone !== m || r.day < from || r.day > to) continue;
      if (owners && !owners.has(r.ownerId)) continue;
      if (!sources.has(r.personId) || reached.get(r.personId)?.has(next)) continue;
      people.add(r.personId);
    }
    return people.size;
  });
}
