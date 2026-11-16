import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { CalItem } from "./calendar";
import {
  dayAt,
  edgeDirection,
  EDGE_HOLD_MS,
  HOLD_MS,
  MOUSE_SLOP,
  pageDistance,
  TOUCH_SLOP,
} from "./calendarDrag";

/**
 * Drag an event to another day of the Events calendar with pointer events, the way the pipeline board's cards
 * move (src/modules/pipeline/useBoardDrag.ts):
 *  - Mouse / pen: the event is picked up after the pointer moves 5px.
 *  - Touch: hold it (350 ms) to pick it up; moving before that scrolls or swipes as usual. While one is held,
 *    the page does not scroll.
 *  - The day under the pointer is `over` (found by the week row `[data-week]` under it and the column in it, so
 *    other events drawn over a day never hide it). Holding the pointer near the top or bottom of the scroller for
 *    about 700 ms scrolls it by one page (and again every 700 ms while it stays there), so an event can go further.
 *  - Escape and a cancelled pointer put the event back. A drop on the day it was picked up on does nothing.
 *  - The click that follows a drop is swallowed, so the drop never opens an event or selects a day.
 * The calendar has no way to move an event without a pointer; the event's form (Edit) is the keyboard path.
 */
export interface CalendarDragState {
  item: CalItem;
  /** The day of the item the pointer took hold of (a bar of several days is held by one of them). */
  grabDay: string;
  /** The day under the pointer, or null when it is not over a day. */
  over: string | null;
}

export function useCalendarDrag({
  scroller,
  onDrop,
}: {
  scroller: RefObject<HTMLElement | null>;
  onDrop: (item: CalItem, grabDay: string, over: string) => void;
}) {
  const [drag, setDrag] = useState<CalendarDragState | null>(null);
  const dragRef = useRef<CalendarDragState | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const pos = useRef({ x: 0, y: 0 });
  const ghost = useRef<HTMLElement | null>(null);
  /** A touch is down on an event and not yet picked up (or is carrying it): the long-press menu must stay shut. */
  const touching = useRef(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const set = (d: CalendarDragState | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  useEffect(() => () => cleanup.current?.(), []);

  const place = useCallback(() => {
    const el = ghost.current;
    if (el) el.style.transform = `translate3d(${pos.current.x + 10}px, ${pos.current.y - 14}px, 0)`;
  }, []);
  /** Ref callback for the lifted copy that follows the pointer. */
  const setGhost = useCallback(
    (el: HTMLElement | null) => {
      ghost.current = el;
      if (el) place();
    },
    [place],
  );

  const dayUnder = (x: number, y: number): string | null => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-week]");
    if (!row?.dataset.week) return null;
    const r = row.getBoundingClientRect();
    return dayAt(row.dataset.week, r.left, r.width, x);
  };

  const start = useCallback(
    (e: ReactPointerEvent, item: CalItem, grabDay?: string) => {
      if (e.button !== 0 || dragRef.current || !e.isPrimary) return;
      const touch = e.pointerType === "touch";
      const sx = e.clientX;
      const sy = e.clientY;
      const grab = grabDay ?? dayUnder(sx, sy) ?? item.date;
      let active = false;
      let hold: number | undefined;
      let edgeTimer: number | undefined;
      let edgeDir = 0;
      let frame = 0;
      pos.current = { x: sx, y: sy };
      touching.current = touch;

      const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const refreshOver = () => {
        const d = dragRef.current;
        if (!d) return;
        const over = dayUnder(pos.current.x, pos.current.y);
        if (over !== d.over) set({ ...d, over });
      };
      const stopEdge = () => {
        window.clearTimeout(edgeTimer);
        edgeTimer = undefined;
        edgeDir = 0;
      };
      const page = () => {
        const el = scroller.current;
        if (!el || !dragRef.current) return;
        const dir = edgeDirection(el.getBoundingClientRect(), pos.current.x, pos.current.y);
        if (dir !== edgeDir) return;
        el.scrollBy({
          top: dir * pageDistance(el.clientHeight),
          behavior: reduced() ? "auto" : "smooth",
        });
        edgeTimer = window.setTimeout(page, EDGE_HOLD_MS);
      };
      const watchEdge = () => {
        const el = scroller.current;
        if (!el) return;
        const dir = edgeDirection(el.getBoundingClientRect(), pos.current.x, pos.current.y);
        if (dir === edgeDir) return;
        stopEdge();
        edgeDir = dir;
        if (dir) edgeTimer = window.setTimeout(page, EDGE_HOLD_MS);
      };
      const onScroll = () => {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          refreshOver();
        });
      };

      const activate = () => {
        active = true;
        if (touch) navigator.vibrate?.(8);
        set({ item, grabDay: grab, over: dayUnder(pos.current.x, pos.current.y) });
        scroller.current?.addEventListener("scroll", onScroll, { passive: true });
        watchEdge();
      };
      const swallowClick = (stillDown: boolean) => {
        // The click that ends a drag (a tap after a touch hold too) belongs to the drop, not to whatever is under it.
        // After Escape the pointer is still down: its release comes later, and its click is swallowed too.
        const stop = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
          release(); // only the one click that belongs to the drop
        };
        const release = () => {
          window.removeEventListener("pointerup", armed, true);
          window.removeEventListener("pointercancel", armed, true);
          window.removeEventListener("click", stop, true);
        };
        const armed = () => window.setTimeout(release, 250);
        window.addEventListener("click", stop, true);
        if (stillDown) {
          window.addEventListener("pointerup", armed, { capture: true, once: true });
          window.addEventListener("pointercancel", armed, { capture: true, once: true });
          window.setTimeout(release, 8000);
        } else armed();
      };
      const finish = (drop: boolean, stillDown = false) => {
        const d = dragRef.current;
        cleanup.current?.();
        if (active) swallowClick(stillDown);
        set(null);
        if (drop && d?.over) onDropRef.current(d.item, d.grabDay, d.over);
      };
      const move = (ev: PointerEvent) => {
        pos.current = { x: ev.clientX, y: ev.clientY };
        if (!active) {
          const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
          if (touch) {
            if (dist > TOUCH_SLOP) finish(false); // a scroll or a swipe, not a hold
            return;
          }
          if (dist < MOUSE_SLOP) return;
          activate();
        }
        place();
        refreshOver();
        watchEdge();
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const key = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") finish(false, true);
      };
      // Once a touch drag is active the page must not scroll.
      const touchMove = (ev: TouchEvent) => {
        if (active) ev.preventDefault();
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key);
      window.addEventListener("touchmove", touchMove, { passive: false });
      if (touch) hold = window.setTimeout(activate, HOLD_MS);
      cleanup.current = () => {
        window.clearTimeout(hold);
        stopEdge();
        if (frame) window.cancelAnimationFrame(frame);
        scroller.current?.removeEventListener("scroll", onScroll);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key);
        window.removeEventListener("touchmove", touchMove);
        // The long-press menu of a touch can still arrive just after the finger lifts.
        window.setTimeout(() => (touching.current = false), 600);
        cleanup.current = null;
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scroller],
  );

  /** On an event: keeps a touch's long-press menu (and the link preview) from opening while it is held. */
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (touching.current || dragRef.current) e.preventDefault();
  }, []);

  return { drag, start, setGhost, onContextMenu };
}
