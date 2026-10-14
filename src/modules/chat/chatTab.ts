import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  MAX_PINS_PER_TAB,
  pinConversation,
  unpinConversation,
  type ChatTab,
  type ConversationSummary,
} from "@/data";
import { storageKey } from "@/lib/config";

export const TAB_LABEL: Record<ChatTab, string> = {
  groups: "Groups",
  direct: "Direct messages",
};

const tabKey = (personId: string) => storageKey(`chatTab.${personId}`);

function readTab(personId: string): ChatTab {
  try {
    return localStorage.getItem(tabKey(personId)) === "direct" ? "direct" : "groups";
  } catch {
    return "groups";
  }
}

/**
 * The chat list tab, remembered per viewer (a per-browser convenience). When a
 * conversation is opened (a deep link, a DM started from a group), the list
 * switches to that conversation's tab.
 */
export function useChatListTab(
  personId: string,
  selected: { id: string; tab: ChatTab } | undefined,
): [ChatTab, (t: ChatTab) => void] {
  const [tab, setTab] = useState<ChatTab>(() => readTab(personId));
  const selectedKey = selected ? `${selected.id}:${selected.tab}` : "";
  const [followed, setFollowed] = useState("");
  if (selected && selectedKey !== followed) {
    setFollowed(selectedKey);
    if (selected.tab !== tab) setTab(selected.tab);
  }
  useEffect(() => {
    if (!personId) return;
    try {
      localStorage.setItem(tabKey(personId), tab);
    } catch {
      // Per-viewer convenience only.
    }
  }, [personId, tab]);
  return [tab, setTab];
}

/** Pin or unpin a chat in your own list, with a friendly message at the cap. */
export function togglePin(c: ConversationSummary): void {
  if (c.pinned) {
    unpinConversation(c.id);
    toast.success(`Unpinned ${c.title}`);
    return;
  }
  const res = pinConversation(c.id);
  if (res.ok) {
    toast.success(`Pinned ${c.title}`, {
      description: `It stays at the top of ${TAB_LABEL[c.tab]}.`,
    });
  } else if (res.reason === "limit") {
    toast.error(`You can pin up to ${MAX_PINS_PER_TAB} chats in ${TAB_LABEL[c.tab]}`, {
      description: "Unpin one to make room for this one.",
    });
  }
}
