/**
 * The map's "Include prospects" switch: where it is remembered and how the
 * header names what is included. The map only ever adds people of the
 * Prospect type; Contacts and Filtered people are never drawn, so they have
 * no switch. Pure apart from reading and writing the browser's storage.
 */
import { storageKey } from "@/lib/brand";
import type { MapTypes, PersonType } from "@/data";

export const TYPE_SWITCHES: readonly { type: PersonType; label: string }[] = [
  { type: "prospect", label: "Include prospects" },
];

/** Where a switch is remembered (`<prefix>.mindmap.prospects.<personId>` for "Include prospects"). */
export const typeSwitchKey = (personId: string, type: PersonType): string =>
  storageKey(type === "prospect" ? `mindmap.prospects.${personId}` : `mindmap.${type}.${personId}`);

/**
 * What the map draws for this viewer on this device: Prospects when "Include
 * prospects" is on (off when nothing is stored or storage is blocked);
 * Contacts and Filtered never, whatever an earlier version stored for them.
 */
export function readTypeSwitches(personId: string): MapTypes {
  let prospect = false;
  try {
    prospect = localStorage.getItem(typeSwitchKey(personId, "prospect")) === "1";
  } catch {
    // Storage blocked: off.
  }
  return { contact: false, prospect, filtered: false };
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
