import { useEffect, useRef, useState } from "react";
import { ImageOff, Loader2, Pause, Play } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAttachmentUrl, useWaveform, type Attachment } from "@/data";
import { duration } from "./format";

const BARS = 34;

/**
 * Inline voice-note player: play/pause, a waveform drawn from the audio
 * itself (progress fills it) and the time. Click or arrow keys on the
 * waveform seek.
 */
export function VoicePlayer({ attachment, label }: { attachment: Attachment; label: string }) {
  const url = useAttachmentUrl(attachment.storagePath);
  const peaks = useWaveform(attachment.storagePath, BARS);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const total = (attachment.durationMs ?? 0) / 1000;
  const length = () => {
    const d = audio.current?.duration;
    return d && Number.isFinite(d) ? d : total;
  };
  const progress = length() > 0 ? Math.min(1, pos / length()) : 0;

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const tick = () => setPos(a.currentTime);
    const end = () => {
      setPlaying(false);
      setPos(0);
    };
    a.addEventListener("timeupdate", tick);
    a.addEventListener("ended", end);
    a.addEventListener("pause", () => setPlaying(false));
    a.addEventListener("play", () => setPlaying(true));
    return () => {
      a.removeEventListener("timeupdate", tick);
      a.removeEventListener("ended", end);
    };
  }, [url]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) {
      // Pause any other voice note that's playing.
      document.querySelectorAll<HTMLAudioElement>("audio[data-voice]").forEach((x) => {
        if (x !== a) x.pause();
      });
      void a.play().catch(() => setPlaying(false));
    } else a.pause();
  };
  const seek = (fraction: number) => {
    const a = audio.current;
    const len = length();
    if (!a || !len) return;
    a.currentTime = Math.max(0, Math.min(len, fraction * len));
    setPos(a.currentTime);
  };

  const unavailable = url === null;
  return (
    <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5">
      <button
        type="button"
        onClick={toggle}
        disabled={!url}
        aria-label={`${playing ? "Pause" : "Play"} ${label}`}
        className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {url === undefined ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : playing ? (
          <Pause className="size-4" aria-hidden="true" />
        ) : (
          <Play className="size-4" aria-hidden="true" />
        )}
      </button>
      <div
        role="slider"
        tabIndex={url ? 0 : -1}
        aria-label={`Seek ${label}`}
        aria-valuemin={0}
        aria-valuemax={Math.round(length())}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={`${duration(pos * 1000)} of ${duration(length() * 1000)}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          seek((e.clientX - r.left) / r.width);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") seek((pos + 5) / (length() || 1));
          if (e.key === "ArrowLeft") seek((pos - 5) / (length() || 1));
        }}
        className="flex h-[26px] min-w-0 cursor-pointer items-center gap-[2px] rounded focus-visible:outline-2 focus-visible:outline-ring"
      >
        {peaks.map((p, i) => (
          <i
            key={i}
            className={cn(
              "block w-[3px] shrink-0 rounded-sm bg-faint",
              i / peaks.length < progress && "bg-primary",
            )}
            style={{ height: `${Math.max(4, Math.round(4 + p * 20))}px` }}
          />
        ))}
      </div>
      <small className="text-[11px] tabular-nums text-muted-foreground">
        {unavailable ? "Unavailable" : duration((playing || pos > 0 ? pos : length()) * 1000)}
      </small>
      {url && <audio ref={audio} src={url} preload="metadata" data-voice className="hidden" />}
    </div>
  );
}

/** Photo thumbnail; tap to view it large. */
export function ImageThumb({
  attachment,
  alt,
  fill,
}: {
  attachment: Attachment;
  alt: string;
  /** Fill the parent (square media tiles) instead of keeping the photo's shape. */
  fill?: boolean;
}) {
  const url = useAttachmentUrl(attachment.storagePath);
  const [open, setOpen] = useState(false);
  const ratio =
    attachment.width && attachment.height ? attachment.width / attachment.height : 4 / 3;
  if (url === null) {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-dashed border-line px-3 py-2 text-[12px] text-faint">
        <ImageOff className="size-4" aria-hidden="true" /> Photo unavailable
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!url}
        aria-label={`View photo: ${alt}`}
        className={cn(
          "block overflow-hidden rounded-[10px] bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          fill ? "size-full" : "w-[min(260px,100%)]",
        )}
        style={fill ? undefined : { aspectRatio: String(ratio) }}
      >
        {url && <img src={url} alt="" className="size-full object-cover" loading="lazy" />}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-4xl gap-2 rounded-card p-2 sm:p-3">
          <DialogTitle className="sr-only">Photo</DialogTitle>
          <DialogDescription className="sr-only">{alt}</DialogDescription>
          {url && (
            <img
              src={url}
              alt={alt}
              className="max-h-[80dvh] w-full rounded-[10px] object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
