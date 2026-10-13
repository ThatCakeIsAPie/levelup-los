/**
 * Team-level settings that sit beside the CRM: feature switches (phase 2 and
 * 3 features, per team) and a leader's deputies. Tables `feature_switches`
 * and `deputies` (migration 20261014001500_unlocks_deputies_admin.sql).
 */

/** Features built for later phases, switched off for a team unless a leader turns them on. */
export type FeatureKey = "chats" | "library" | "campaigns";

export interface FeatureInfo {
  key: FeatureKey;
  label: string;
  phase: 2 | 3;
  /** One line for the switch in Team settings. */
  description: string;
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
];

export const FEATURE_KEYS: readonly FeatureKey[] = FEATURES.map((f) => f.key);

/** One team's switch for one feature (no row means off). */
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
