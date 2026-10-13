import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Drag a card between board columns with pointer events.
 *  - Mouse / pen: the drag starts after the pointer moves 5px.
 *  - Touch: hold the card (350 ms) to pick it up; moving before that scrolls
 *    the board as usual. While dragging, page scrolling is blocked.
 * Columns are found under the pointer by their `data-drop-column` attribute.
 * Near the scroller's left or right edge the board scrolls (one column at a
 * time on phones). Escape cancels. Keyboard users use the "Move to…" menu.
 */
export interface DragInfo {
  personId: string;
  name: string;
  from: string;
  x: number;
  y: number;
  over: string | null;
}

const HOLD_MS = 350;
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
const EDGE = 44;

export function useBoardDrag({
  scroller,
  onDrop,
  pageStep,
}: {
  scroller: RefObject<HTMLElement | null>;
  onDrop: (personId: string, to: string) => void;
  /** Scroll by one column (phones) instead of smoothly. */
  pageStep?: boolean;
}) {
  const [drag, setDrag] = useState<DragInfo | null>(null);
  const dragRef = useRef<DragInfo | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  /** Set right after a drop so the card's click (opening details) is skipped. */
  const suppressClick = useRef(false);
  const lastEdgeScroll = useRef(0);

  const set = (d: DragInfo | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  useEffect(() => () => cleanup.current?.(), []);

  const overAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    return el?.closest<HTMLElement>("[data-drop-column]")?.dataset.dropColumn ?? null;
  };

  const edgeScroll = useCallback(
    (x: number) => {
      const el = scroller.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dir = x < r.left + EDGE ? -1 : x > r.right - EDGE ? 1 : 0;
      if (!dir) return;
      if (pageStep) {
        const now = Date.now();
        if (now - lastEdgeScroll.current < 650) return;
        lastEdgeScroll.current = now;
        el.scrollBy({ left: dir * el.clientWidth * 0.84, behavior: "smooth" });
      } else {
        el.scrollBy({ left: dir * 18 });
      }
    },
    [scroller, pageStep],
  );

  const start = useCallback(
    (e: React.PointerEvent, card: { personId: string; name: string; column: string }) => {
      if (e.button !== 0 || dragRef.current) return;
      if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
      const touch = e.pointerType === "touch";
      const sx = e.clientX;
      const sy = e.clientY;
      let active = false;
      let timer: number | undefined;

      const activate = (x: number, y: number) => {
        active = true;
        if (touch) navigator.vibrate?.(8);
        set({ ...card, from: card.column, x, y, over: overAt(x, y) });
      };
      const finish = (drop: boolean) => {
        const d = dragRef.current;
        cleanup.current?.();
        if (active) {
          suppressClick.current = true;
          window.setTimeout(() => (suppressClick.current = false), 0);
        }
        set(null);
        if (drop && d?.over && d.over !== d.from) onDrop(d.personId, d.over);
      };
      const move = (ev: PointerEvent) => {
        if (!active) {
          const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
          if (touch) {
            if (dist > TOUCH_SLOP) finish(false); // a scroll, not a hold
            return;
          }
          if (dist < MOUSE_SLOP) return;
          activate(ev.clientX, ev.clientY);
        }
        const d = dragRef.current;
        if (!d) return;
        set({ ...d, x: ev.clientX, y: ev.clientY, over: overAt(ev.clientX, ev.clientY) });
        edgeScroll(ev.clientX);
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const key = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") finish(false);
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
      if (touch) timer = window.setTimeout(() => activate(sx, sy), HOLD_MS);
      cleanup.current = () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key);
        window.removeEventListener("touchmove", touchMove);
        cleanup.current = null;
      };
    },
    [edgeScroll, onDrop],
  );

  return { drag, start, suppressClick };
}
