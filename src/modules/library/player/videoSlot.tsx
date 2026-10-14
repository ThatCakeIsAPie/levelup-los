/**
 * The player owns ONE media element for the whole app (so playback never
 * restarts while you navigate). A video needs to be shown somewhere: places
 * that can show it render <VideoSlot priority={…}/>, and the element is moved
 * (not re-created) into the highest-priority slot on screen, or back into the
 * player's hidden parking spot when there is none. Moving an element within
 * the document keeps it playing.
 */
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type Slot = { el: HTMLElement; priority: number; order: number };
const slots: Slot[] = [];
let order = 0;
let media: HTMLMediaElement | null = null;
let parking: HTMLElement | null = null;

function place() {
  if (!media) return;
  const best = slots.reduce<Slot | null>(
    (b, s) =>
      !b || s.priority > b.priority || (s.priority === b.priority && s.order > b.order) ? s : b,
    null,
  );
  const target = best?.el ?? parking;
  if (target && media.parentElement !== target) target.appendChild(media);
}

/** Called by LibraryPlayer once the element and its parking spot exist. */
export function attachMedia(el: HTMLMediaElement | null, park: HTMLElement | null): void {
  media = el;
  parking = park;
  place();
}

/** Where the current video shows (fills its box, letterboxed). Priority: higher wins. */
export function VideoSlot({ priority, className }: { priority: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const slot = { el, priority, order: ++order };
    slots.push(slot);
    place();
    return () => {
      slots.splice(slots.indexOf(slot), 1);
      place();
    };
  }, [priority]);
  return (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden bg-black [&>video]:block [&>video]:size-full [&>video]:object-contain",
        className,
      )}
    />
  );
}
