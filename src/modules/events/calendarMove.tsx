import { useCallback, useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { moveEventFollowing, moveEventOne, updateEvent, type EventCategory } from "@/data";
import { cn } from "@/lib/utils";
import { dayDelta, daysShift, dropDates, movedToast } from "./calendarDrag";
import { barClass, categoryIcon, useCategoryMap } from "./calendarHelpers";
import { formatEventRange } from "./lib";
import { SeriesScopeDialog, type SeriesScope } from "./SeriesScopeDialog";
import { useCalendarDrag } from "./useCalendarDrag";
import type { CalItem } from "./calendar";

/** What a chip needs to be draggable (set only for people who may edit events; never on Home's week card). */
export interface ChipDrag {
  start: (e: React.PointerEvent, item: CalItem, grabDay?: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** The key of the item being carried: its chips stay where they are, dimmed. */
  liftedKey: string | null;
}

interface Asked {
  item: CalItem;
  date: string;
  endDate?: string;
  days: number;
}

const UNDO_MS = 8000;

/**
 * Drag to move on the Events calendar, for both layouts: the pointer handling (useCalendarDrag), what a drop does
 * and the lifted copy that follows the pointer.
 *  - A one-time event moves without a question.
 *  - An occurrence of a repeating event asks "Move just this one" (it leaves the series and becomes a one-time
 *    event) or "Move all" (this and every later occurrence shift by the same days, and so does the rule); Cancel
 *    leaves everything as it was.
 *  - A toast names what moved, with Undo.
 * `enabled` is whether the viewer may edit events; without it nothing can be picked up.
 */
export function useCalendarMove({
  enabled,
  scroller,
  categories,
  onMoved,
}: {
  enabled: boolean;
  scroller: RefObject<HTMLElement | null>;
  categories: EventCategory[];
  /** Called with the new first day once something has moved (the phone layout shows that day). */
  onMoved?: (date: string) => void;
}) {
  const byId = useCategoryMap(categories);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [busy, setBusy] = useState(false);

  const announce = useCallback(
    (
      date: string,
      moved: number,
      undo: () => Promise<{ ok: boolean }> | { ok: boolean } | void,
    ) => {
      toast(movedToast(date, moved), {
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            void Promise.resolve(undo()).then((r) => {
              if (r && !r.ok) toast.error("Couldn't undo that move.");
            });
          },
        },
      });
      onMoved?.(date);
    },
    [onMoved],
  );

  const moveSingle = useCallback(
    (item: CalItem, to: { date: string; endDate?: string }) => {
      const id = item.eventId;
      if (!id) return;
      updateEvent(id, { date: to.date, ...(to.endDate ? { endDate: to.endDate } : {}) });
      announce(to.date, 1, () => {
        updateEvent(id, { date: item.date, endDate: item.endDate });
      });
    },
    [announce],
  );

  const drop = useCallback(
    (item: CalItem, grabDay: string, over: string) => {
      const to = dropDates(item, grabDay, over);
      if (!to) return;
      if (item.seriesId) setAsked({ item, ...to, days: dayDelta(grabDay, over) });
      else moveSingle(item, to);
    },
    [moveSingle],
  );

  const { drag, start, setGhost, onContextMenu } = useCalendarDrag({ scroller, onDrop: drop });
  const liftedKey = drag?.item.key ?? null;

  const choose = async (scope: SeriesScope) => {
    if (!asked || !asked.item.eventId) return;
    setBusy(true);
    const r =
      scope === "this"
        ? await moveEventOne(asked.item.eventId, asked.date, asked.endDate)
        : await moveEventFollowing(asked.item.eventId, asked.days);
    setBusy(false);
    setAsked(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    announce(asked.date, r.moved, r.undo);
  };

  const chip = useMemo<ChipDrag | undefined>(
    () => (enabled ? { start, onContextMenu, liftedKey } : undefined),
    [enabled, start, onContextMenu, liftedKey],
  );

  // The grabbing hand over everything while an event is carried.
  const carrying = !!drag;
  useEffect(() => {
    if (!carrying) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.cursor = prev;
    };
  }, [carrying]);

  const category = drag ? byId.get(drag.item.categoryId) : undefined;
  const Icon = categoryIcon(category);
  const ui: ReactNode = (
    <>
      {drag &&
        createPortal(
          <div
            ref={setGhost}
            aria-hidden="true"
            data-calendar-ghost
            className="glass glass-lifted pointer-events-none fixed left-0 top-0 z-[60] w-max max-w-[15rem] rounded-md bg-card p-0.5 shadow-[0_12px_28px_var(--shadow-tint-strong)] ring-2 ring-primary will-change-transform"
          >
            <span
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-1 text-[12px] font-semibold leading-4",
                barClass(category),
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{drag.item.name}</span>
            </span>
          </div>,
          document.body,
        )}
      {asked && (
        <SeriesScopeDialog
          open
          onOpenChange={(o) => !o && !busy && setAsked(null)}
          title={`Move ${asked.item.name}?`}
          description={`${formatEventRange(asked.item)} would move to ${formatEventRange({ ...asked.item, date: asked.date, endDate: asked.endDate })}. Moving just this one makes it a one-time event. Move all moves this one and every later one ${daysShift(asked.days)}; earlier ones stay.`}
          thisLabel="Move just this one"
          followingLabel="Move all"
          busy={busy}
          onChoose={choose}
        />
      )}
    </>
  );

  return { chip, overDay: drag?.over ?? null, ui };
}
