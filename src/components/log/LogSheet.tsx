import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Activity,
  BookOpen,
  CalendarCheck,
  CalendarPlus,
  ChevronRight,
  MessageCircle,
  Phone,
  Plus,
  Presentation,
  Repeat,
  ShoppingBag,
  Store,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { EventFormDialog } from "@/modules/events/EventFormDialog";
import {
  getTeamChatId,
  openLog,
  sendMessage,
  useChatAccess,
  useCurrentUser,
  useUiStore,
  type CrmEvent,
  type LogTab,
} from "@/data";
import { OptionGrid, type Option } from "./parts";
import { ContactForm, LearningForm, NewContactForm, RecruitTouchForm, SaleForm } from "./forms";

type Recruit = "new" | "plan" | "followup" | "meeting";
type Sell = "sale" | "customer" | "reorder";
type Root = "activity" | "learning" | "checkin" | "event";

type Step =
  | { view: "menu" }
  | { view: "activity" }
  | { view: "recruiting"; kind?: Recruit }
  | { view: "selling"; kind?: Sell }
  | { view: "learning" }
  | { view: "checkin" };

/** Map the legacy `openLog({ tab })` targets onto the new flow. */
function initialStep(tab?: LogTab): Step {
  switch (tab) {
    case "learning":
      return { view: "learning" };
    case "checkin":
      return { view: "checkin" };
    case "customer":
      return { view: "selling", kind: "customer" };
    case "sale":
      return { view: "selling", kind: "sale" };
    default:
      return { view: "menu" };
  }
}

const ROOT: Option<Root>[] = [
  { value: "activity", label: "Activity", hint: "Recruiting or selling", icon: Activity },
  { value: "learning", label: "Learning", hint: "Pages, podcasts, workshops", icon: BookOpen },
  { value: "checkin", label: "Check-in", hint: "With your team", icon: MessageCircle },
  { value: "event", label: "New event", hint: "Meeting or conference", icon: CalendarPlus },
];
const AREAS: Option<"recruiting" | "selling">[] = [
  { value: "recruiting", label: "Recruiting", hint: "Prospects and plans", icon: Users },
  { value: "selling", label: "Selling", hint: "Customers and sales", icon: Store },
];
const RECRUIT: Option<Recruit>[] = [
  { value: "new", label: "New contact", hint: "Met someone new", icon: UserPlus },
  { value: "plan", label: "Showed the plan", hint: "Plan or meeting", icon: Presentation },
  { value: "followup", label: "Follow-up", hint: "Called or met again", icon: Phone },
  { value: "meeting", label: "Booked a meeting", hint: "Date set", icon: CalendarCheck },
];
const SELL: Option<Sell>[] = [
  { value: "sale", label: "Made a sale", hint: "To a customer", icon: ShoppingBag },
  { value: "customer", label: "Customer contact", hint: "Checked in", icon: MessageCircle },
  { value: "reorder", label: "Reorder", hint: "Repeat order", icon: Repeat },
];

/**
 * The global Log sheet: Log → Activity → Recruiting or Selling → what
 * happened, plus Learning, Check-in and New event. Anything logged can be
 * shared to Daily wins as a win card pointing at the same record. Rendered
 * once by the AppShell; open it with `openLog({ tab?, personId? })` (legacy
 * tabs map to: learning, checkin, customer → Selling › Customer contact,
 * sale → Selling › Made a sale). Right side sheet on desktop, bottom sheet on
 * phones.
 */
export function LogSheet() {
  const { open, tab, personId } = useUiStore((s) => s.logSheet);
  const closeLog = useUiStore((s) => s.closeLog);
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const access = useChatAccess();
  const [eventOpen, setEventOpen] = useState(false);

  const onEventCreated = (e: CrmEvent) => {
    navigate({ to: "/events/$id", params: { id: e.id } });
    if (!access.eligible) return;
    toast.success(`${e.name} created`, {
      action: {
        label: "Post in Main chat",
        onClick: () => {
          const r = sendMessage({
            conversationId: getTeamChatId("main"),
            card: { type: "event", eventId: e.id },
          });
          if (r) toast.success("Posted in Main chat");
        },
      },
    });
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && closeLog()}>
        <SheetContent
          side={desktop ? "right" : "bottom"}
          className={cn(
            "flex flex-col gap-0 p-0",
            desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-card pb-safe",
          )}
        >
          {!desktop && (
            <span
              className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line"
              aria-hidden="true"
            />
          )}
          <SheetHeader className="border-b border-line px-5 pb-3 pt-3.5 text-left lg:pt-4">
            <SheetTitle className="text-base font-extrabold">Log</SheetTitle>
            <SheetDescription className="text-[12.5px]">
              Record activity, learning or a check-in. Share it as a win in one tap.
            </SheetDescription>
          </SheetHeader>
          {/* Remount each time the sheet opens so it starts at the requested step. */}
          {open && (
            <LogFlow
              key={`${tab ?? ""}:${personId ?? ""}`}
              tab={tab}
              personId={personId}
              onNewEvent={() => {
                closeLog();
                setEventOpen(true);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
      <EventFormDialog open={eventOpen} onOpenChange={setEventOpen} onCreated={onEventCreated} />
    </>
  );
}

function LogFlow({
  tab,
  personId,
  onNewEvent,
}: {
  tab?: LogTab;
  personId?: string;
  onNewEvent: () => void;
}) {
  const user = useCurrentUser();
  const candidate = user.role === "candidate";
  const [step, setStep] = useState<Step>(() => initialStep(tab));
  const root = candidate
    ? ROOT.filter((o) => o.value === "learning" || o.value === "checkin")
    : ROOT;

  const crumbs: { label: string; to?: Step }[] = [{ label: "Log", to: { view: "menu" } }];
  if (step.view === "activity" || step.view === "recruiting" || step.view === "selling") {
    crumbs.push({ label: "Activity", to: { view: "activity" } });
  }
  if (step.view === "recruiting") crumbs.push({ label: "Recruiting" });
  if (step.view === "selling") crumbs.push({ label: "Selling" });
  if (step.view === "learning") crumbs.push({ label: "Learning" });
  if (step.view === "checkin") crumbs.push({ label: "Check-in" });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3.5">
      {step.view !== "menu" && (
        <nav aria-label="Log steps" className="mb-3">
          <ol className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li key={c.label} className="flex items-center gap-1.5">
                  {last || !c.to ? (
                    <b className="font-bold text-foreground" aria-current="step">
                      {c.label}
                    </b>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setStep(c.to!)}
                      className="rounded hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {c.label}
                    </button>
                  )}
                  {!last && <ChevronRight className="size-3" aria-hidden="true" />}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      {step.view === "menu" && (
        <OptionGrid
          label="What do you want to log?"
          options={root}
          onChange={(v) => {
            if (v === "event") onNewEvent();
            else if (v === "activity") setStep({ view: "activity" });
            else setStep({ view: v });
          }}
        />
      )}

      {step.view === "activity" && (
        <OptionGrid
          label="Recruiting or selling"
          options={AREAS}
          onChange={(v) => setStep({ view: v })}
        />
      )}

      {step.view === "recruiting" && (
        <div className="grid gap-4">
          <OptionGrid
            label="What happened"
            options={RECRUIT}
            value={step.kind}
            onChange={(kind) => setStep({ view: "recruiting", kind })}
          />
          {step.kind === "new" && <NewContactForm key="new" />}
          {step.kind && step.kind !== "new" && (
            <RecruitTouchForm
              key={step.kind}
              kind={
                step.kind === "plan" ? "plan" : step.kind === "followup" ? "followup" : "meeting"
              }
            />
          )}
        </div>
      )}

      {step.view === "selling" && (
        <div className="grid gap-4">
          <OptionGrid
            label="What happened"
            options={SELL}
            value={step.kind}
            onChange={(kind) => setStep({ view: "selling", kind })}
          />
          {step.kind === "sale" && (
            <SaleForm key="sale" initialCustomerId={tab === "sale" ? personId : undefined} />
          )}
          {step.kind === "reorder" && <SaleForm key="reorder" reorder />}
          {step.kind === "customer" && (
            <ContactForm
              key="customer"
              kind="customer"
              initialPersonId={tab === "customer" ? personId : undefined}
            />
          )}
        </div>
      )}

      {step.view === "learning" && <LearningForm />}
      {step.view === "checkin" && (
        <ContactForm kind="team" initialPersonId={tab === "checkin" ? personId : undefined} />
      )}
    </div>
  );
}

/** Teal "Log" button for page headers (desktop). Opens the Log sheet. */
export function LogButton({ className }: { className?: string }) {
  return (
    <Button className={className} onClick={() => openLog()}>
      <Plus /> Log
    </Button>
  );
}
