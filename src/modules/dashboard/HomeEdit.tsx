import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Eye, EyeOff, GripVertical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toastWithUndo } from "@/components/log/quickLog";
import {
  HOME_CARD_LABEL,
  arrangeHome,
  hiddenCards,
  hideHomeCard,
  moveHomeCard,
  nudgeHomeCard,
  resetHomeLayout,
  setHomeLayout,
  showHomeCard,
  shownCards,
  useHomeLayout,
  type HomeArrangement,
  type HomeCardId,
  type HomeLayout,
} from "@/data";
import {
  columnBoxes,
  dropTarget,
  layoutCards,
  type DropColumn,
  type DropPlace,
  type Geometry,
} from "./homeDrag";

/**
 * Home's edit mode. Every card is a short preview of itself (its real content,
 * capped in height, not interactive) that you pick up as a whole:
 *  - Mouse and pen: the card lifts after the pointer has moved 5px.
 *  - Touch: hold the card for 350 ms; moving before that scrolls the page.
 *  - Keyboard: Space or Enter picks it up, the arrow keys move it (left and
 *    right switch columns), Space or Enter drops it, Escape puts it back.
 * A picked-up card follows the pointer (transform only), a placeholder of its
 * size shows where it will land and the other cards slide aside; near the top
 * or bottom of the page the page scrolls. Escape or a cancelled pointer puts
 * everything back. Each card also has a Hide button; hidden cards are listed
 * under "Hidden" with a Show button. The cards are placed with transforms from
 * `layoutCards` (./homeDrag), so nothing is reflowed per frame and the browser
 * animates the slide. Saved per person (src/data/homeLayout.ts).
 */

type Dir = "up" | "down" | "left" | "right";
const KEY_DIR: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** As on the pipeline board: a touch picks a card up after this long. */
const HOLD_MS = 350;
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
const LIFT = 1.03;
const LIFT_MS = 140;
const GLIDE_MS = 180;
/** Near the top or bottom of the page this many px, it scrolls (up to this speed, px/s). */
const EDGE_ZONE = 72;
const EDGE_SPEED = 900;

interface Held {
  id: string;
  mode: "pointer" | "keyboard";
  /** Where inside the card it was grabbed, and its size then (pointer). */
  gx: number;
  gy: number;
  w: number;
  t0: number;
}

const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const label = (id: string) => HOME_CARD_LABEL[id as HomeCardId] ?? id;

function columnsOf(a: HomeArrangement, desktop: boolean): string[][] {
  return desktop ? [a.main, a.side] : [a.all];
}

function placeText(id: string, a: HomeArrangement, desktop: boolean): string {
  if (!desktop) return `position ${a.all.indexOf(id) + 1} of ${a.all.length}`;
  const col = a.side.includes(id) ? "side" : "main";
  return `position ${a[col].indexOf(id) + 1} of ${a[col].length}, ${col} column`;
}

function scrollerOf(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

export function HomeEdit({
  cards,
  desktop,
  visible,
  onDone,
}: {
  cards: Partial<Record<string, ReactNode>>;
  desktop: boolean;
  /** Cards this person can see right now (hidden or not). */
  visible: ReadonlySet<string>;
  onDone: () => void;
}) {
  const saved = useHomeLayout();
  const shown = useMemo(() => shownCards(saved, visible), [saved, visible]);
  const hiddenIds = useMemo(() => hiddenCards(saved, visible), [saved, visible]);

  const [held, setHeld] = useState<Held | null>(null);
  const [working, setWorkingState] = useState<HomeLayout | null>(null);
  const [gliding, setGliding] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [settled, setSettled] = useState(false);
  const [focusSel, setFocusSel] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const refCache = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const observer = useRef<ResizeObserver | null>(null);
  const heldRef = useRef<Held | null>(null);
  const workingRef = useRef<HomeLayout | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const target = useRef<DropPlace | null>(null);
  const raf = useRef(0);
  const lastT = useRef(0);
  const lastTransform = useRef("");
  const scrollAcc = useRef(0);
  const scroller = useRef<HTMLElement | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const timers = useRef<number[]>([]);

  const setWorking = (w: HomeLayout | null) => {
    workingRef.current = w;
    setWorkingState(w);
  };
  const say = (msg: string) => setAnnounce((prev) => (prev.trim() === msg ? `${msg}\u00a0` : msg));

  // What is shown: the saved arrangement, or the one being tried while a card is held.
  const base = working ?? saved;
  const arr = useMemo(() => arrangeHome(base, shown), [base, shown]);
  const cols = useMemo(() => columnsOf(arr, desktop), [arr, desktop]);
  const geo: Geometry = useMemo(
    () => ({ width, gap: desktop ? 16 : 12, desktop }),
    [width, desktop],
  );
  const layout = useMemo(() => layoutCards(cols, heights, geo), [cols, heights, geo]);
  // DOM (and tab) order follows what is saved, so it doesn't move while a card is held.
  const savedArr = useMemo(() => arrangeHome(saved, shown), [saved, shown]);
  const domIds = desktop ? [...savedArr.main, ...savedArr.side] : savedArr.all;
  const domKey = domIds.join();

  const latest = useRef({ saved, shown, visible, desktop, geo, heights, cols, layout, arr });
  useLayoutEffect(() => {
    latest.current = { saved, shown, visible, desktop, geo, heights, cols, layout, arr };
  });

  // --- Measuring ---------------------------------------------------------------------
  const measure = useCallback((target: Element) => {
    const li = target.closest<HTMLElement>("[data-home-card]");
    const id = li?.dataset.homeCard;
    if (!li || !id) return;
    const prev = li.querySelector<HTMLElement>("[data-preview]");
    if (prev) {
      if (prev.scrollHeight > prev.clientHeight + 1) prev.dataset.clipped = "";
      else delete prev.dataset.clipped;
    }
    const h = Math.round(li.offsetHeight);
    setHeights((hs) => (hs[id] === h ? hs : { ...hs, [id]: h }));
  }, []);

  const getObserver = useCallback(() => {
    observer.current ??= new ResizeObserver((entries) => {
      for (const e of entries) measure(e.target);
    });
    return observer.current;
  }, [measure]);

  const refFor = (id: string) => {
    let f = refCache.current.get(id);
    if (!f) {
      f = (el) => {
        if (el) {
          els.current.set(id, el);
          const ro = getObserver();
          ro.observe(el);
          const body = el.querySelector("[data-card-body]");
          if (body) ro.observe(body);
        } else {
          const old = els.current.get(id);
          if (old) {
            observer.current?.unobserve(old);
            const body = old.querySelector("[data-card-body]");
            if (body) observer.current?.unobserve(body);
          }
          els.current.delete(id);
        }
      };
      refCache.current.set(id, f);
    }
    return f;
  };

  useLayoutEffect(() => {
    const g = gridRef.current;
    if (!g) return;
    setWidth(Math.round(g.getBoundingClientRect().width));
    const ro = new ResizeObserver(() => setWidth(Math.round(g.getBoundingClientRect().width)));
    ro.observe(g);
    return () => ro.disconnect();
  }, []);

  useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
    },
    [],
  );

  // Slide animations only once the first layout is in place.
  useEffect(() => {
    if (settled || width <= 0) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setSettled(true)));
    return () => cancelAnimationFrame(id);
  }, [settled, width]);

  // After a change that moves or removes the focused element, put the focus back.
  useEffect(() => {
    if (!focusSel) return;
    document.querySelector<HTMLElement>(focusSel)?.focus();
    setFocusSel(null);
  }, [focusSel, domKey]);

  // --- Pointer drag -------------------------------------------------------------------
  const paintHeld = useCallback((now: number) => {
    const h = heldRef.current;
    const g = gridRef.current;
    if (!h || h.mode !== "pointer" || !g) return;
    const el = els.current.get(h.id);
    if (!el) return;
    const r = g.getBoundingClientRect();
    const ramp = reduced() ? 1 : Math.min(1, (now - h.t0) / LIFT_MS);
    const s = 1 + (LIFT - 1) * (1 - (1 - ramp) ** 3);
    const tr = `translate3d(${pointer.current.x - r.left - h.gx}px, ${pointer.current.y - r.top - h.gy}px, 0) scale(${s})`;
    if (tr !== lastTransform.current) {
      lastTransform.current = tr;
      el.style.transform = tr;
    }
  }, []);

  useLayoutEffect(() => {
    if (held?.mode === "pointer") {
      const el = els.current.get(held.id);
      if (el) el.style.transformOrigin = `${held.gx}px ${held.gy}px`;
      paintHeld(held.t0);
    }
  }, [held, paintHeld]);

  const dropColumns = (L: typeof latest.current, id: string): DropColumn[] => {
    const boxes = columnBoxes(L.geo);
    return L.cols.map((ids, k) => ({
      x: boxes[k].x,
      w: boxes[k].w,
      items: ids
        .filter((x) => x !== id)
        .map((x) => ({ y: L.layout.pos[x]?.y ?? 0, h: L.layout.pos[x]?.h ?? 0 })),
    }));
  };

  const placeOf = (L: typeof latest.current, id: string): DropPlace => {
    const k = Math.max(
      0,
      L.cols.findIndex((ids) => ids.includes(id)),
    );
    return { column: k, index: Math.max(0, L.cols[k].indexOf(id)) };
  };

  const tick = useCallback(
    (t: number) => {
      const h = heldRef.current;
      const g = gridRef.current;
      if (!h || h.mode !== "pointer" || !g) return;
      raf.current = requestAnimationFrame(tick);
      const dt = Math.min(50, t - lastT.current);
      lastT.current = t;

      // Edge scrolling: near the top (below the bar) or bottom of the page.
      const sc = scroller.current;
      if (sc) {
        const isDoc = sc === document.scrollingElement || sc === document.documentElement;
        const box = isDoc ? { top: 0, bottom: window.innerHeight } : sc.getBoundingClientRect();
        const top = Math.max(0, box.top);
        const bottom = Math.min(window.innerHeight, box.bottom);
        const topEdge = Math.max(top, barRef.current?.getBoundingClientRect().bottom ?? top);
        const y = pointer.current.y;
        let v = 0;
        if (y < topEdge + EDGE_ZONE) {
          v = -(Math.min(1, (topEdge + EDGE_ZONE - y) / EDGE_ZONE) ** 2) * EDGE_SPEED;
        } else if (y > bottom - EDGE_ZONE) {
          v = Math.min(1, (y - (bottom - EDGE_ZONE)) / EDGE_ZONE) ** 2 * EDGE_SPEED;
        }
        if (v) {
          scrollAcc.current += (v * dt) / 1000;
          const whole = Math.trunc(scrollAcc.current);
          if (whole) {
            sc.scrollTop += whole;
            scrollAcc.current -= whole;
          }
        } else scrollAcc.current = 0;
      }

      paintHeld(t);

      const L = latest.current;
      const r = g.getBoundingClientRect();
      const next = dropTarget(
        { x: pointer.current.x - r.left, y: pointer.current.y - r.top },
        dropColumns(L, h.id),
        target.current,
      );
      const cur = target.current;
      if (!cur || cur.column !== next.column || cur.index !== next.index) {
        target.current = next;
        setWorking(
          moveHomeCard(L.saved, L.shown, h.id, {
            column: L.desktop ? (next.column === 0 ? "main" : "side") : null,
            index: next.index,
          }),
        );
      }
    },
    [paintHeld],
  );

  /** The slot of card `id` if `lay` (or the saved layout) were shown. */
  const slotFor = (id: string, lay: HomeLayout | null) => {
    const L = latest.current;
    const a = arrangeHome(lay ?? L.saved, L.shown);
    return layoutCards(columnsOf(a, L.desktop), L.heights, L.geo).pos[id];
  };

  const finish = (commit: boolean) => {
    const h = heldRef.current;
    if (!h || h.mode !== "pointer") return;
    stop.current?.();
    stop.current = null;
    cancelAnimationFrame(raf.current);
    const next = commit ? workingRef.current : null;
    if (!commit) setWorking(null);
    const dest = slotFor(h.id, commit ? next : null);
    const el = els.current.get(h.id);
    const complete = () => {
      if (el) {
        el.style.transition = "";
        el.style.transformOrigin = "";
      }
      heldRef.current = null;
      if (next) {
        setHomeLayout(next);
        const L = latest.current;
        const a = arrangeHome(next, shownCards(next, L.visible));
        say(`${label(h.id)} moved to ${placeText(h.id, a, L.desktop)}.`);
      } else if (!commit) {
        say(`Move cancelled. ${label(h.id)} is back where it was.`);
      }
      setHeld(null);
      setGliding(false);
      setWorking(null);
    };
    if (!el || !dest || reduced()) {
      complete();
      return;
    }
    setGliding(true);
    el.style.transition = `transform ${GLIDE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow ${GLIDE_MS}ms`;
    el.style.transform = `translate3d(${dest.x}px, ${dest.y}px, 0) scale(1)`;
    timers.current.push(window.setTimeout(complete, GLIDE_MS + 30));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0 || heldRef.current || stop.current) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    const li = e.currentTarget;
    const touch = e.pointerType === "touch";
    const pid = e.pointerId;
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;
    let hold: number | undefined;
    let press: number | undefined;
    try {
      li.setPointerCapture?.(pid);
    } catch {
      // Not a live pointer (synthetic events): moves still arrive on the card.
    }

    const unbind = () => {
      window.clearTimeout(hold);
      window.clearTimeout(press);
      delete li.dataset.pressing;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("touchmove", touchMove);
    };
    const activate = (x: number, y: number) => {
      active = true;
      window.clearTimeout(press);
      delete li.dataset.pressing;
      const r = li.getBoundingClientRect();
      const L = latest.current;
      const h: Held = {
        id,
        mode: "pointer",
        gx: sx - r.left,
        gy: sy - r.top,
        w: r.width,
        t0: performance.now(),
      };
      heldRef.current = h;
      pointer.current = { x, y };
      lastTransform.current = "";
      scrollAcc.current = 0;
      scroller.current = scrollerOf(li);
      target.current = placeOf(L, id);
      setWorking(null);
      setHeld(h);
      if (touch) navigator.vibrate?.(8);
      say(`Picked up ${label(id)}. Drag to move it, Escape to cancel.`);
      lastT.current = h.t0;
      raf.current = requestAnimationFrame(tick);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (!active) {
        const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
        if (touch) {
          if (dist > TOUCH_SLOP) {
            unbind(); // a scroll, not a hold
            stop.current = null;
          }
          return;
        }
        if (dist < MOUSE_SLOP) return;
        activate(ev.clientX, ev.clientY);
      }
      pointer.current = { x: ev.clientX, y: ev.clientY };
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (!active) {
        unbind();
        stop.current = null;
        return;
      }
      unbind();
      finish(true);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (!active) {
        unbind();
        stop.current = null;
        return;
      }
      unbind();
      finish(false);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      const was = active;
      unbind();
      if (was) finish(false);
      else stop.current = null;
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
    if (touch) {
      press = window.setTimeout(() => {
        li.dataset.pressing = "";
      }, 120);
      hold = window.setTimeout(() => activate(sx, sy), HOLD_MS);
    }
    stop.current = () => {
      unbind();
      stop.current = null;
    };
  };

  useEffect(
    () => () => {
      stop.current?.();
      cancelAnimationFrame(raf.current);
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  // Escape with nothing held leaves edit mode.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || heldRef.current) return;
      onDone();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onDone]);

  // --- Keyboard ----------------------------------------------------------------------
  const keyboardCancel = (id: string) => {
    heldRef.current = null;
    setHeld(null);
    setWorking(null);
    say(`Move cancelled. ${label(id)} is back where it was.`);
  };

  const onGrabKey = (e: React.KeyboardEvent<HTMLElement>, id: string) => {
    const mine = held?.mode === "keyboard" && held.id === id;
    if (e.key === "Escape") {
      if (mine) {
        e.preventDefault();
        keyboardCancel(id);
      }
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (e.repeat || (held && !mine)) return;
      if (!mine) {
        const h: Held = { id, mode: "keyboard", gx: 0, gy: 0, w: 0, t0: 0 };
        heldRef.current = h;
        setHeld(h);
        setWorking(null);
        say(
          `Picked up ${label(id)}, ${placeText(id, arr, desktop)}. ${
            desktop
              ? "Use the arrow keys to move it; left and right switch columns."
              : "Use the up and down arrow keys to move it."
          } Space or Enter to drop, Escape to cancel.`,
        );
      } else {
        const next = workingRef.current;
        heldRef.current = null;
        setHeld(null);
        setWorking(null);
        if (next) setHomeLayout(next);
        setFocusSel(`[data-home-grab="${id}"]`);
        say(`Dropped ${label(id)}, ${placeText(id, arr, desktop)}.`);
      }
      return;
    }
    const dir = KEY_DIR[e.key];
    if (dir && mine) {
      e.preventDefault();
      const next = nudgeHomeCard(workingRef.current ?? saved, shown, id, dir, desktop);
      if (!next) {
        say(`${label(id)} can't move ${dir === "up" || dir === "down" ? dir : `further ${dir}`}.`);
        return;
      }
      setWorking(next);
      say(`${label(id)} moved to ${placeText(id, arrangeHome(next, shown), desktop)}.`);
    }
  };

  // --- Hide, show, reset -------------------------------------------------------------
  const hide = (id: string) => {
    if (heldRef.current) return;
    const at = domIds.indexOf(id);
    const nextId = domIds[at + 1] ?? domIds[at - 1];
    setHomeLayout(hideHomeCard(saved, id));
    setFocusSel(nextId ? `[data-home-grab="${nextId}"]` : "[data-home-done]");
    say(`${label(id)} hidden. It's listed under Hidden, at the end.`);
  };
  const show = (id: string) => {
    const next = showHomeCard(saved, id);
    setHomeLayout(next);
    const restShown = shownCards(next, visible);
    const another = hiddenIds.find((x) => x !== id);
    setFocusSel(another ? `[data-home-show="${another}"]` : `[data-home-grab="${id}"]`);
    say(`${label(id)} is back on Home, ${placeText(id, arrangeHome(next, restShown), desktop)}.`);
  };
  const reset = () => {
    if (heldRef.current) return;
    const before = saved;
    resetHomeLayout();
    say("Layout reset: the usual order, nothing hidden.");
    if (before) toastWithUndo("Home is back to the usual layout", () => setHomeLayout(before));
  };

  const boxes = columnBoxes(geo);
  const noneShown = shown.size === 0;
  const pointerHeld = held?.mode === "pointer" ? held : null;
  const slot = pointerHeld ? layout.pos[pointerHeld.id] : null;

  return (
    <div className="select-none">
      <div
        ref={barRef}
        className="sticky top-2 z-40 flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-card px-3 py-2 sm:px-4"
      >
        <h2 className="text-sm font-bold">Edit layout</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={reset} disabled={!saved || !!held}>
            <RotateCcw /> Reset layout
          </Button>
          <Button size="sm" data-home-done onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[12.5px] text-foreground">
        {desktop
          ? "Drag a card to move it, or focus it and press Space. Hide the ones you don't want. It's saved for you on every device."
          : "Press and hold a card, then drag it. Hide the ones you don't want. It's saved for you on every device."}
      </p>
      <p id="home-edit-keys" className="sr-only">
        {desktop
          ? "Press Space or Enter to pick the card up, the arrow keys to move it (left and right switch columns), Space or Enter to drop it, Escape to cancel."
          : "Press Space or Enter to pick the card up, the up and down arrow keys to move it, Space or Enter to drop it, Escape to cancel."}
      </p>

      {noneShown ? (
        <p className="mt-3 rounded-card border border-dashed border-line px-4 py-8 text-center text-sm text-foreground">
          Every card is hidden. Use Show below to bring one back.
        </p>
      ) : (
        <div
          ref={gridRef}
          data-home-edit-grid
          role="list"
          aria-label="Home cards"
          className="relative mt-3"
          style={{ height: Math.max(layout.height, desktop ? 96 : 0) }}
        >
          {desktop &&
            cols.map(
              (ids, k) =>
                ids.length === 0 && (
                  <div
                    key={k}
                    aria-hidden="true"
                    className="absolute top-0 grid h-24 place-items-center rounded-card border border-dashed border-line text-xs text-foreground"
                    style={{ left: boxes[k].x, width: boxes[k].w }}
                  >
                    {k === 0 ? "Nothing in the main column" : "Nothing in the side column"}
                  </div>
                ),
            )}
          {slot && (
            <div
              data-home-slot=""
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute left-0 top-0 rounded-card border-2 border-dashed border-primary bg-primary-soft",
                settled &&
                  "transition-transform duration-[180ms] ease-out motion-reduce:transition-none motion-reduce:duration-0",
              )}
              style={{
                width: slot.w,
                height: slot.h,
                transform: `translate3d(${slot.x}px, ${slot.y}px, 0)`,
              }}
            />
          )}
          {domIds.map((id) => {
            const p = layout.pos[id];
            const isPointer = pointerHeld?.id === id;
            const isKeys = held?.mode === "keyboard" && held.id === id;
            const text = `${label(id)}, ${placeText(id, arr, desktop)}`;
            return (
              <div
                key={id}
                ref={refFor(id)}
                role="listitem"
                data-home-card={id}
                onPointerDown={(e) => onPointerDown(e, id)}
                onContextMenu={(e) => e.preventDefault()}
                onDragStart={(e) => e.preventDefault()}
                className={cn(
                  "absolute left-0 top-0 touch-pan-y rounded-card border border-line bg-card text-card-foreground [-webkit-touch-callout:none]",
                  "cursor-grab data-[pressing]:scale-[0.985] data-[pressing]:ring-2 data-[pressing]:ring-primary/50",
                  heights[id] == null && "opacity-0",
                  isPointer
                    ? cn(
                        "glass-flat z-30 will-change-transform cursor-grabbing transition-[box-shadow] duration-150 motion-reduce:transition-none motion-reduce:duration-0",
                        !gliding &&
                          "shadow-[0_22px_44px_var(--shadow-tint-strong)] ring-2 ring-primary",
                      )
                    : cn(
                        settled &&
                          "transition-transform duration-[180ms] ease-out motion-reduce:transition-none motion-reduce:duration-0",
                        isKeys &&
                          "z-30 scale-[1.03] shadow-[0_22px_44px_var(--shadow-tint-strong)] ring-2 ring-primary",
                      ),
                )}
                style={
                  isPointer
                    ? { width: pointerHeld.w }
                    : p
                      ? {
                          width: p.w,
                          transform: `translate3d(${p.x}px, ${p.y}px, 0)`,
                        }
                      : undefined
                }
              >
                <div
                  role="button"
                  tabIndex={0}
                  data-home-grab={id}
                  aria-label={text}
                  aria-pressed={isKeys}
                  aria-describedby="home-edit-keys"
                  onKeyDown={(e) => onGrabKey(e, id)}
                  onBlur={() => {
                    if (isKeys) keyboardCancel(id);
                  }}
                  className="block rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <div className="flex items-center gap-1.5 py-1.5 pl-2.5 pr-12">
                    <GripVertical
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 truncate text-sm font-semibold">{label(id)}</span>
                  </div>
                  <div className="px-2 pb-2">
                    <div
                      data-preview=""
                      inert
                      aria-hidden="true"
                      className="pointer-events-none max-h-[160px] overflow-hidden data-[clipped]:[mask-image:linear-gradient(to_bottom,black_60%,transparent)]"
                    >
                      <div
                        data-card-body
                        className={cn("peer grid min-w-0", desktop ? "gap-4" : "gap-3")}
                      >
                        {cards[id]}
                      </div>
                      <p className="hidden px-2 py-3 text-xs text-foreground peer-empty:block">
                        Nothing to show right now.
                      </p>
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  data-no-drag=""
                  className="absolute right-0.5 top-0 size-9 text-muted-foreground"
                  aria-label={`Hide ${label(id)}`}
                  title="Hide"
                  onClick={() => hide(id)}
                >
                  <EyeOff />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <section aria-labelledby="home-hidden-heading" className="mt-6 grid gap-2">
        <h2 id="home-hidden-heading" className="text-sm font-bold">
          Hidden
        </h2>
        {hiddenIds.length === 0 ? (
          <p className="text-[12.5px] text-foreground">
            Nothing hidden. Use the eye button on a card to take it off Home.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {hiddenIds.map((id) => (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface py-1 pl-3 pr-1.5"
              >
                <span className="min-w-0 truncate text-sm font-semibold">{label(id)}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-home-show={id}
                  aria-label={`Show ${label(id)}`}
                  onClick={() => show(id)}
                >
                  <Eye /> Show
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
