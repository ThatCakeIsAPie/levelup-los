/**
 * The map's three person-type switches (Contacts, Prospects, Filtered): what
 * they are called, where each is remembered, and how the header names what
 * is included. Pure apart from reading and writing the browser's storage.
 */
import { storageKey } from "@/lib/brand";
import type { MapTypes, PersonType } from "@/data";

export const TYPE_SWITCHES: readonly { type: PersonType; label: string }[] = [
  { type: "contact", label: "Contacts" },
  { type: "prospect", label: "Prospects" },
  { type: "filtered", label: "Filtered" },
];

/**
 * Where a switch is remembered. Prospects keeps the key of the single
 * "Include prospects" switch it replaced, so whoever had that on keeps
 * Prospects on; Contacts and Filtered have new keys and start off.
 */
export const typeSwitchKey = (personId: string, type: PersonType): string =>
  storageKey(type === "prospect" ? `mindmap.prospects.${personId}` : `mindmap.${type}.${personId}`);

/** The viewer's switches on this device (all off when nothing is stored or storage is blocked). */
export function readTypeSwitches(personId: string): MapTypes {
  const get = (type: PersonType): boolean => {
    try {
      return localStorage.getItem(typeSwitchKey(personId, type)) === "1";
    } catch {
      return false;
    }
  };
  return { contact: get("contact"), prospect: get("prospect"), filtered: get("filtered") };
}

export function writeTypeSwitch(personId: string, type: PersonType, on: boolean): void {
  try {
    if (on) localStorage.setItem(typeSwitchKey(personId, type), "1");
    else localStorage.removeItem(typeSwitchKey(personId, type));
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}

/** "contacts and prospects": what the map includes, for the header's label (empty when none). */
export function includedLabel(show: MapTypes): string {
  const names = [
    show.contact && "contacts",
    show.prospect && "prospects",
    show.filtered && "filtered people",
  ].filter((x): x is string => !!x);
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
