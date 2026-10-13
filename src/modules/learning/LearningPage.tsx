import { Link } from "@tanstack/react-router";
import { ChevronRight, Library, Plus } from "lucide-react";
import { PageHeader, useIsDesktop } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { openLog, useCurrentUser, useFeature } from "@/data";
import { useMyLearning } from "@/modules/dashboard/hooks";
import { GoalCard, GoalTile, StreakCard, StreakTile } from "@/modules/dashboard/LearningCards";
import { MyLearningCard } from "@/modules/dashboard/JourneyCards";
import { ContinueLearningCard } from "@/modules/library/HomeCards";

/**
 * /learning: your streak, this week against your goal, and what you logged.
 * The learning library is phase 2: when the team switches it on, it shows
 * here too (Continue learning, and a link to the library).
 */
export function LearningPage() {
  const user = useCurrentUser();
  const desktop = useIsDesktop();
  const learning = useMyLearning(user.personId);
  const library = useFeature("library");
  return (
    <div className="mx-auto grid w-full max-w-4xl content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <PageHeader
        title="Learning"
        subtitle="Books, audios and events that grow your business"
        logButton={false}
        actions={
          <Button onClick={() => openLog({ tab: "learning" })}>
            <Plus /> Log learning
          </Button>
        }
      />
      {desktop ? (
        <div className="grid grid-cols-2 gap-4">
          <StreakCard learning={learning} />
          <GoalCard learning={learning} personId={user.personId} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <StreakTile learning={learning} />
          <GoalTile learning={learning} personId={user.personId} />
        </div>
      )}
      {library && (
        <>
          <ContinueLearningCard />
          <Link
            to="/library"
            className="group flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="grid size-9 place-items-center rounded-lg bg-info-soft text-info-ink">
              <Library className="size-[18px]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">Library</span>
              <span className="block text-[12.5px] text-muted-foreground">
                Talks, audios and channels from your team
              </span>
            </span>
            <ChevronRight
              className="size-4 text-faint transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </>
      )}
      <MyLearningCard entries={learning.entries} />
    </div>
  );
}
