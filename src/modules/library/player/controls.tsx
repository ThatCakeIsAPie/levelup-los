import { useEffect, useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { Pause, Play, RotateCcw, RotateCw, SkipForward, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatClock } from "@/data";
import { cycleRate, rateLabel, seekBy, seekTo, togglePlayback, usePlayerStore } from "./store";

/** Seek bar (sky on the track color) with elapsed and remaining/total time. */
export function SeekBar({
  className,
  remaining,
  compact,
}: {
  className?: string;
  /** Show "−7:03" on the right instead of the total. */
  remaining?: boolean;
  compact?: boolean;
}) {
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? position;
  // A new item resets any half-finished drag.
  const itemId = usePlayerStore((s) => s.itemId);
  useEffect(() => setDrag(null), [itemId]);
  const right = remaining
    ? `−${formatClock(Math.max(0, duration - shown))}`
    : formatClock(duration);
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <small className="w-11 shrink-0 text-right text-[11.5px] tabular-nums text-muted-foreground">
        {formatClock(shown)}
      </small>
      <SliderPrimitive.Root
        className="relative flex h-5 w-full min-w-0 touch-none select-none items-center"
        min={0}
        max={Math.max(1, duration)}
        step={1}
        value={[Math.min(shown, Math.max(1, duration))]}
        onValueChange={([v]) => setDrag(v)}
        onValueCommit={([v]) => {
          seekTo(v);
          setDrag(null);
        }}
        disabled={!duration}
        aria-label="Seek"
      >
        <SliderPrimitive.Track
          className={cn(
            "relative w-full grow overflow-hidden rounded-full bg-track",
            compact ? "h-1" : "h-1.5",
          )}
        >
          <SliderPrimitive.Range className="absolute h-full bg-sky" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className="block size-3.5 rounded-full border-2 border-surface bg-sky shadow focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Position"
        />
      </SliderPrimitive.Root>
      <small className="w-12 shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
        {right}
      </small>
    </div>
  );
}

const ROUND =
  "grid shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40";

/** Play / pause in the brand primary. */
export function PlayPauseButton({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const playing = usePlayerStore((s) => s.playing);
  const status = usePlayerStore((s) => s.status);
  const Icon = status === "loading" && playing ? Loader2 : playing ? Pause : Play;
  return (
    <button
      type="button"
      onClick={togglePlayback}
      disabled={status === "error"}
      aria-label={playing ? "Pause" : "Play"}
      className={cn(
        ROUND,
        "bg-primary text-primary-foreground hover:bg-primary/90",
        size === "sm" && "size-9 [&_svg]:size-4",
        size === "md" && "size-11 [&_svg]:size-5",
        size === "lg" && "size-16 [&_svg]:size-7",
      )}
    >
      <Icon
        className={cn(Icon === Loader2 && "animate-spin", Icon === Play && "translate-x-px")}
        aria-hidden="true"
      />
    </button>
  );
}

/** Back / forward 15 seconds. */
export function SkipButton({ dir, size = "md" }: { dir: -1 | 1; size?: "md" | "lg" }) {
  const Icon = dir < 0 ? RotateCcw : RotateCw;
  return (
    <button
      type="button"
      onClick={() => seekBy(dir * 15)}
      aria-label={dir < 0 ? "Back 15 seconds" : "Forward 15 seconds"}
      className={cn(
        ROUND,
        "text-foreground hover:bg-surface-2",
        size === "md" ? "size-9 [&_svg]:size-[18px]" : "size-12 [&_svg]:size-6",
      )}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

/** Next lesson in the channel. */
export function NextButton({
  onNext,
  disabled,
  size = "md",
}: {
  onNext: () => void;
  disabled: boolean;
  size?: "md" | "lg";
}) {
  return (
    <button
      type="button"
      onClick={onNext}
      disabled={disabled}
      aria-label="Next lesson"
      className={cn(
        ROUND,
        "text-foreground hover:bg-surface-2",
        size === "md" ? "size-9 [&_svg]:size-[18px]" : "size-12 [&_svg]:size-6",
      )}
    >
      <SkipForward aria-hidden="true" />
    </button>
  );
}

/** 1× / 1.25× / 1.5× / 2× (cycles). */
export function SpeedButton({ className }: { className?: string }) {
  const rate = usePlayerStore((s) => s.rate);
  return (
    <button
      type="button"
      onClick={cycleRate}
      aria-label={`Playback speed ${rateLabel(rate)}. Change speed`}
      className={cn(
        "min-w-[52px] rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-bold tabular-nums hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      {rateLabel(rate)}
    </button>
  );
}
