/**
 * Team-level settings that sit beside the CRM: feature switches (phase 2 and
 * 3 features, per team) and a leader's deputies. Tables `feature_switches`
 * and `deputies` (migration 20261014001500_unlocks_deputies_admin.sql).
 */

import type { DataSource } from "@/lib/config";

/** The switched features. All are off for a team unless a leader turns them on, except those with `defaultOn`. */
export type FeatureKey = "chats" | "library" | "campaigns" | "agents";

export interface FeatureInfo {
  key: FeatureKey;
  label: string;
  /** The later phase it was built in; a feature without one shows no phase chip. */
  phase?: 2 | 3;
  /** One line for the switch in Team settings; none, none shown. */
  description?: string;
  /**
   * Needs the hosted data source (a Supabase project): something runs there that the
   * browser-storage demo has no counterpart for. `featuresFor` leaves it out of the demo,
   * so its switch is never offered where it could not work.
   */
  hosted?: boolean;
  /** On for a team with no stored switch (an explicit row, on or off, always decides). */
  defaultOn?: boolean;
}

export const FEATURES: readonly FeatureInfo[] = [
  {
    key: "chats",
    label: "Chats",
    phase: 2,
    description: "Team chats, direct messages, wins and the chat parts of the inbox.",
  },
  {
    key: "library",
    label: "Library",
    phase: 2,
    description: "Talks, audios and channels to learn from, with progress.",
  },
  {
    key: "campaigns",
    label: "Campaigns",
    phase: 3,
    description: "Messages sent to a group of people at once.",
  },
  { key: "agents", label: "AI agents", hosted: true, defaultOn: true },
];

export const FEATURE_KEYS: readonly FeatureKey[] = FEATURES.map((f) => f.key);

/** Is the feature on for a team that never stored a switch for it? */
export function featureDefault(key: FeatureKey): boolean {
  return FEATURES.find((f) => f.key === key)?.defaultOn === true;
}

/**
 * The features that can work with this data source: all of them with Supabase, all but the
 * hosted ones in the browser-storage demo. Everything that SHOWS a feature (the switch list in
 * Team settings, the admin card) asks here; the full `FEATURES` list stays for lookups by key.
 */
export function featuresFor(source: DataSource): readonly FeatureInfo[] {
  return FEATURES.filter((f) => !f.hosted || source === "supabase");
}

/** One team's switch for one feature (no row means the feature's default: off, except AI agents). */
export interface FeatureSwitch {
  workspaceId: string;
  feature: FeatureKey;
  enabled: boolean;
  /** Who flipped it last, and when (stamped by the database with real accounts). */
  updatedBy?: string;
  updatedAt?: string;
}

/** A leader's deputy: sees what the leader sees and edits on the leader's behalf. */
export interface Deputy {
  leaderId: string;
  deputyId: string;
  addedBy?: string;
  addedAt?: string;
}

export interface TeamData {
  deputies: Deputy[];
  switches: FeatureSwitch[];
}
