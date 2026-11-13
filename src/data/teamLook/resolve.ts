/**
 * A look's pictures as URLs that are safe to use (`ResolvedLook`): with real
 * accounts the public storage URL built from the validated path; in the demo a
 * `blob:` URL of the picture saved in IndexedDB.
 */
import { IS_SUPABASE } from "@/lib/config";
import { teamImageUrl, type ResolvedLook } from "@/lib/teamLook";
import { localObjectUrl } from "./local";
import type { TeamLook } from "./types";

/** The demo reads its pictures from IndexedDB, so this is a promise there. */
export async function resolveLook(look: TeamLook): Promise<ResolvedLook> {
  if (IS_SUPABASE) {
    return {
      look,
      backgroundUrl: look.backgroundPath ? teamImageUrl(look.backgroundPath) : null,
      logoUrl: look.logoPath ? teamImageUrl(look.logoPath) : null,
    };
  }
  const [backgroundUrl, logoUrl] = await Promise.all([
    look.backgroundPath ? localObjectUrl(look.backgroundPath) : null,
    look.logoPath ? localObjectUrl(look.logoPath) : null,
  ]);
  return { look, backgroundUrl, logoUrl };
}
