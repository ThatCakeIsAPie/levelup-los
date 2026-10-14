import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useIsDesktop } from "@/components/brand";
import { isPlayable, type CatalogItem } from "@/data";
import { playLibraryItem } from "./player/store";

/** Link props for an item's page (optionally inside a channel). */
export function itemHref(itemId: string, channelId?: string | null) {
  return {
    to: "/library/item/$itemId" as const,
    params: { itemId },
    search: channelId ? { channel: channelId } : {},
  };
}

/** Link props for a channel. */
export function channelHref(channelId: string) {
  return { to: "/library/$channelId" as const, params: { channelId } };
}

/**
 * Open a lesson: audio and uploaded video start in the player (full screen on
 * phones); documents, slides and links open their page.
 */
export function useOpenItem() {
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  return useCallback(
    (item: CatalogItem, channelId?: string | null) => {
      if (isPlayable(item)) {
        playLibraryItem(item.id, { channelId: channelId ?? null, expand: !desktop });
        // Desktop video: show it big on its page (it keeps playing from there).
        if (!(desktop && item.kind === "video")) return;
      }
      void navigate(itemHref(item.id, channelId));
    },
    [navigate, desktop],
  );
}
