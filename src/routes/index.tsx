import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { PageHeader, useIsDesktop } from "@/components/brand";
import {
  useAttendancesForPerson,
  useCurrentUser,
  useMe,
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
  const items = useTodayItems();
  const learning = useMyLearning(user.personId);
  const upcoming = useUpcomingEvents();
  const myRows = useAttendancesForPerson(user.personId);
  const featured = pickFeaturedEvent(upcoming, myRows, candidate);
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
      candidate={candidate}
      viewerId={user.personId}
      compact={!desktop}
    />
  );
  const side = candidate ? (
    <>
      <PathCard me={me} />
      <MyLearningCard entries={learning.entries} />
    </>
  ) : (
    <>
      <TeamCard team={team} compact={!desktop} />
      <TeamLearningCard team={team} viewerId={user.personId} compact={!desktop} />
    </>
  );

  if (!desktop) {
    return (
      <div className="grid content-start gap-3 px-4 py-5">
        {header}
        <div className="grid grid-cols-2 gap-2.5">
          <StreakTile learning={learning} />
          <GoalTile learning={learning} personId={user.personId} />
        </div>
        <ContinueLearningCard />
        {event}
        <InboxCard compact />
        {today}
        {candidate && <MyEventsCard viewerId={user.personId} />}
        {side}
      </div>
    );
  }

  return (
    <div className="grid content-start gap-[18px] px-[26px] py-[22px]">
      {header}
      <div className="grid grid-cols-[1fr_1fr_1.25fr] gap-4">
        <StreakCard learning={learning} />
        <GoalCard learning={learning} personId={user.personId} />
        {event}
      </div>
      <div className="grid grid-cols-[1.6fr_1fr] items-start gap-4">
        <div className="grid min-w-0 content-start gap-4">
          <ContinueLearningCard />
          <InboxCard />
          {today}
          {candidate && <MyEventsCard viewerId={user.personId} />}
        </div>
        <div className="grid min-w-0 content-start gap-4">{side}</div>
      </div>
    </div>
  );
}
