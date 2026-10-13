import { useState } from "react";
import { MessagesSquare } from "lucide-react";
import { useIsDesktop, useMediaQuery } from "@/components/brand";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useChatAccess } from "@/data";
import { ChatGate } from "./ChatGate";
import { ChatList } from "./ChatList";
import { ConversationView } from "./Conversation";
import { DetailsPanel } from "./DetailsPanel";

const DETAILS_KEY = "levelup.chatDetailsOpen";

function readDetailsPref(): boolean {
  try {
    return localStorage.getItem(DETAILS_KEY) !== "0";
  } catch {
    return true;
  }
}

/**
 * /chats and /chats/$id. Desktop (lg+): chat list | conversation | details
 * (the details pane is collapsible; below 1280px it opens as a sheet).
 * Phone: the list, or a full-screen conversation over the tab bar with a
 * back button. People without chat get an explanation instead.
 */
export function ChatsScreen({
  selectedId,
  focusMessageId,
}: {
  selectedId?: string;
  focusMessageId?: string;
}) {
  const access = useChatAccess();
  const desktop = useIsDesktop();
  const wide = useMediaQuery("(min-width: 1280px)");
  const [paneOpen, setPaneOpen] = useState(readDetailsPref);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!access.eligible) return <ChatGate access={access} />;

  const togglePane = () => {
    const next = !paneOpen;
    setPaneOpen(next);
    try {
      localStorage.setItem(DETAILS_KEY, next ? "1" : "0");
    } catch {
      // Per-viewer convenience only.
    }
  };
  const detailsSheet = selectedId && (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetContent side="right" className="w-full overflow-y-auto px-4 pb-safe pt-5 sm:max-w-sm">
        <SheetHeader className="sr-only">
          <SheetTitle>Chat details</SheetTitle>
          <SheetDescription>Members, shared media and settings for this chat.</SheetDescription>
        </SheetHeader>
        <DetailsPanel id={selectedId} />
      </SheetContent>
    </Sheet>
  );

  if (desktop) {
    const inlineDetails = wide && paneOpen && !!selectedId;
    return (
      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Chat list"
          className="w-[300px] shrink-0 overflow-y-auto border-r border-line bg-surface px-3.5 py-4"
        >
          <ChatList selectedId={selectedId} sectionLabels />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedId ? (
            <ConversationView
              id={selectedId}
              focusMessageId={focusMessageId}
              detailsOpen={wide ? paneOpen : sheetOpen}
              onDetails={wide ? togglePane : () => setSheetOpen(true)}
            />
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div className="grid justify-items-center gap-2 text-muted-foreground">
                <MessagesSquare className="size-8 text-faint" aria-hidden="true" />
                <p className="text-sm font-semibold text-foreground">Pick a chat</p>
                <p className="max-w-xs text-[13px]">
                  Your team chats are pinned on top; groups and direct messages follow.
                </p>
              </div>
            </div>
          )}
        </div>
        {inlineDetails && (
          <aside
            aria-label="Chat details"
            className="w-[260px] shrink-0 overflow-y-auto border-l border-line bg-surface px-3.5 py-4"
          >
            <DetailsPanel id={selectedId} onClose={togglePane} />
          </aside>
        )}
        {!wide && detailsSheet}
      </div>
    );
  }

  if (!selectedId) {
    return (
      <div className="px-4 py-5">
        <ChatList />
      </div>
    );
  }
  // Full screen above the tab bar: a conversation has its own composer at the bottom.
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-app pb-safe pt-safe">
      <ConversationView
        id={selectedId}
        focusMessageId={focusMessageId}
        onBack
        detailsOpen={sheetOpen}
        onDetails={() => setSheetOpen(true)}
      />
      {detailsSheet}
    </div>
  );
}
