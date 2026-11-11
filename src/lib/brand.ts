import { brand } from "@/brand/brand";

/** Document / share title for a page: "Dashboard — <app name>"; the bare app name without a section. */
export function pageTitle(section?: string): string {
  return section ? `${section} — ${brand.name}` : brand.name;
}

/** localStorage key for the current brand: storageKey("crm") -> "<prefix>.crm". */
export function storageKey(name: string): string {
  return `${brand.storagePrefix}.${name}`;
}

/** Prefix shared by every localStorage key (used to wipe the demo's saved data). */
export const STORAGE_KEY_PREFIX = `${brand.storagePrefix}.`;

/** IndexedDB database name for the current brand: dbName("chat-media") -> "<prefix>-chat-media". */
export function dbName(name: string): string {
  return `${brand.storagePrefix}-${name}`;
}
