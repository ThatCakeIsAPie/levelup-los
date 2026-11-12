/**
 * The sensitive values this client knows right now, for the snapshot's value
 * safety net (./redact.ts): every person's name, phone, email, location and
 * IBO / LTD numbers, the names and contact details on customer lists, and the
 * signed-in account. Read at capture time, so it is always current.
 */
import { displayPhone } from "@/lib/phone";
import { useCustomerPipelineStore } from "@/data/customerPipeline/store";
import { usePeopleStore } from "@/stores/peopleStore";
import { useSessionStore } from "@/stores/sessionStore";
import { buildMatcher, type SensitiveMatcher, type SensitiveSources } from "./redact";

export function collectSensitiveSources(): SensitiveSources {
  const people = usePeopleStore.getState().people;
  const entries = useCustomerPipelineStore.getState().entries;
  const { user, account } = useSessionStore.getState();
  const phones: (string | null | undefined)[] = [];
  const addPhone = (p: string | null | undefined) => {
    if (p) phones.push(p, displayPhone(p));
  };
  for (const p of people) addPhone(p.phone);
  for (const e of entries) addPhone(e.phone);
  return {
    names: [user?.name, ...people.map((p) => p.name), ...entries.map((e) => e.name)],
    phones,
    emails: [account?.email, ...people.map((p) => p.email), ...entries.map((e) => e.email)],
    places: people.map((p) => p.location),
    ids: people.flatMap((p) => [p.iboNumber, p.ltdNumber]),
  };
}

/** A matcher for everything the client knows now. */
export function currentSensitiveMatcher(): SensitiveMatcher {
  return buildMatcher(collectSensitiveSources());
}
