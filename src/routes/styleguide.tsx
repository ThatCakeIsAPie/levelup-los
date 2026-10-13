import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  CalendarDays,
  Check,
  Flame,
  MessageCircle,
  ShoppingBag,
  Ticket,
  TrendingUp,
  Users,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ActionRow,
  DateBadge,
  EmptyState,
  Logo,
  PageHeader,
  PersonAvatar,
  ProgressRing,
  SectionCard,
  SegmentedBar,
  StageChip,
  StatStrip,
  StatTile,
  ToneChip,
  type Tone,
} from "@/components/brand";
import { ThemeSwitcher } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { daysFromToday, openLog, type BizClass, type LogTab } from "@/data";

export const Route = createFileRoute("/styleguide")({
  head: () => ({ meta: [{ title: "Styleguide — LevelUp LOS" }] }),
  component: StyleguidePage,
});

const STAGES: BizClass[] = ["prospect", "apprentice", "ibo", "customer"];
const TONES: Tone[] = ["good", "warn", "bad", "info", "neutral"];

function Swatch({ cls, name }: { cls: string; name: string }) {
  return (
    <div className="grid gap-1.5">
      <div className={`h-12 rounded-lg border border-line ${cls}`} />
      <code className="text-[11px] text-muted-foreground">{name}</code>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SectionCard title={title}>
      <div className="grid gap-4">{children}</div>
    </SectionCard>
  );
}

const chartData = [
  { week: "W1", pages: 40, podcasts: 2 },
  { week: "W2", pages: 65, podcasts: 3 },
  { week: "W3", pages: 30, podcasts: 1 },
  { week: "W4", pages: 45, podcasts: 1 },
];
const chartConfig = {
  pages: { label: "Pages", color: "var(--chart-3)" },
  podcasts: { label: "Podcasts", color: "var(--chart-2)" },
} satisfies ChartConfig;

function StyleguidePage() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <PageHeader
        title="Styleguide"
        subtitle="Every brand component in each variant. Toggle the theme to check dark mode."
        back={{ to: "/", label: "Home" }}
        actions={<ThemeSwitcher />}
      />

      <Block title="Logo">
        <div className="flex flex-wrap items-center gap-6">
          <Logo size="sm" />
          <Logo />
          <Logo size="lg" />
          <Logo wordmark />
          <span className="rounded-lg bg-sidebar px-3 py-2 text-white">
            <Logo wordmark tagline />
          </span>
        </div>
      </Block>

      <Block title="Colors">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-10">
          <Swatch cls="bg-navy" name="navy (charcoal)" />
          <Swatch cls="bg-teal" name="teal (deep green)" />
          <Swatch cls="bg-sky" name="sky (logo green)" />
          <Swatch cls="bg-amber" name="amber" />
          <Swatch cls="bg-stone" name="stone (grey)" />
          <Swatch cls="bg-app" name="app" />
          <Swatch cls="bg-surface" name="surface" />
          <Swatch cls="bg-surface-2" name="surface-2" />
          <Swatch cls="bg-track" name="track" />
          <Swatch cls="bg-event" name="event" />
          <Swatch cls="bg-primary" name="primary" />
          <Swatch cls="bg-primary-soft" name="primary-soft" />
          <Swatch cls="bg-stage-ibo" name="stage-ibo" />
          <Swatch cls="bg-stage-apprentice" name="stage-apprentice" />
          <Swatch cls="bg-stage-prospect" name="stage-prospect" />
          <Swatch cls="bg-stage-customer" name="stage-customer" />
          <Swatch cls="bg-good-soft" name="good-soft" />
          <Swatch cls="bg-warn-soft" name="warn-soft" />
          <Swatch cls="bg-bad-soft" name="bad-soft" />
          <Swatch cls="bg-info-soft" name="info-soft" />
        </div>
      </Block>

      <div className="grid gap-5 lg:grid-cols-2">
        <Block title="StageChip + PersonAvatar">
          <div className="flex flex-wrap gap-2">
            {STAGES.map((s) => (
              <StageChip key={s} stage={s} />
            ))}
          </div>
          {STAGES.map((s) => (
            <div key={s} className="flex items-center gap-3">
              <PersonAvatar name="Jamal Brown" stage={s} size="sm" />
              <PersonAvatar name="Jamal Brown" stage={s} size="md" />
              <PersonAvatar name="Jamal Brown" stage={s} size="lg" />
              <PersonAvatar name="Jamal Brown" stage={s} size="xl" />
              <span className="text-xs text-muted-foreground">{s}</span>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <PersonAvatar name="No Stage" />
            <span className="text-xs text-muted-foreground">no stage (neutral)</span>
          </div>
        </Block>

        <Block title="ToneChip">
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <ToneChip key={t} tone={t}>
                {t}
              </ToneChip>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <ToneChip tone="warn" icon={Flame}>
              Personal best: 11
            </ToneChip>
            <ToneChip tone="good" icon={Check}>
              Ticket bought
            </ToneChip>
            <ToneChip tone="bad" icon={Ticket}>
              Purchase date passed
            </ToneChip>
            <ToneChip tone="info" icon={TrendingUp}>
              IBO in 53 days
            </ToneChip>
            <ToneChip tone="neutral" icon={Users}>
              64 people
            </ToneChip>
          </div>
        </Block>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <SectionCard title="SectionCard" action={<a className="text-primary">Edit</a>}>
          <p className="text-[13px] text-muted-foreground">
            Default card: surface, 1px line border, 14px radius. Title row with an action link.
          </p>
        </SectionCard>
        <SectionCard
          variant="event"
          title="Fall Leadership Weekend"
          action={
            <span className="inline-grid min-w-[52px] place-items-center rounded-[10px] bg-white/10 px-2 py-1.5 text-center">
              <b className="block text-xl font-extrabold leading-tight">26</b>
              <small className="text-[10px] font-semibold tracking-wide text-event-muted">
                DAYS
              </small>
            </span>
          }
        >
          <p className="-mt-1.5 text-[12.5px] text-muted-foreground">Dallas, TX · 20 invited</p>
          <SegmentedBar
            total={20}
            className="bg-white/15"
            segments={[
              { value: 12, className: "bg-sky", label: "Tickets" },
              { value: 3, className: "bg-amber", label: "Planned this week" },
            ]}
          />
        </SectionCard>
        <SectionCard title="StatTile">
          <div className="grid grid-cols-3 gap-2.5">
            <StatTile value="64" label="People" />
            <StatTile value="+4" label="New this month" />
            <StatTile value="31" label="Customers" />
          </div>
        </SectionCard>
      </div>

      <Block title="StatStrip (2 columns on phones)">
        <StatStrip
          items={[
            { value: "53 days", label: "Until IBO" },
            { value: "100%", label: "Show rate" },
            { value: "2", label: "Prospects" },
            { value: "1", label: "Customer" },
          ]}
        />
      </Block>

      <div className="grid gap-5 lg:grid-cols-2">
        <Block title="SegmentedBar + ProgressRing">
          <SegmentedBar
            height={10}
            segments={[
              { value: 18, className: "bg-stage-ibo", label: "IBO" },
              { value: 21, className: "bg-stage-apprentice", label: "Apprentice" },
              { value: 25, className: "bg-stage-prospect", label: "Prospect" },
            ]}
          />
          <SegmentedBar
            total={60}
            segments={[{ value: 45, className: "bg-sky", label: "Pages" }]}
          />
          <div className="flex flex-wrap items-center gap-5">
            <ProgressRing value={0} />
            <ProgressRing value={0.35} />
            <ProgressRing value={0.75} />
            <ProgressRing value={1} arcClassName="stroke-good" />
            <ProgressRing value={0.5} size={48} />
          </div>
        </Block>

        <Block title="DateBadge">
          <div className="flex flex-wrap gap-3">
            <DateBadge date={daysFromToday(10)} />
            <DateBadge date={daysFromToday(26)} />
            <DateBadge date={daysFromToday(-20)} />
          </div>
        </Block>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <SectionCard title="ActionRow (the Today list)">
          <div>
            <ActionRow
              icon={Ticket}
              iconTone="bad"
              title="Sarah Kim hasn't bought her ticket"
              meta={
                <>
                  <StageChip stage="apprentice" />
                  Planned to buy by Oct 10 · Fall Leadership Weekend
                </>
              }
              link={{ to: "/people/$id", params: { id: "7" } }}
              action={
                <Button size="sm" variant="outline">
                  Follow up
                </Button>
              }
            />
            <ActionRow
              icon={ShoppingBag}
              iconTone="warn"
              title="Omar Haddad, 52 days since contact"
              meta={
                <>
                  <StageChip stage="customer" />
                  Last bought eSpring Filter
                </>
              }
              action={
                <Button
                  size="sm"
                  variant="soft"
                  onClick={() => openLog({ tab: "customer", personId: "c4" })}
                >
                  <Check /> Log contact
                </Button>
              }
            />
            <ActionRow
              icon={TrendingUp}
              iconTone="info"
              title="Jamal Brown becomes an IBO in 53 days"
              meta={<StageChip stage="apprentice" />}
              action={
                <Button size="sm" variant="outline">
                  Plan it
                </Button>
              }
            />
            <ActionRow
              icon={MessageCircle}
              iconTone="primary"
              title="Check in with David Chen"
              meta={
                <>
                  <StageChip stage="ibo" />
                  Last contact 20 days ago
                </>
              }
              onClick={() => openLog({ tab: "checkin", personId: "3" })}
              action={
                <Button
                  size="sm"
                  variant="soft"
                  onClick={() => openLog({ tab: "checkin", personId: "3" })}
                >
                  <Check /> Check in
                </Button>
              }
            />
            <ActionRow icon={CalendarDays} iconTone="neutral" title="Neutral tone, no action" />
          </div>
        </SectionCard>
        <div className="grid content-start gap-5">
          <Block title="EmptyState">
            <EmptyState
              icon={<Users />}
              title="No customers yet"
              body="Customers you add will show up here."
              action={<Button size="sm">Add customer</Button>}
            />
          </Block>
          <Block title="Log sheet">
            <div className="flex flex-wrap gap-2">
              {(["learning", "checkin", "customer", "sale"] as LogTab[]).map((t) => (
                <Button key={t} size="sm" variant="outline" onClick={() => openLog({ tab: t })}>
                  openLog({`{ tab: "${t}" }`})
                </Button>
              ))}
            </div>
          </Block>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Block title="Buttons + inputs (shadcn, token-styled)">
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="soft">
              <Check /> Soft
            </Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
          </div>
          <Input placeholder="Search people, events…" />
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">Overview</TabsTrigger>
              <TabsTrigger value="b">Events</TabsTrigger>
              <TabsTrigger value="c">Customers</TabsTrigger>
            </TabsList>
            <TabsContent value="a" className="text-[13px] text-muted-foreground">
              Tabs content
            </TabsContent>
          </Tabs>
        </Block>
        <Block title="Chart (recharts v3 + chart tokens)">
          <ChartContainer config={chartConfig} className="h-48 w-full">
            <BarChart data={chartData}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="week" tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="pages" fill="var(--color-pages)" radius={4} />
              <Bar dataKey="podcasts" fill="var(--color-podcasts)" radius={4} />
            </BarChart>
          </ChartContainer>
        </Block>
      </div>
    </div>
  );
}
