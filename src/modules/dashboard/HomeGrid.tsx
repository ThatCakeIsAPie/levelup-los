import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  GripHorizontal,
  GripVertical,
  LayoutGrid,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toastWithUndo } from "@/components/log/quickLog";
import {
  HOME_CARD_LABEL,
  arrangeHome,
  moveHomeCard,
  nudgeHomeCard,
  resetHomeLayout,
  setHomeLayout,
  useHomeLayout,
  type HomeCardId,
  type HomeColumn,
} from "@/data";

/** Home's cards by id; null = not shown to this person (locked, switched off). */
export type HomeCards = Partial<Record<HomeCardId, ReactNode | null>>;

type Dir = "up" | "down" | "left" | "right";
const KEY_DIR: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Where a dragged card would land: before `before` in `column` (null = the end). */
interface Drop {
  column: HomeColumn | null;
  before: string | null;
}

/**
 * Home's cards in the person's own order (src/data/homeLayout.ts). Desktop:
 * two columns, each card with a drag handle on its top edge (on hover or
 * focus; arrow keys move it, left and right switch columns). Phones: one
 * column. "Edit layout" (both) lists the cards with move buttons and a
 * handle to drag, plus "Reset layout". Saved per person (server-side with
 * real accounts).
 */
export function HomeGrid({ cards, desktop }: { cards: HomeCards; desktop: boolean }) {
  const saved = useHomeLayout();
  const visible = useMemo(
    () =>
      new Set(
        Object.entries(cards)
          .filter(([, node]) => node != null)
          .map(([id]) => id),
      ),
    [cards],
  );
  const arr = useMemo(() => arrangeHome(saved, visible), [saved, visible]);
  const [editing, setEditing] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const label = (id: string) => HOME_CARD_LABEL[id as HomeCardId] ?? id;

  // Keep the keyboard on the handle of the card just moved (it may have
  // changed columns, so it's a new element).
  useEffect(() => {
    if (!focusId) return;
    root.current?.querySelector<HTMLElement>(`[data-home-grip="${focusId}"]`)?.focus();
    setFocusId(null);
  }, [focusId, arr]);

  const place = (id: string, a = arr) => {
    if (!desktop) return `${a.all.indexOf(id) + 1} of ${a.all.length}`;
    const col = a.side.includes(id) ? "side" : "main";
    return `${col === "side" ? "right" : "left"} column, ${a[col].indexOf(id) + 1} of ${a[col].length}`;
  };

  const nudge = (id: string, dir: Dir) => {
    const next = nudgeHomeCard(saved, visible, id, dir, desktop);
    if (!next) return;
    setHomeLayout(next);
    setFocusId(id);
    setAnnounce(`${label(id)} moved: ${place(id, arrangeHome(next, visible))}.`);
  };

  const drop = (id: string, d: Drop) => {
    const col: HomeColumn | null = desktop ? (d.column ?? "main") : null;
    const list = (col ? arr[col] : arr.all).filter((x) => x !== id);
    const index = d.before ? list.indexOf(d.before) : list.length;
    const next = moveHomeCard(saved, visible, id, {
      column: col,
      index: index < 0 ? list.length : index,
    });
    setHomeLayout(next);
    setAnnounce(`${label(id)} moved: ${place(id, arrangeHome(next, visible))}.`);
  };

  const reset = () => {
    const before = saved;
    resetHomeLayout();
    setAnnounce("Layout reset.");
    if (before) toastWithUndo("Home is back to the usual layout", () => setHomeLayout(before));
  };

  const drag = useCardDrag(root, desktop, drop);

  const columns: { key: HomeColumn | null; ids: string[] }[] = desktop
    ? [
        { key: "main", ids: arr.main },
        { key: "side", ids: arr.side },
      ]
    : [{ key: null, ids: arr.all }];

  const live = (
    <p className="sr-only" aria-live="polite">
      {announce}
    </p>
  );

  if (editing) {
    return (
      <section
        ref={root}
        aria-labelledby="home-layout-heading"
        className="grid gap-3 rounded-card border border-line bg-card p-4 sm:px-[18px]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="home-layout-heading" className="text-sm font-bold">
              Edit layout
            </h2>
            <p className="text-[12.5px] text-muted-foreground">
              {desktop
                ? "Drag a card, or use the arrows. It's saved for you on every device."
                : "Move cards up or down, or drag the handle. It's saved for you on every device."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={reset} disabled={!saved}>
              <RotateCcw /> Reset layout
            </Button>
            <Button size="sm" onClick={() => setEditing(false)}>
              Done
            </Button>
          </div>
        </div>
        <div
          className={cn("grid gap-3", desktop && "grid-cols-[1.6fr_1fr] items-start")}
          data-dragging={drag.dragging ? "" : undefined}
        >
          {columns.map((c) => (
            <div key={c.key ?? "all"} className="grid min-w-0 content-start gap-1.5">
              {desktop && (
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {c.key === "side" ? "Right column" : "Left column"}
                </h3>
              )}
              <ol
                data-home-col={c.key ?? "all"}
                aria-label={desktop ? (c.key === "side" ? "Right column" : "Left column") : "Cards"}
                className={cn(
                  "grid min-h-12 content-start gap-1.5 rounded-lg",
                  drag.dragging && "outline-dashed outline-1 outline-offset-2 outline-line",
                )}
              >
                {c.ids.map((id, i) => (
                  <li
                    key={id}
                    data-home-card={id}
                    className={cn(
                      "relative flex items-center gap-1.5 rounded-lg border border-line bg-surface p-1",
                      drag.dragging === id && "opacity-50",
                      dropClass(drag.drop, c.key, id, c.ids, desktop),
                    )}
                  >
                    <Grip
                      id={id}
                      label={label(id)}
                      place={place(id)}
                      desktop={desktop}
                      drag={drag}
                      onNudge={nudge}
                      vertical
                    />
                    <span className="min-w-0 flex-1 truncate pl-0.5 text-sm font-semibold">
                      {label(id)}
                    </span>
                    <MoveButton
                      dir="up"
                      label={label(id)}
                      disabled={i === 0}
                      onClick={() => nudge(id, "up")}
                    />
                    <MoveButton
                      dir="down"
                      label={label(id)}
                      disabled={i === c.ids.length - 1}
                      onClick={() => nudge(id, "down")}
                    />
                    {desktop && (
                      <MoveButton
                        dir={c.key === "side" ? "left" : "right"}
                        label={label(id)}
                        onClick={() => nudge(id, c.key === "side" ? "left" : "right")}
                      />
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        {live}
      </section>
    );
  }

  return (
    <>
      <div
        ref={root}
        className={cn(
          "grid items-start",
          desktop ? "grid-cols-[1.6fr_1fr] gap-4" : "grid-cols-1 gap-3",
        )}
      >
        {columns.map((c) => (
          <div
            key={c.key ?? "all"}
            data-home-col={c.key ?? "all"}
            className={cn(
              "grid min-w-0 content-start",
              desktop ? "gap-4" : "gap-3",
              drag.dragging &&
                "min-h-24 rounded-card outline-dashed outline-1 outline-offset-4 outline-line",
            )}
          >
            {c.ids.map((id) => (
              <div
                key={id}
                data-home-card={id}
                className={cn(
                  "group/card relative min-w-0 has-[>[data-card-body]:empty]:hidden",
                  drag.dragging === id && "opacity-50",
                  dropClass(drag.drop, c.key, id, c.ids, desktop),
                )}
              >
                <div data-card-body className={cn("grid min-w-0", desktop ? "gap-4" : "gap-3")}>
                  {cards[id as HomeCardId]}
                </div>
                {desktop && (
                  <Grip
                    id={id}
                    label={label(id)}
                    place={place(id)}
                    desktop
                    drag={drag}
                    onNudge={nudge}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex justify-center">
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => {
            setEditing(true);
            requestAnimationFrame(() =>
              root.current?.scrollIntoView({ block: "start", behavior: "smooth" }),
            );
          }}
        >
          <LayoutGrid /> Edit layout
        </Button>
      </div>
      {live}
    </>
  );
}

/** The drop line: above the card it goes before, or below the last one. */
function dropClass(
  drop: Drop | null,
  column: HomeColumn | null,
  id: string,
  ids: string[],
  desktop: boolean,
): string | false {
  if (!drop || (desktop && drop.column !== column)) return false;
  const line = "before:absolute before:inset-x-1 before:h-1 before:rounded-full before:bg-primary";
  if (drop.before === id) return cn(line, "before:-top-2.5");
  if (drop.before === null && ids[ids.length - 1] === id) return cn(line, "before:-bottom-2.5");
  return false;
}

function MoveButton({
  dir,
  label,
  disabled,
  onClick,
}: {
  dir: Dir;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = { up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight }[dir];
  const words = {
    up: "up",
    down: "down",
    left: "to the left column",
    right: "to the right column",
  }[dir];
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-8 shrink-0 text-muted-foreground"
      aria-label={`Move ${label} ${words}`}
      title={`Move ${words}`}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon />
    </Button>
  );
}

/** A card's handle: drag it, or focus it and use the arrow keys. */
function Grip({
  id,
  label,
  place,
  desktop,
  drag,
  onNudge,
  vertical,
}: {
  id: string;
  label: string;
  place: string;
  desktop: boolean;
  drag: CardDrag;
  onNudge: (id: string, dir: Dir) => void;
  /** In the Edit layout list (a row handle) rather than on a card's top edge. */
  vertical?: boolean;
}) {
  const keys = desktop
    ? "Use the arrow keys to move it; left and right switch columns."
    : "Use the up and down arrow keys to move it.";
  return (
    <button
      type="button"
      data-home-grip={id}
      aria-label={`Move ${label}, ${place}. ${keys}`}
      title="Drag to move"
      className={cn(
        "grid cursor-grab touch-none place-items-center text-faint hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing",
        vertical
          ? "size-8 shrink-0 rounded-md"
          : "absolute -top-2.5 left-1/2 z-10 h-5 w-12 -translate-x-1/2 rounded-full border border-line bg-surface opacity-0 shadow-sm transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
        !vertical && drag.dragging === id && "opacity-100",
      )}
      onKeyDown={(e) => {
        const dir = KEY_DIR[e.key];
        if (dir) {
          e.preventDefault();
          onNudge(id, dir);
        } else if (e.key === "Escape") drag.cancel();
      }}
      onPointerDown={(e) => drag.start(e, id)}
      onPointerMove={drag.move}
      onPointerUp={drag.end}
      onPointerCancel={drag.cancel}
    >
      {vertical ? (
        <GripVertical className="size-4" aria-hidden="true" />
      ) : (
        <GripHorizontal className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}

interface CardDrag {
  dragging: string | null;
  drop: Drop | null;
  start: (e: React.PointerEvent<HTMLElement>, id: string) => void;
  move: (e: React.PointerEvent<HTMLElement>) => void;
  end: () => void;
  cancel: () => void;
}

/**
 * Pointer drag between `[data-home-col]` lists of `[data-home-card]` items
 * under `root`: the card goes before the first card whose middle is below
 * the pointer, in the column under it (desktop) or the one list (phones).
 * Esc or a cancelled pointer puts it back.
 */
function useCardDrag(
  root: React.RefObject<HTMLElement | null>,
  desktop: boolean,
  onDrop: (id: string, drop: Drop) => void,
): CardDrag {
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const dropRef = useRef<Drop | null>(null);
  const startAt = useRef({ x: 0, y: 0 });

  const target = (x: number, y: number, id: string): Drop | null => {
    const cols = [...(root.current?.querySelectorAll<HTMLElement>("[data-home-col]") ?? [])];
    if (!cols.length) return null;
    let col = cols[0];
    if (desktop && cols.length > 1) {
      const dist = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      };
      col = cols.reduce((best, c) => (dist(c) < dist(best) ? c : best));
    }
    const cards = [...col.querySelectorAll<HTMLElement>(":scope > [data-home-card]")].filter(
      (el) => el.dataset.homeCard !== id && el.getClientRects().length > 0,
    );
    const below = cards.find((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    const key = col.dataset.homeCol;
    return {
      column: key === "main" || key === "side" ? key : null,
      before: below?.dataset.homeCard ?? null,
    };
  };

  const set = (d: Drop | null) => {
    dropRef.current = d;
    setDrop(d);
  };

  return {
    dragging,
    drop,
    start: (e, id) => {
      if (e.button !== 0) return;
      // Keep getting moves while the pointer leaves the handle.
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Not a live pointer (synthetic events): moves still arrive on the handle.
      }
      startAt.current = { x: e.clientX, y: e.clientY };
      setDragging(id);
      set(null);
    },
    move: (e) => {
      if (!dragging) return;
      // A small slop so a click on the handle doesn't count as a drag.
      const moved =
        Math.abs(e.clientX - startAt.current.x) + Math.abs(e.clientY - startAt.current.y);
      if (!dropRef.current && moved < 5) return;
      set(target(e.clientX, e.clientY, dragging));
    },
    end: () => {
      const d = dropRef.current;
      const id = dragging;
      setDragging(null);
      set(null);
      if (id && d) onDrop(id, d);
    },
    cancel: () => {
      setDragging(null);
      set(null);
    },
  };
}
