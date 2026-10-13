import { useMemo } from "react";
import {
  useCrmStore,
  learningGoalFor,
  type Contact,
  type ContactSource,
  type Learning,
  type LearningGoal,
  type LearningKind,
  type Sale,
  type Settings,
} from "@/stores/crmStore";
import { useSessionStore } from "@/stores/sessionStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { saleSellerId } from "./growth/engine";
import { localDate } from "@/lib/dates";
import { useVisibleIds } from "./people";

// ---- Contacts (check-ins with team members and customers) ----

/** Contacts the current user may see, newest first; pass a personId to narrow. */
export function useContacts(personId?: string): Contact[] {
  const contacts = useCrmStore((s) => s.contacts);
  const ids = useVisibleIds();
  return useMemo(
    () =>
      contacts
        .filter((c) => ids.has(c.personId) && (!personId || c.personId === personId))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [contacts, ids, personId],
  );
}

/** Map of personId -> last contact date ("YYYY-MM-DD") for every visible person. */
export function useLastContactMap(): Map<string, string> {
  const contacts = useCrmStore((s) => s.contacts);
  const ids = useVisibleIds();
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts) {
      if (!ids.has(c.personId)) continue;
      const prev = m.get(c.personId);
      if (!prev || c.date > prev) m.set(c.personId, c.date);
    }
    return m;
  }, [contacts, ids]);
}

/** Last contact date for one person, or undefined (never / not visible). */
export function useLastContact(personId: string | undefined): string | undefined {
  const map = useLastContactMap();
  return personId ? map.get(personId) : undefined;
}

/** "Due for contact" thresholds: team after N days, customers after N days. */
export function useContactSettings(): Settings {
  return useCrmStore((s) => s.settings);
}

// ---- Sales ----

/**
 * Sales to visible customers, newest first; pass a customerId to narrow.
 * Personal orders (a business person buying for themselves) aren't customer
 * sales and are left out; they count toward PV (src/data/growth).
 */
export function useSales(customerId?: string): Sale[] {
  const sales = useCrmStore((s) => s.sales);
  const ids = useVisibleIds();
  return useMemo(
    () =>
      sales
        .filter(
          (s) =>
            ids.has(s.customerId) &&
            s.personId !== s.customerId &&
            (!customerId || s.customerId === customerId),
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    [sales, ids, customerId],
  );
}

// ---- Learning ----

/** A visible person's learning log, newest first (empty if not visible). */
export function useLearning(personId: string | undefined): Learning[] {
  const learning = useCrmStore((s) => s.learning);
  const ids = useVisibleIds();
  return useMemo(
    () =>
      personId && ids.has(personId)
        ? learning
            .filter((l) => l.personId === personId)
            .sort((a, b) => b.date.localeCompare(a.date))
        : [],
    [learning, ids, personId],
  );
}

/** Learning entries for every visible person (team rollups), newest first. */
export function useTeamLearning(): Learning[] {
  const learning = useCrmStore((s) => s.learning);
  const ids = useVisibleIds();
  return useMemo(
    () => learning.filter((l) => ids.has(l.personId)).sort((a, b) => b.date.localeCompare(a.date)),
    [learning, ids],
  );
}

/** A person's weekly learning goal (defaults to 60 pages / 3 podcasts / 1 workshop). */
export function useLearningGoal(personId: string | undefined): LearningGoal {
  const goals = useCrmStore((s) => s.goals);
  return learningGoalFor(goals, personId ?? "");
}

// ---- Mutations ----

const me = () => useSessionStore.getState().user?.personId ?? "";

/**
 * Record a check-in / contact. `byId` defaults to the current user, `date` to
 * today, `source` to "manual" ("message" = logged from a chat conversation,
 * "event" = from an event). Returns the saved contact (pass its id to
 * removeContact to undo).
 */
export function logContact(input: {
  personId: string;
  byId?: string;
  date?: string;
  note?: string;
  source?: ContactSource;
}): Contact {
  return useCrmStore.getState().logContact({
    personId: input.personId,
    byId: input.byId ?? me(),
    date: input.date ?? localDate(),
    source: input.source ?? "manual",
    ...(input.note ? { note: input.note } : {}),
  });
}

/**
 * Log learning. `personId` defaults to the current user, `date` to today and
 * `amount` to 1 (pass the page count for kind "pages").
 */
export function logLearning(input: {
  kind: LearningKind;
  title: string;
  amount?: number;
  date?: string;
  personId?: string;
}): void {
  useCrmStore.getState().logLearning({
    personId: input.personId ?? me(),
    kind: input.kind,
    title: input.title,
    amount: input.amount ?? 1,
    date: input.date ?? localDate(),
  });
}

/** Delete a learning entry. */
export function removeLearning(id: string): void {
  useCrmStore.getState().removeLearning(id);
}

/**
 * Record a purchase. `customerId` is a customer, or a business person's own id
 * for a personal order. `date` defaults to today; `pv` (point value) counts
 * toward the monthly PV of `personId`, which defaults to the customer's owner
 * (or the buyer, for a personal order; see saleSellerId). Returns the sale.
 */
export function logSale(input: {
  customerId: string;
  product: string;
  date?: string;
  amount?: number;
  pv?: number;
  personId?: string;
}): Sale {
  const personId =
    input.personId ??
    saleSellerId(
      { id: "", customerId: input.customerId, product: "", date: "" },
      new Map(usePeopleStore.getState().people.map((p) => [p.id, p])),
    );
  return useCrmStore.getState().logSale({
    customerId: input.customerId,
    product: input.product,
    date: input.date ?? localDate(),
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.pv !== undefined ? { pv: input.pv } : {}),
    ...(personId ? { personId } : {}),
  });
}

/** Delete a logged check-in / contact (also used to undo logContact). */
export function removeContact(id: string): void {
  useCrmStore.getState().removeContact(id);
}

/** Delete a logged sale. */
export function removeSale(id: string): void {
  useCrmStore.getState().removeSale(id);
}

/** Update a person's weekly learning goal (partial patch). */
export function setLearningGoal(personId: string, goal: Partial<LearningGoal>): void {
  useCrmStore.getState().setLearningGoal(personId, goal);
}

/** Update "due for contact" thresholds. */
export function setContactSettings(patch: Partial<Settings>): void {
  useCrmStore.getState().setSettings(patch);
}
