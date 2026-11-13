/**
 * The team's look (re-exported from "@/data"): what the leader chose for the
 * whole team in Settings > Team > Appearance. Pure rules in ./rules.ts (tested),
 * the page-level application in src/lib/teamLook.ts.
 */
export * from "./types";
export { isDefaultLook, lookProblem, sameLook, isLookPath, parseLook } from "./rules";
export { useTeamLook, getTeamLook, useCanChangeLook, lookWorkspaceId } from "./hooks";
export { saveTeamLook, resetTeamLook, type NewPictures } from "./mutations";
export { showSavedLook, hideTeamLook, previewTeamLook, endTeamLookPreview } from "./apply";
export { resolveLook } from "./resolve";
export { forgetLocalLook } from "./local";
