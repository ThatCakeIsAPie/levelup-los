import { useMemo, type ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  arrangeHome,
  hiddenCards,
  shownCards,
  useHomeLayout,
  type HomeCardId,
  type HomeColumn,
} from "@/data";
import { HomeEdit } from "./HomeEdit";

/** Home's cards by id; null = not shown to this person (locked, switched off). */
export type HomeCards = Partial<Record<HomeCardId, ReactNode | null>>;

/**
 * Home's header control: opens edit mode (an icon with the same accessible
 * name on phones).
 */
export function EditLayoutButton({ desktop, onClick }: { desktop: boolean; onClick: () => void }) {
  return desktop ? (
    <Button size="sm" variant="outline" onClick={onClick}>
      <LayoutGrid /> Edit layout
    </Button>
  ) : (
    <Button
      size="icon"
      variant="outline"
      aria-label="Edit layout"
      title="Edit layout"
      onClick={onClick}
    >
      <LayoutGrid />
    </Button>
  );
}

/**
 * Home's cards in the person's own order, minus the ones they hid
 * (src/data/homeLayout.ts). Desktop: two columns; phones: one. The cards
 * can't be moved here: edit mode (`editing`, opened by `EditLayoutButton` in
 * the header; HomeEdit.tsx) is where they are arranged, hidden and shown.
 * Saved per person (server-side with real accounts).
 */
export function HomeGrid({
  cards,
  desktop,
  editing,
  onEditingChange,
}: {
  cards: HomeCards;
  desktop: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const saved = useHomeLayout();
  const key = Object.entries(cards)
    .filter(([, node]) => node != null)
    .map(([id]) => id)
    .join();
  // The cards this person can see, hidden or not.
  const visible = useMemo(() => new Set(key ? key.split(",") : []), [key]);
  const shown = useMemo(() => shownCards(saved, visible), [saved, visible]);
  const arr = useMemo(() => arrangeHome(saved, shown), [saved, shown]);

  if (editing) {
    return (
      <HomeEdit
        cards={cards}
        desktop={desktop}
        visible={visible}
        onDone={() => onEditingChange(false)}
      />
    );
  }

  if (shown.size === 0 && hiddenCards(saved, visible).length > 0) {
    return (
      <div className="glass grid justify-items-center gap-3 rounded-card border border-line bg-card px-4 py-10 text-center">
        <p className="text-[15px] font-bold">Everything on Home is hidden</p>
        <p className="max-w-[40ch] text-[13px] text-muted-foreground">
          Bring cards back whenever you like: open Edit layout and choose Show.
        </p>
        <Button size="sm" onClick={() => onEditingChange(true)}>
          <LayoutGrid /> Edit layout
        </Button>
      </div>
    );
  }

  const columns: { key: HomeColumn | null; ids: string[] }[] = desktop
    ? [
        { key: "main", ids: arr.main },
        { key: "side", ids: arr.side },
      ]
    : [{ key: null, ids: arr.all }];

  return (
    <div
      className={cn(
        "grid items-start",
        desktop ? "grid-cols-[1.6fr_1fr] gap-4" : "grid-cols-1 gap-3",
      )}
    >
      {columns.map((c) => (
        <div
          key={c.key ?? "all"}
          data-home-col={c.key ?? "all"}
          className={cn("grid min-w-0 content-start", desktop ? "gap-4" : "gap-3")}
        >
          {c.ids.map((id) => (
            <div
              key={id}
              data-home-card={id}
              className="relative min-w-0 has-[>[data-card-body]:empty]:hidden"
            >
              <div data-card-body className={cn("grid min-w-0", desktop ? "gap-4" : "gap-3")}>
                {cards[id as HomeCardId]}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
