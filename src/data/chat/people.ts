/**
 * Names of the people chat can show. In the browser demo the people store has
 * everyone; with real accounts it only has the people you may see in the CRM,
 * so the chat directory (every chat member's name, stage and team role; see
 * src/data/remote/extras.ts) fills in the rest.
 */
import { usePeopleStore } from "@/stores/peopleStore";
import { useRemoteStore } from "@/data/remote/extras";

/** Everyone chat may name: business people you see, plus the chat directory. */
export function chatPeopleList(): { id: string; name: string }[] {
  const out = new Map<string, { id: string; name: string }>();
  for (const p of usePeopleStore.getState().people) {
    if (p.bizClass !== "customer") out.set(p.id, { id: p.id, name: p.name });
  }
  for (const d of useRemoteStore.getState().directory) {
    if (!out.has(d.personId)) out.set(d.personId, { id: d.personId, name: d.name });
  }
  return [...out.values()];
}

/** A name for a person id, from the CRM or the chat directory. */
export function chatPersonName(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  return (
    usePeopleStore.getState().people.find((p) => p.id === id)?.name ??
    useRemoteStore.getState().directory.find((d) => d.personId === id)?.name
  );
}
