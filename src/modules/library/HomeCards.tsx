/**
 * Library entry points elsewhere in the app:
 *  - ContinueLearningCard on Home (next to the streak and weekly goal it
 *    feeds; renders nothing when nothing is in progress);
 *  - LibraryTile on the My business hub.
 */
import { Link } from "@tanstack/react-router";
import { ChevronRight, Library } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatMinutes,
  useContinueLearning,
  useLibraryChannels,
  useMyLibraryProgress,
} from "@/data";
import { useOpenItem } from "./links";
import { Bar, ContinueCard, lessonTotals } from "./parts";

/** "Continue learning" on Home: where you stopped, one tap to resume. */
export function ContinueLearningCard({ className }: { className?: string }) {
  const cont = useContinueLearning();
  const open = useOpenItem();
  if (!cont) return null;
  const left = cont.remainingSec !== null ? `${formatMinutes(cont.remainingSec)} left · ` : "";
  return (
    <ContinueCard
      view={cont}
      eyebrow="Continue learning"
      sub={`${left}counts toward your goal`}
      onPlay={() => open(cont.item, cont.channel?.id)}
      className={cn("rounded-card", className)}
    />
  );
}

/** My business hub tile: what to continue, and progress across the channels. */
export function LibraryTile() {
  const cont = useContinueLearning();
  const channels = useLibraryChannels().filter((c) => !c.locked);
  const progress = useMyLibraryProgress();
  const { done, total } = lessonTotals(channels, progress);
  return (
    <Link
      to="/library"
      className={cn(
        "group grid min-w-0 content-start gap-2 rounded-xl border border-line bg-surface px-3 py-[11px] transition-colors lg:gap-2.5 lg:rounded-card lg:px-4 lg:py-3.5",
        "hover:border-primary/40 hover:bg-surface-2/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-info-soft text-info-ink lg:size-8">
          <Library className="size-[15px] lg:size-4" aria-hidden="true" />
        </span>
        <b className="text-[12.5px] lg:text-[13.5px]">Library</b>
        <ChevronRight
          className="ml-auto size-[15px] text-faint transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
      {cont ? (
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-semibold lg:text-[13px]">
            {cont.item.title}
          </span>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            Continue
            {cont.remainingSec !== null ? ` · ${formatMinutes(cont.remainingSec)} left` : ""}
          </span>
        </span>
      ) : (
        <span className="text-[12.5px] text-muted-foreground lg:text-[13px]">
          {channels.length} {channels.length === 1 ? "channel" : "channels"} of talks and lessons
        </span>
      )}
      {total > 0 && (
        <span className="grid gap-1">
          <Bar value={done / total} className="h-[5px]" />
          <span className="text-[11px] text-muted-foreground">
            {done} of {total} lessons done
          </span>
        </span>
      )}
    </Link>
  );
}
