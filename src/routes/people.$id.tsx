import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { quickCheckIn } from "@/components/log/quickLog";
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  GitBranch,
  IdCard,
  Mail,
  MapPin,
  Phone,
  ShoppingBag,
  UserRoundSearch,
} from "lucide-react";
import {
  daysSince,
  effectiveBizClass,
  getPersonShowRate,
  learningStreak,
  missingRequiredFields,
  openLog,
  useAttendancesForPerson,
  useCurrentUser,
  useCustomerCounts,
  useCustomersOf,
  useDownline,
  useEvents,
  useLastContact,
  useLearning,
  usePerson,
  useSales,
  useSponsorChain,
  type CrmPerson,
} from "@/data";
import {
  EmptyState,
  SectionCard,
  StageChip,
  StatStrip,
  ToneChip,
  useIsDesktop,
} from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BusinessPathCard } from "@/modules/people/BusinessPath";
import { EventsCard, EventsTab, NextEventCard } from "@/modules/people/Events";
import { TeamCard } from "@/modules/people/TeamCard";
import { CustomersCard, CustomersTab } from "@/modules/people/Customers";
import { DetailsTab, TagList, type DetailsPermissions } from "@/modules/people/DetailsTab";
import { FeedList } from "@/modules/people/ActivityFeed";
import { usePersonFeed } from "@/modules/people/feed";
import { ProfileHero, type HeroAction } from "@/modules/people/Hero";
import { daysLabel, FIELD_LABEL, firstName, fmtDate, fmtMoney } from "@/modules/people/format";

export const Route = createFileRoute("/people/$id")({
  head: () => ({ meta: [{ title: "Person — LevelUp LOS" }] }),
  component: PersonPage,
});

const PAGE = "grid gap-[18px] px-4 py-5 lg:px-[26px] lg:py-[22px]";

function PersonPage() {
  const { id } = Route.useParams();
  // Re-mount per person so tab / edit state never leaks between profiles.
  return (
    <TooltipProvider delayDuration={200}>
      <PersonProfile key={id} id={id} />
    </TooltipProvider>
  );
}

function PersonProfile({ id }: { id: string }) {
  // Missing and not-visible ids both come back undefined (src/data/access.ts).
  const person = usePerson(id);
  if (!person) {
    return (
      <div className={PAGE}>
        <BackLink to="/people" label="People" />
        <EmptyState
          className="mt-6"
          icon={<UserRoundSearch />}
          title="Person not found"
          body="They may have been deleted, or they're not on your team."
          action={
            <Button asChild variant="soft">
              <Link to="/people">Back to People</Link>
            </Button>
          }
        />
      </div>
    );
  }
  return person.bizClass === "customer" ? (
    <CustomerProfile person={person} />
  ) : (
    <BusinessProfile person={person} />
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function BackLink({
  to,
  label,
  current,
}: {
  to: "/people" | "/customers";
  label: string;
  current?: string;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
    >
      <Link
        to={to}
        className="inline-flex items-center gap-1 rounded-sm font-medium hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {label}
      </Link>
      {current && (
        <>
          <span className="hidden text-faint lg:inline" aria-hidden="true">
            /
          </span>
          <span
            className="hidden truncate font-semibold text-foreground lg:inline"
            aria-current="page"
          >
            {current}
          </span>
        </>
      )}
    </nav>
  );
}

function MissingChip({ person, onFix }: { person: CrmPerson; onFix?: () => void }) {
  const missing = missingRequiredFields(person);
  if (!missing.length) return null;
  const text = `Missing ${missing.map((k) => FIELD_LABEL[k] ?? k).join(", ")}`;
  const chip = (
    <ToneChip tone="warn" className="text-[11px]">
      {text}
    </ToneChip>
  );
  if (!onFix) return chip;
  return (
    <button
      type="button"
      onClick={onFix}
      className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      title="Fill in the missing details"
    >
      {chip}
    </button>
  );
}

const DESKTOP_TAB_LIST =
  "h-auto w-full justify-start gap-1 rounded-none border-b border-line bg-transparent p-0";
const DESKTOP_TAB =
  "-mb-px flex-none rounded-none border-b-2 border-transparent px-3 py-2 text-[13px] text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none focus-visible:ring-offset-0";
const PHONE_TAB_LIST = "grid h-auto w-full rounded-[10px] bg-surface-2 p-[3px]";
const PHONE_TAB =
  "rounded-lg px-1 py-1.5 text-[11.5px] text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground";

function TabBar({
  tabs,
  isDesktop,
}: {
  tabs: { value: string; label: string; phone?: boolean }[];
  isDesktop: boolean;
}) {
  const shown = isDesktop ? tabs : tabs.filter((t) => t.phone !== false);
  return (
    <TabsList
      className={isDesktop ? DESKTOP_TAB_LIST : PHONE_TAB_LIST}
      style={
        isDesktop ? undefined : { gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }
      }
    >
      {shown.map((t) => (
        <TabsTrigger key={t.value} value={t.value} className={isDesktop ? DESKTOP_TAB : PHONE_TAB}>
          {t.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

const LINK_BUTTON =
  "rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring";

/** Recent activity card; on phones "Show all" expands in place (no Activity tab there). */
function RecentActivityCard({
  personId,
  onShowAll,
  isDesktop,
}: {
  personId: string;
  onShowAll: () => void;
  isDesktop: boolean;
}) {
  const feed = usePersonFeed(personId);
  const [expanded, setExpanded] = useState(false);
  const items = expanded ? feed : feed.slice(0, 5);
  const more = feed.length > 5;
  return (
    <SectionCard
      title="Recent activity"
      action={
        more ? (
          <button
            type="button"
            onClick={() => (isDesktop ? onShowAll() : setExpanded((v) => !v))}
            className={LINK_BUTTON}
          >
            {isDesktop ? "All" : expanded ? "Show less" : `Show all ${feed.length}`}
          </button>
        ) : undefined
      }
    >
      <FeedList items={items} showSub={expanded} removable={expanded} />
    </SectionCard>
  );
}

function TagsCard({ tags, onEdit }: { tags?: string[]; onEdit?: () => void }) {
  if (!tags?.length && !onEdit) return null;
  return (
    <SectionCard
      title="Tags"
      action={
        onEdit ? (
          <button type="button" onClick={onEdit} className={LINK_BUTTON}>
            {tags?.length ? "Edit" : "Add"}
          </button>
        ) : undefined
      }
    >
      {tags?.length ? (
        <TagList tags={tags} />
      ) : (
        <p className="text-[12.5px] text-muted-foreground">No tags yet.</p>
      )}
    </SectionCard>
  );
}

function ActivityTab({ personId }: { personId: string }) {
  const feed = usePersonFeed(personId);
  return (
    <SectionCard title={`Activity${feed.length ? ` (${feed.length})` : ""}`}>
      <FeedList items={feed} showSub removable />
    </SectionCard>
  );
}

type MetaItem = { key: string; icon: typeof MapPin; content: React.ReactNode };

// ---------------------------------------------------------------------------
// Business path profile (prospect / apprentice / IBO)
// ---------------------------------------------------------------------------

type BizTab = "overview" | "events" | "customers" | "details" | "activity";

function BusinessProfile({ person }: { person: CrmPerson }) {
  const navigate = useNavigate();
  const me = useCurrentUser();
  const isDesktop = useIsDesktop();
  const isSelf = me.personId === person.id;
  const isCandidate = me.role === "candidate";
  const stage = effectiveBizClass(person);
  const name = firstName(person.name);

  const [tab, setTab] = useState<BizTab>("overview");
  const [editing, setEditing] = useState(false);
  const [addCustomer, setAddCustomer] = useState(false);
  // The Activity tab is desktop-only; on phones it folds into Overview.
  const activeTab: BizTab = !isDesktop && tab === "activity" ? "overview" : tab;

  const perms: DetailsPermissions = {
    canEdit: true,
    canEditStage: !isCandidate && !isSelf,
    canEditIds: !isCandidate,
    canDelete: !isCandidate && !isSelf,
  };
  const canEditEvents = !isCandidate;

  const chain = useSponsorChain(person.id, 1);
  const sponsor = chain.length && chain[0].id === person.sponsorId ? chain[0] : undefined;

  // Stats
  const lastContact = useLastContact(person.id);
  const learning = useLearning(person.id);
  const attendances = useAttendancesForPerson(person.id);
  const events = useEvents();
  const rate = getPersonShowRate(person.id, attendances, events);
  const customerCount = useCustomerCounts()[person.id] ?? 0;
  const ownCustomers = useCustomersOf(person.id);
  const volume = ownCustomers.reduce((s, c) => s + (c.monthlyVolume ?? 0), 0);
  const contactDays = daysSince(lastContact);
  const learnDays = daysSince(learning[0]?.date);
  const teamSize = useDownline(person.id).length;
  const streak = learningStreak(learning);

  const stats = [
    isSelf
      ? { value: streak === 1 ? "1 day" : `${streak} days`, label: "Learning streak" }
      : {
          value: daysLabel(contactDays),
          label:
            contactDays === 0
              ? "Last contact"
              : contactDays === null
                ? "No contact logged"
                : "Since last contact",
        },
    {
      value: rate.eligible ? `${rate.pct}%` : "None yet",
      label: rate.eligible
        ? `Event show rate (${rate.attended} of ${rate.eligible})`
        : "Event show rate",
    },
    {
      value: String(customerCount),
      label:
        (customerCount === 1 ? "Customer" : "Customers") +
        (ownCustomers.length ? ` · ${fmtMoney(volume)}/mo` : ""),
    },
    isSelf
      ? {
          value: String(teamSize),
          label: teamSize === 1 ? "Person on your team" : "People on your team",
        }
      : {
          value: daysLabel(learnDays),
          label:
            learnDays === 0
              ? "Learning logged"
              : learnDays === null
                ? "No learning logged"
                : "Since learning logged",
        },
  ];

  const openDetailsEdit = () => {
    setTab("details");
    setEditing(true);
  };
  const openCustomers = (add?: boolean) => {
    setTab("customers");
    if (add) setAddCustomer(true);
  };

  const actions: HeroAction[] = isSelf
    ? [
        {
          label: "Log learning",
          short: "Learning",
          icon: BookOpen,
          primary: true,
          onClick: () => openLog({ tab: "learning" }),
        },
      ]
    : [
        {
          label: "Check in",
          icon: Check,
          primary: true,
          onClick: () =>
            void quickCheckIn(person.id, `Checked in with ${name}`, {
              description: "Logged for today",
            }),
        },
      ];

  const meta = [
    sponsor && {
      key: "sponsor",
      icon: GitBranch,
      content: (
        <span>
          Sponsored by{" "}
          <Link
            to="/people/$id"
            params={{ id: sponsor.id }}
            className="rounded-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {sponsor.name}
          </Link>
        </span>
      ),
    },
    person.location && { key: "loc", icon: MapPin, content: person.location },
    person.phone && { key: "phone", icon: Phone, content: person.phone },
    (person.iboNumber || person.ltdNumber) && {
      key: "ids",
      icon: IdCard,
      content: [
        person.iboNumber && `IBO# ${person.iboNumber}`,
        person.ltdNumber && `LTD# ${person.ltdNumber}`,
      ]
        .filter(Boolean)
        .join(" · "),
    },
  ].filter(Boolean) as MetaItem[];

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "events", label: "Events" },
    { value: "customers", label: "Customers" },
    { value: "details", label: "Details" },
    { value: "activity", label: "Activity", phone: false },
  ];

  return (
    <div className={PAGE}>
      <BackLink to="/people" label="People" current={person.name} />

      <ProfileHero
        person={person}
        stage={stage}
        isDesktop={isDesktop}
        chips={
          <>
            <StageChip stage={stage} />
            <MissingChip person={person} onFix={openDetailsEdit} />
          </>
        }
        phoneSub={sponsor ? <span className="truncate">under {sponsor.name}</span> : undefined}
        meta={meta}
        contact={!isSelf}
        actions={actions}
        onEditDetails={openDetailsEdit}
      />

      {isDesktop && <StatStrip items={stats} />}

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as BizTab)} className="grid gap-4">
        <TabBar tabs={tabs} isDesktop={isDesktop} />

        <TabsContent value="overview" className="mt-0">
          {isDesktop ? (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
              <div className="grid min-w-0 content-start gap-4">
                <BusinessPathCard person={person} canEdit={perms.canEditStage} />
                <EventsCard
                  person={person}
                  canEdit={canEditEvents}
                  onShowAll={() => setTab("events")}
                />
              </div>
              <div className="grid min-w-0 content-start gap-4">
                <TeamCard person={person} />
                <CustomersCard person={person} onOpenTab={openCustomers} />
                <RecentActivityCard
                  personId={person.id}
                  isDesktop
                  onShowAll={() => setTab("activity")}
                />
                <TagsCard tags={person.tags} onEdit={openDetailsEdit} />
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              <BusinessPathCard person={person} canEdit={perms.canEditStage} compact />
              <NextEventCard person={person} canEdit={canEditEvents} />
              <StatStrip items={stats} />
              <TeamCard person={person} />
              <CustomersCard person={person} onOpenTab={openCustomers} />
              <RecentActivityCard
                personId={person.id}
                isDesktop={false}
                onShowAll={() => undefined}
              />
              <TagsCard tags={person.tags} onEdit={openDetailsEdit} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="events" className="mt-0">
          <EventsTab person={person} canEdit={canEditEvents} />
        </TabsContent>

        <TabsContent value="customers" className="mt-0">
          <CustomersTab person={person} addOpen={addCustomer} setAddOpen={setAddCustomer} />
        </TabsContent>

        <TabsContent value="details" className="mt-0">
          <DetailsTab
            person={person}
            perms={perms}
            editing={editing}
            setEditing={setEditing}
            onDeleted={() => navigate({ to: "/people" })}
          />
        </TabsContent>

        {isDesktop && (
          <TabsContent value="activity" className="mt-0">
            <ActivityTab personId={person.id} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer profile
// ---------------------------------------------------------------------------

type CustTab = "overview" | "details" | "activity";

function CustomerProfile({ person }: { person: CrmPerson }) {
  const navigate = useNavigate();
  const me = useCurrentUser();
  const isDesktop = useIsDesktop();
  const owner = usePerson(person.ownerId ?? undefined);
  const sales = useSales(person.id);
  const lastContact = useLastContact(person.id);
  const [tab, setTab] = useState<CustTab>("overview");
  const [editing, setEditing] = useState(false);

  const contactDays = daysSince(lastContact);
  const lastBuy = sales[0];
  const buyDays = daysSince(lastBuy?.date);
  const total = sales.reduce((s, x) => s + (x.amount ?? 0), 0);

  const perms: DetailsPermissions = {
    canEdit: me.role !== "candidate",
    canEditStage: false,
    canEditIds: me.role !== "candidate",
    canDelete: me.role !== "candidate",
  };
  const openDetailsEdit = perms.canEdit
    ? () => {
        setTab("details");
        setEditing(true);
      }
    : undefined;

  const stats = [
    {
      value: person.monthlyVolume ? fmtMoney(person.monthlyVolume) : "Not set",
      label: "Monthly volume",
    },
    {
      value: daysLabel(contactDays),
      label:
        contactDays === 0
          ? "Last contact"
          : contactDays === null
            ? "No contact logged"
            : "Since last contact",
    },
    {
      value: daysLabel(buyDays),
      label: !lastBuy
        ? "No purchases yet"
        : buyDays === 0
          ? "Last purchase"
          : "Since last purchase",
    },
    {
      value: String(sales.length),
      label: `${sales.length === 1 ? "Purchase" : "Purchases"}${total ? ` · ${fmtMoney(total)} total` : ""}`,
    },
  ];

  const actions: HeroAction[] = [
    {
      label: "Log sale",
      short: "Sale",
      icon: ShoppingBag,
      onClick: () => openLog({ tab: "sale", personId: person.id }),
    },
    {
      label: "Log contact",
      short: "Contact",
      icon: Check,
      primary: true,
      onClick: () => openLog({ tab: "customer", personId: person.id }),
    },
  ];

  const ownsIt = owner?.id === me.personId;
  const ownerLink = owner ? (
    <Link
      to="/people/$id"
      params={{ id: owner.id }}
      className="rounded-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {owner.name}
    </Link>
  ) : null;

  const meta = [
    ownerLink && {
      key: "owner",
      icon: GitBranch,
      content: ownsIt ? <span>Your customer</span> : <span>Customer of {ownerLink}</span>,
    },
    person.location && { key: "loc", icon: MapPin, content: person.location },
    person.phone && { key: "phone", icon: Phone, content: person.phone },
    person.email && {
      key: "email",
      icon: Mail,
      content: <span className="truncate">{person.email}</span>,
    },
    person.joinedDate && {
      key: "since",
      icon: CalendarDays,
      content: `Customer since ${fmtDate(person.joinedDate, { year: true })}`,
    },
  ].filter(Boolean) as MetaItem[];

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "details", label: "Details" },
    { value: "activity", label: "Activity" },
  ];

  return (
    <div className={PAGE}>
      <BackLink to="/customers" label="Customers" current={person.name} />

      <ProfileHero
        person={person}
        stage="customer"
        isDesktop={isDesktop}
        chips={
          <>
            <StageChip stage="customer" />
            <MissingChip person={person} onFix={openDetailsEdit} />
          </>
        }
        phoneSub={
          ownsIt ? (
            <span>Your customer</span>
          ) : ownerLink ? (
            <span className="truncate">of {ownerLink}</span>
          ) : undefined
        }
        meta={meta}
        contact
        actions={actions}
        onEditDetails={openDetailsEdit}
      />

      <StatStrip items={stats} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as CustTab)} className="grid gap-4">
        <TabBar tabs={tabs} isDesktop={isDesktop} />

        <TabsContent value="overview" className="mt-0">
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <SectionCard
              title="Purchases"
              action={
                <button
                  type="button"
                  onClick={() => openLog({ tab: "sale", personId: person.id })}
                  className={LINK_BUTTON}
                >
                  Log sale
                </button>
              }
            >
              {sales.length === 0 ? (
                <EmptyState
                  icon={<ShoppingBag />}
                  title="No purchases yet"
                  body={`Log ${firstName(person.name)}'s orders to see what they buy and when to follow up.`}
                />
              ) : (
                <ul>
                  {sales.map((s) => (
                    <li
                      key={s.id}
                      className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0 last:pb-0"
                    >
                      <span className="grid size-8 place-items-center rounded-[9px] bg-stage-customer-soft text-stage-customer-ink">
                        <ShoppingBag className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold">{s.product}</p>
                        <p className="text-xs text-muted-foreground">{fmtDate(s.date)}</p>
                      </div>
                      <span className="text-[13px] font-bold tabular-nums">
                        {s.amount !== undefined ? fmtMoney(s.amount) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
            <div className="grid min-w-0 content-start gap-4">
              <RecentActivityCard
                personId={person.id}
                isDesktop={isDesktop}
                onShowAll={() => setTab("activity")}
              />
              {person.notes && (
                <SectionCard title="Notes">
                  <p className="whitespace-pre-wrap break-words text-[13px]">{person.notes}</p>
                </SectionCard>
              )}
              <TagsCard tags={person.tags} onEdit={openDetailsEdit} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="details" className="mt-0">
          <DetailsTab
            person={person}
            perms={perms}
            editing={editing}
            setEditing={setEditing}
            onDeleted={() => navigate({ to: "/customers" })}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-0">
          <ActivityTab personId={person.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
