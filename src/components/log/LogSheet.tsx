import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BookOpen, MessageCircle, Plus, ShoppingBag, Receipt } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/brand";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { localDate } from "@/lib/dates";
import {
  logContact,
  logLearning,
  logSale,
  openLog,
  useCurrentUser,
  useLastContactMap,
  useUiStore,
  useVisibleCustomers,
  useVisibleTeam,
  daysSince,
  type CrmPerson,
  type LearningKind,
  type LogTab,
} from "@/data";

const TABS: { value: LogTab; label: string; short: string; icon: typeof BookOpen }[] = [
  { value: "learning", label: "Learning", short: "Learning", icon: BookOpen },
  { value: "checkin", label: "Check-in", short: "Check-in", icon: MessageCircle },
  { value: "customer", label: "Customer contact", short: "Customer", icon: ShoppingBag },
  { value: "sale", label: "Sale", short: "Sale", icon: Receipt },
];

/**
 * The global "Log" sheet: learning, team check-ins, customer contacts and
 * sales. Rendered once by the AppShell; open it from anywhere with
 * `openLog({ tab?, personId? })` (from "@/data" or "@/stores/uiStore").
 * Opens from the right on desktop and from the bottom on phones.
 */
export function LogSheet() {
  const { open, tab, personId } = useUiStore((s) => s.logSheet);
  const closeLog = useUiStore((s) => s.closeLog);
  const desktop = useIsDesktop();

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closeLog()}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn(
          "flex flex-col gap-0 p-0",
          desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-card pb-safe",
        )}
      >
        <SheetHeader className="border-b border-line px-5 py-4 text-left">
          <SheetTitle className="text-base font-extrabold">Log</SheetTitle>
          <SheetDescription className="text-[12.5px]">
            Record learning, a check-in, a customer contact or a sale.
          </SheetDescription>
        </SheetHeader>
        {/* Remount the form each time the sheet opens so fields reset to the requested target. */}
        {open && <LogForms key={`${tab ?? ""}:${personId ?? ""}`} tab={tab} personId={personId} />}
      </SheetContent>
    </Sheet>
  );
}

function LogForms({ tab, personId }: { tab?: LogTab; personId?: string }) {
  const [active, setActive] = useState<LogTab>(tab ?? "learning");
  return (
    <Tabs
      value={active}
      onValueChange={(v) => setActive(v as LogTab)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="px-5 pt-4">
        <TabsList className="grid h-auto w-full grid-cols-4">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="px-1 py-1.5 text-xs">
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">{t.short}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
        <TabsContent value="learning" className="mt-0">
          <LearningForm />
        </TabsContent>
        <TabsContent value="checkin" className="mt-0">
          <ContactForm kind="team" initialPersonId={tab === "checkin" ? personId : undefined} />
        </TabsContent>
        <TabsContent value="customer" className="mt-0">
          <ContactForm
            kind="customer"
            initialPersonId={tab === "customer" ? personId : undefined}
          />
        </TabsContent>
        <TabsContent value="sale" className="mt-0">
          <SaleForm initialCustomerId={tab === "sale" ? personId : undefined} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-semibold">
        {label}
      </Label>
      {children}
    </div>
  );
}

const KIND_OPTIONS: { value: LearningKind; label: string }[] = [
  { value: "pages", label: "Pages read" },
  { value: "podcast", label: "Podcast" },
  { value: "workshop", label: "Workshop" },
  { value: "conference", label: "Conference" },
];

function LearningForm() {
  const closeLog = useUiStore((s) => s.closeLog);
  const [kind, setKind] = useState<LearningKind>("pages");
  const [title, setTitle] = useState("");
  const [pages, setPages] = useState("20");
  const [date, setDate] = useState(localDate());
  const pageCount = Number(pages);
  const valid = title.trim() && (kind !== "pages" || pageCount > 0);

  const save = () => {
    if (!valid) return;
    logLearning({ kind, title: title.trim(), amount: kind === "pages" ? pageCount : 1, date });
    toast.success("Learning logged");
    closeLog();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label="Type">
        <div className="grid grid-cols-2 gap-2">
          {KIND_OPTIONS.map((k) => (
            <button
              key={k.value}
              type="button"
              aria-pressed={kind === k.value}
              onClick={() => setKind(k.value)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-[13px] font-semibold transition-colors",
                kind === k.value
                  ? "border-primary bg-primary-soft text-primary-ink"
                  : "border-line bg-surface hover:bg-surface-2",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label={kind === "pages" ? "Book" : "Title"} htmlFor="log-title">
        <Input
          id="log-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "pages" ? "e.g. Go-Givers Sell More" : "e.g. Leadership Hour #45"}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        {kind === "pages" && (
          <Field label="Pages" htmlFor="log-pages">
            <Input
              id="log-pages"
              type="number"
              inputMode="numeric"
              min={1}
              value={pages}
              onChange={(e) => setPages(e.target.value)}
            />
          </Field>
        )}
        <Field label="Date" htmlFor="log-date">
          <Input
            id="log-date"
            className="min-w-0"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
      </div>
      <Button type="submit" disabled={!valid}>
        <Plus /> Log learning
      </Button>
    </form>
  );
}

function PersonSelect({
  people,
  value,
  onChange,
  placeholder,
  ages,
}: {
  people: CrmPerson[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  ages: Map<string, string>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {people.map((p) => {
          const age = daysSince(ages.get(p.id));
          return (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {age === null ? "never" : age === 0 ? "today" : `${age}d ago`}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/** Most overdue first, then by name. */
function byStaleness(ages: Map<string, string>) {
  return (a: CrmPerson, b: CrmPerson) => {
    const da = ages.get(a.id) ?? "";
    const db = ages.get(b.id) ?? "";
    return da === db ? a.name.localeCompare(b.name) : da.localeCompare(db);
  };
}

function ContactForm({
  kind,
  initialPersonId,
}: {
  kind: "team" | "customer";
  initialPersonId?: string;
}) {
  const user = useCurrentUser();
  const closeLog = useUiStore((s) => s.closeLog);
  const team = useVisibleTeam();
  const customers = useVisibleCustomers();
  const ages = useLastContactMap();
  const options = useMemo(() => {
    const list = kind === "team" ? team.filter((p) => p.id !== user.personId) : customers;
    return [...list].sort(byStaleness(ages));
  }, [kind, team, customers, user.personId, ages]);

  const [personId, setPersonId] = useState(
    initialPersonId && options.some((p) => p.id === initialPersonId) ? initialPersonId : "",
  );
  const [date, setDate] = useState(localDate());
  const [note, setNote] = useState("");

  if (options.length === 0) {
    return (
      <EmptyState
        title={kind === "team" ? "No team members yet" : "No customers yet"}
        body={
          kind === "team"
            ? "Check-ins are for people in your downline."
            : "Customers you own will show up here."
        }
      />
    );
  }

  const save = () => {
    if (!personId) return;
    logContact({ personId, date, note: note.trim() || undefined });
    const name = options.find((p) => p.id === personId)?.name ?? "";
    toast.success(kind === "team" ? `Check-in with ${name} logged` : `Contact with ${name} logged`);
    closeLog();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label={kind === "team" ? "Team member" : "Customer"}>
        <PersonSelect
          people={options}
          value={personId}
          onChange={setPersonId}
          placeholder={kind === "team" ? "Who did you check in with?" : "Which customer?"}
          ages={ages}
        />
      </Field>
      <Field label="Date" htmlFor={`log-${kind}-date`}>
        <Input
          id={`log-${kind}-date`}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <Field label="Note (optional)" htmlFor={`log-${kind}-note`}>
        <Textarea
          id={`log-${kind}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={kind === "team" ? "What did you talk about?" : "Reorder? Questions?"}
        />
      </Field>
      <Button type="submit" disabled={!personId}>
        <Plus /> {kind === "team" ? "Log check-in" : "Log contact"}
      </Button>
    </form>
  );
}

function SaleForm({ initialCustomerId }: { initialCustomerId?: string }) {
  const closeLog = useUiStore((s) => s.closeLog);
  const customers = useVisibleCustomers();
  const ages = useLastContactMap();
  const [customerId, setCustomerId] = useState(
    initialCustomerId && customers.some((c) => c.id === initialCustomerId) ? initialCustomerId : "",
  );
  const [product, setProduct] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(localDate());

  if (customers.length === 0) {
    return (
      <EmptyState
        title="No customers yet"
        body="Sales are logged against customers you own."
        action={
          <Button size="sm" variant="outline" onClick={() => openLog({ tab: "learning" })}>
            Log learning instead
          </Button>
        }
      />
    );
  }

  const valid = customerId && product.trim();
  const save = () => {
    if (!valid) return;
    const n = Number(amount);
    logSale({
      customerId,
      product: product.trim(),
      date,
      amount: amount !== "" && Number.isFinite(n) ? n : undefined,
    });
    toast.success("Sale logged");
    closeLog();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label="Customer">
        <PersonSelect
          people={customers}
          value={customerId}
          onChange={setCustomerId}
          placeholder="Which customer?"
          ages={ages}
        />
      </Field>
      <Field label="Product" htmlFor="log-product">
        <Input
          id="log-product"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          placeholder="e.g. XS Energy (case)"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount ($, optional)" htmlFor="log-amount">
          <Input
            id="log-amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Date" htmlFor="log-sale-date">
          <Input
            id="log-sale-date"
            className="min-w-0"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
      </div>
      <Button type="submit" disabled={!valid}>
        <Plus /> Log sale
      </Button>
    </form>
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
