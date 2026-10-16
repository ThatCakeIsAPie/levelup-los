import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { PageHeader, useIsDesktop } from "@/components/brand";
import {
  useAttendancesForPerson,
  useCategoryOf,
  useCurrentUser,
  useMe,
  useUnlocks,
  useUpcomingEvents,
  useVisibleTeam,
} from "@/data";
import { useMyLearning, useTodayItems } from "@/modules/dashboard/hooks";
import { pickFeaturedEvent } from "@/modules/dashboard/format";
import { GoalCard, GoalTile, StreakCard, StreakTile } from "@/modules/dashboard/LearningCards";
import { MyEventsCard, NextEventCard } from "@/modules/dashboard/EventCards";
import { TodayCard } from "@/modules/dashboard/TodayCard";
import { InboxCard } from "@/modules/dashboard/InboxCard";
import { TeamCard, TeamLearningCard } from "@/modules/dashboard/TeamCards";
import { MyLearningCard, PathCard } from "@/modules/dashboard/JourneyCards";
import { ContinueLearningCard } from "@/modules/library/HomeCards";
import { FirstSponsorCelebration, NextMilestoneCard } from "@/modules/growth/HomeCards";
import { MyDayCard } from "@/modules/dashboard/MyDayCard";
import { HomeGrid, type HomeCards } from "@/modules/dashboard/HomeGrid";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — LevelUp LOS" },
      {
        name: "description",
        content: "Your learning streak, next event, and the people who need you today.",
      },
    ],
  }),
  component: Dashboard,
});

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Dashboard() {
  const user = useCurrentUser();
  const me = useMe();
  const desktop = useIsDesktop();
  const candidate = user.role === "candidate";
  // Home cards follow what the person has unlocked (src/data/unlocks.ts): a
  // new apprentice gets the next milestone, learning and upcoming events.
  const { can, stage } = useUnlocks();
  const starter = stage === "new_apprentice";
  const items = useTodayItems();
  const learning = useMyLearning(user.personId);
  const upcoming = useUpcomingEvents();
  const myRows = useAttendancesForPerson(user.personId);
  // Before First sponsor the event card is about your own plans, like a candidate's.
  const personalEvents = candidate || starter;
  const categoryOf = useCategoryOf();
  const featured = pickFeaturedEvent(upcoming, myRows, personalEvents, categoryOf);
  const visibleTeam = useVisibleTeam();
  const team = useMemo(
    () => visibleTeam.filter((p) => p.id !== user.personId),
    [visibleTeam, user.personId],
  );

  const now = new Date();
  const first = user.name.split(" ")[0];
  const n = items.length;
  const subtitle = `${format(now, "EEEE, MMMM d")} · ${
    n === 0 ? "You're all caught up" : `${n} ${n === 1 ? "thing needs" : "things need"} you today`
  }`;

  const header = <PageHeader title={`${greeting(now)}, ${first}`} subtitle={subtitle} />;
  const today = <TodayCard items={items} compact={!desktop} candidate={candidate} />;
  const event = (
    <NextEventCard
      event={featured}
      candidate={personalEvents}
      viewerId={user.personId}
      compact={!desktop}
    />
  );
  // Every Home card by id; the person arranges them (HomeGrid, saved per
  // person: src/data/homeLayout.ts). null = not shown to them.
  const cards: HomeCards = {
    milestone: candidate ? null : (
      <>
        <NextMilestoneCard />
        <FirstSponsorCelebration />
      </>
    ),
    learning: desktop ? (
      <div className="@container">
        <div className="grid gap-4 @[520px]:grid-cols-2">
          <StreakCard learning={learning} />
          <GoalCard learning={learning} personId={user.personId} />
        </div>
      </div>
    ) : (
      <div className="grid grid-cols-2 gap-2.5">
        <StreakTile learning={learning} />
        <GoalTile learning={learning} personId={user.personId} />
      </div>
    ),
    library: can.library ? <ContinueLearningCard /> : null,
    event,
    inbox: can.inbox ? <InboxCard compact={!desktop} /> : null,
    today,
    myEvents: personalEvents ? <MyEventsCard viewerId={user.personId} /> : null,
    team: personalEvents ? null : <TeamCard team={team} compact={!desktop} />,
    teamLearning: personalEvents ? null : (
      <TeamLearningCard team={team} viewerId={user.personId} compact={!desktop} />
    ),
    path: candidate ? <PathCard me={me} /> : null,
    myLearning: personalEvents ? <MyLearningCard entries={learning.entries} /> : null,
    myDay: <MyDayCard compact={!desktop} />,
  };

  return (
    <div
      className={
        desktop
          ? "grid content-start gap-[18px] px-[26px] py-[22px]"
          : "grid content-start gap-3 px-4 py-5"
      }
    >
      {header}
      <HomeGrid cards={cards} desktop={desktop} />
    </div>
  );
}
