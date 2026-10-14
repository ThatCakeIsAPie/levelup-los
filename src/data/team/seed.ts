/**
 * Demo seed for team settings: Maria's deputies and the feature switches.
 *  - Marcus Hill (6) is Maria's deputy (the deputy demo login).
 *  - Admin Tester (800), the admin login, is her deputy too, so the admin
 *    tries switched-off features against the team's real data.
 *  - No switch rows: Chats, Library and Campaigns are off for the team.
 */
import type { Deputy, FeatureSwitch } from "./types";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export function seedDeputies(): Deputy[] {
  return [
    { leaderId: "1", deputyId: "6", addedBy: "1", addedAt: daysAgo(21) },
    { leaderId: "1", deputyId: "800", addedBy: "1", addedAt: daysAgo(9) },
  ];
}

export function seedFeatureSwitches(): FeatureSwitch[] {
  return [];
}
