/**
 * Log sheet forms. Each one writes the CRM record through @/data and can share
 * it to Daily wins as a card pointing at that same record (no double entry).
 *
 * Recruiting activities are stored as (decision, minimal):
 *  - New contact   -> a new prospect sponsored by you (addPerson) + a contact
 *                     row "New contact"; the win card's refId is the person id.
 *  - Showed the plan / Follow-up / Booked a meeting -> a contact row
 *                     (logContact) whose note starts with the activity
 *                     ("Showed the plan", "Follow-up", "Booked a meeting for
 *                     Oct 20"); refId is the contact id.
 * Pipeline board (src/data/pipeline): New contact puts the prospect on the
 * board in Contact made; Showed the plan moves them to First plan; Booked a
 * meeting moves them to the column picked (the next one by default). Undo
 * takes the move back too.
 * Selling: Made a sale / Reorder -> logSale with PV (refId sale id); "My own
 * order" logs a personal order (the buyer is you; counts toward your PV, not
 * shared as a win); Customer contact
 * -> logContact. Check-in -> logContact; Learning -> logLearning (learning card).
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { format } from "date-fns";
import { EmptyState } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { localDate } from "@/lib/dates";
import {
  addPerson,
  closeLog,
  effectiveBizClass,
  goalUnit,
  latestLearningId,
  logContact,
  logLearning,
  logSale,
  movePipelineCard,
  parseDate,
  postLearning,
  postWin,
  recordShowedPlan,
  removeContact,
  removeLearning,
  removePerson,
  removeSale,
  startPipelineCard,
  unpost,
  useCurrentUser,
  useLastContactMap,
  useLearning,
  useLearningGoal,
  useProspectPipeline,
  useVisibleCustomers,
  useVisibleTeam,
  type LearningKind,
  type LearningUnit,
  type Message,
  type PodcastUnit,
  type ReadingUnit,
  type WinKind,
} from "@/data";
import { toastWithUndo } from "./quickLog";
import {
  byStaleness,
  Field,
  PersonSelect,
  PODCAST_UNITS,
  READING_UNITS,
  UnitToggle,
} from "./parts";
import { ShareAsWin, type WinDraft } from "./ShareAsWin";
import { useCanShareWins } from "./canShareWins";
import { BoardMoveField, BoardNote } from "./PipelineMoveField";
import { TitleCombobox } from "./TitleCombobox";
import { matchTitle, pastTitles } from "./titleSuggestions";
import { boardTarget, movesToPlan } from "./pipelineMove";

// ---------------------------------------------------------------------------
// Shared: save + optional share + Undo toast
// ---------------------------------------------------------------------------

function finish(opts: {
  message: string;
  undoneMessage: string;
  undo: () => void;
  share?: { winKind: WinKind; refId: string; draft: WinDraft } | null;
  learning?: { learningId: string; title: string } | null;
}) {
  let posted: Message | null = null;
  if (opts.share?.draft.on) {
    posted = postWin({
      winKind: opts.share.winKind,
      refId: opts.share.refId,
      title: opts.share.draft.title.trim() || "A win",
      detail: opts.share.draft.detail.trim() || undefined,
    });
  } else if (opts.learning) {
    posted = postLearning(opts.learning);
  }
  const wanted = !!opts.share?.draft.on || !!opts.learning;
  toastWithUndo(
    posted ? `${opts.message} and shared in Daily wins` : opts.message,
    () => {
      if (posted) unpost(posted.id);
      opts.undo();
    },
    { undoneMessage: opts.undoneMessage },
  );
  if (wanted && !posted)
    toast.error("Logged, but it couldn't be shared: you're not in Daily wins.");
  closeLog();
}

/** The win draft; never "on" when wins can't be shared (no chat, or Chats switched off). */
function useWin(on: boolean, title: string, detail = "") {
  const canShare = useCanShareWins();
  const [draft, setDraft] = useState<WinDraft>({ on, title, detail });
  return [canShare ? draft : { ...draft, on: false }, setDraft] as const;
}

function SubmitButton({
  disabled,
  sharing,
  label,
}: {
  disabled: boolean;
  sharing: boolean;
  label: string;
}) {
  return (
    <Button type="submit" disabled={disabled}>
      <Plus /> {sharing ? `${label} and share` : label}
    </Button>
  );
}

function DateField({
  id,
  value,
  onChange,
  label = "Date",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        className="min-w-0"
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

const KIND_OPTIONS: { value: LearningKind; label: string }[] = [
  { value: "pages", label: "Reading" },
  { value: "podcast", label: "Podcast" },
  { value: "workshop", label: "Workshop" },
  { value: "conference", label: "Conference" },
];

/** The amount the field starts at for each unit. */
const UNIT_DEFAULT: Record<LearningUnit, string> = {
  minutes: "30",
  pages: "20",
  chapters: "1",
  episodes: "1",
};

const UNIT_FIELD: Record<LearningUnit, string> = {
  minutes: "Minutes",
  pages: "Pages",
  chapters: "Chapters",
  episodes: "Episodes",
};

export function LearningForm() {
  const user = useCurrentUser();
  // Start in the units the weekly goal counts, so a log moves the goal.
  const goal = useLearningGoal(user.personId);
  const [kind, setKind] = useState<LearningKind>("pages");
  const [title, setTitle] = useState("");
  const [readingUnit, setReadingUnit] = useState<ReadingUnit>(goalUnit(goal, "reading") ?? "pages");
  const [podcastUnit, setPodcastUnit] = useState<PodcastUnit>(
    goalUnit(goal, "podcasts") ?? "episodes",
  );
  const [amounts, setAmounts] = useState<Record<LearningUnit, string>>(UNIT_DEFAULT);
  const [date, setDate] = useState(localDate());
  const [win, setWin] = useWin(false, "");
  // Books (or podcasts) you've logged before, for the title dropdown.
  const history = useLearning(user.personId);
  const titles = useMemo(() => pastTitles(history, kind), [history, kind]);
  const unit: LearningUnit | undefined =
    kind === "pages" ? readingUnit : kind === "podcast" ? podcastUnit : undefined;
  const amount = unit ? Number(amounts[unit]) : 1;
  const valid = !!title.trim() && (!unit || (Number.isInteger(amount) && amount > 0));

  const save = () => {
    if (!valid) return;
    // Typed an old title in different case? Log it under the existing spelling.
    const name = matchTitle(titles, title)?.title ?? title.trim();
    logLearning({ kind, title: name, amount, ...(unit ? { unit } : {}), date });
    const id = latestLearningId();
    finish({
      message: "Learning logged",
      undoneMessage: "Learning removed",
      undo: () => id && removeLearning(id),
      learning: win.on && id ? { learningId: id, title: name } : null,
    });
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
                "rounded-lg border px-3 py-2 text-left text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring",
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
        <TitleCombobox
          id="log-title"
          value={title}
          onChange={setTitle}
          titles={titles}
          noun={kind === "pages" ? "book" : kind}
          placeholder={kind === "pages" ? "e.g. Go-Givers Sell More" : "e.g. Leadership Hour #45"}
        />
      </Field>
      {kind === "pages" && (
        <Field label="Measure by">
          <UnitToggle
            label="Measure reading by"
            options={READING_UNITS}
            value={readingUnit}
            onChange={setReadingUnit}
          />
        </Field>
      )}
      {kind === "podcast" && (
        <Field label="Measure by">
          <UnitToggle
            label="Measure listening by"
            options={PODCAST_UNITS}
            value={podcastUnit}
            onChange={setPodcastUnit}
          />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        {unit && (
          <Field label={UNIT_FIELD[unit]} htmlFor="log-amount">
            <Input
              id="log-amount"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={amounts[unit]}
              onChange={(e) => setAmounts((a) => ({ ...a, [unit]: e.target.value }))}
            />
          </Field>
        )}
        <DateField id="log-date" value={date} onChange={setDate} />
      </div>
      <ShareAsWin
        id="share-learning"
        value={win}
        onChange={setWin}
        winKind="other"
        learningTitle={title.trim()}
      />
      <SubmitButton disabled={!valid} sharing={win.on} label="Log learning" />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Check-in (team) and Customer contact
// ---------------------------------------------------------------------------

export function ContactForm({
  kind,
  initialPersonId,
}: {
  kind: "team" | "customer";
  initialPersonId?: string;
}) {
  const user = useCurrentUser();
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
  const [win, setWin] = useWin(
    false,
    kind === "team" ? "Checked in with my team" : "Checked in with a customer",
  );

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
    const contact = logContact({ personId, date, note: note.trim() || undefined });
    const name = options.find((p) => p.id === personId)?.name ?? "";
    finish({
      message: kind === "team" ? `Check-in with ${name} logged` : `Contact with ${name} logged`,
      undoneMessage: "Check-in removed",
      undo: () => removeContact(contact.id),
      share: { winKind: "other", refId: contact.id, draft: win },
    });
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
      <DateField id={`log-${kind}-date`} value={date} onChange={setDate} />
      <Field label="Note (optional)" htmlFor={`log-${kind}-note`}>
        <Textarea
          id={`log-${kind}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={kind === "team" ? "What did you talk about?" : "Reorder? Questions?"}
        />
      </Field>
      <ShareAsWin id={`share-${kind}`} value={win} onChange={setWin} winKind="other" />
      <SubmitButton
        disabled={!personId}
        sharing={win.on}
        label={kind === "team" ? "Log check-in" : "Log contact"}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sale and reorder
// ---------------------------------------------------------------------------

export function SaleForm({
  initialCustomerId,
  reorder,
}: {
  initialCustomerId?: string;
  reorder?: boolean;
}) {
  const user = useCurrentUser();
  const customers = useVisibleCustomers();
  const ages = useLastContactMap();
  const candidate = user.role === "candidate";
  const [personal, setPersonal] = useState(
    !candidate && (customers.length === 0 || initialCustomerId === user.personId),
  );
  const [customerId, setCustomerId] = useState(
    initialCustomerId && customers.some((c) => c.id === initialCustomerId) ? initialCustomerId : "",
  );
  const [product, setProduct] = useState("");
  const [amount, setAmount] = useState("");
  const [pvValue, setPvValue] = useState("");
  const [date, setDate] = useState(localDate());
  const [win, setWin] = useWin(!personal, reorder ? "Customer reordered" : "Made a sale");

  if (candidate) {
    return (
      <EmptyState title="No customers yet" body="Sales are logged against customers you own." />
    );
  }

  const buyer = personal ? user.personId : customerId;
  const pvNum = Number(pvValue);
  const pvOk = pvValue.trim() === "" || (Number.isFinite(pvNum) && pvNum >= 0);
  const valid = !!buyer && !!product.trim() && pvOk;
  const save = () => {
    if (!valid) return;
    const n = Number(amount);
    const sale = logSale({
      customerId: buyer,
      product: product.trim(),
      date,
      amount: amount !== "" && Number.isFinite(n) ? n : undefined,
      pv: pvValue.trim() !== "" ? pvNum : undefined,
    });
    const pvNote = sale.pv ? ` · ${sale.pv} PV` : "";
    finish({
      message: `${personal ? "Personal order logged" : reorder ? "Reorder logged" : "Sale logged"}${pvNote}`,
      undoneMessage: personal ? "Order removed" : "Sale removed",
      undo: () => removeSale(sale.id),
      share: personal ? null : { winKind: "sale", refId: sale.id, draft: win },
    });
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div
        role="radiogroup"
        aria-label="Who bought"
        className="grid grid-cols-2 gap-1 rounded-[10px] bg-surface-2 p-[3px]"
      >
        {[
          { on: false, label: "A customer" },
          { on: true, label: "My own order" },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={personal === o.on}
            onClick={() => {
              setPersonal(o.on);
              setWin((w) => ({ ...w, on: !o.on }));
            }}
            className={cn(
              "rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring",
              personal === o.on && "bg-card text-foreground shadow-sm",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {personal ? (
        <p className="-mt-1 text-[12px] text-muted-foreground">
          Products you buy for yourself count toward your PV too.
        </p>
      ) : customers.length === 0 ? (
        <EmptyState
          title="No customers yet"
          body="Add a customer first, or log your own order: it counts toward your PV too."
        />
      ) : (
        <Field label="Customer">
          <PersonSelect
            people={customers}
            value={customerId}
            onChange={setCustomerId}
            placeholder="Which customer?"
            ages={ages}
          />
        </Field>
      )}
      <Field label="Product" htmlFor="log-product">
        <Input
          id="log-product"
          value={product}
          onChange={(e) => {
            setProduct(e.target.value);
            setWin((w) => ({ ...w, detail: e.target.value }));
          }}
          placeholder="e.g. XS Energy (case)"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="PV" htmlFor="log-pv">
          <Input
            id="log-pv"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={pvValue}
            onChange={(e) => setPvValue(e.target.value)}
            aria-describedby="log-pv-hint"
          />
        </Field>
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
      </div>
      <p id="log-pv-hint" className="-mt-2 text-[11.5px] text-muted-foreground">
        The point value on the order. It counts toward this month's PV.
      </p>
      <DateField id="log-sale-date" value={date} onChange={setDate} />
      {!personal && <ShareAsWin id="share-sale" value={win} onChange={setWin} winKind="sale" />}
      <SubmitButton
        disabled={!valid}
        sharing={!personal && win.on}
        label={personal ? "Log order" : reorder ? "Log reorder" : "Log sale"}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Recruiting
// ---------------------------------------------------------------------------

export function NewContactForm() {
  const user = useCurrentUser();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [where, setWhere] = useState("");
  const [date, setDate] = useState(localDate());
  const [win, setWin] = useWin(true, "Just made a new contact", "Recruiting");

  const save = () => {
    if (!name.trim()) return;
    const person = addPerson({
      name: name.trim(),
      bizClass: "prospect",
      sponsorId: user.personId,
      joinedDate: date,
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(where.trim() ? { notes: `Met ${where.trim()}` } : {}),
    });
    const contact = logContact({ personId: person.id, date, note: "New contact" });
    const undoCard = startPipelineCard(person.id, { source: where });
    finish({
      message: `${person.name} added as a new prospect`,
      undoneMessage: "New contact removed",
      undo: () => {
        undoCard?.();
        removeContact(contact.id);
        removePerson(person.id);
      },
      share: { winKind: "contact", refId: person.id, draft: win },
    });
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label="Who (a new prospect)" htmlFor="log-new-name">
        <Input
          id="log-new-name"
          value={name}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          placeholder="Their name"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone (optional)" htmlFor="log-new-phone">
          <Input
            id="log-new-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <DateField id="log-new-date" value={date} onChange={setDate} />
      </div>
      <Field label="Where you met (optional)" htmlFor="log-new-where">
        <Input
          id="log-new-where"
          value={where}
          onChange={(e) => {
            setWhere(e.target.value);
            const w = e.target.value.trim();
            setWin((d) => ({ ...d, detail: w ? `Recruiting · met ${w}` : "Recruiting" }));
          }}
          placeholder="e.g. at the gym"
        />
      </Field>
      <ShareAsWin id="share-new-contact" value={win} onChange={setWin} winKind="contact" />
      <SubmitButton disabled={!name.trim()} sharing={win.on} label="Log" />
    </form>
  );
}

export type RecruitTouch = "plan" | "followup" | "meeting";

const TOUCH: Record<
  RecruitTouch,
  { note: string; win: string; winKind: WinKind; share: boolean; button: string }
> = {
  plan: {
    note: "Showed the plan",
    win: "Showed the plan",
    winKind: "plan",
    share: true,
    button: "Log",
  },
  followup: {
    note: "Follow-up",
    win: "Followed up with a prospect",
    winKind: "other",
    share: false,
    button: "Log follow-up",
  },
  meeting: {
    note: "Booked a meeting",
    win: "Booked a meeting",
    winKind: "other",
    share: true,
    button: "Log",
  },
};

/** Showed the plan, Follow-up, Booked a meeting: a contact with a typed note. */
export function RecruitTouchForm({ kind }: { kind: RecruitTouch }) {
  const user = useCurrentUser();
  const team = useVisibleTeam();
  const ages = useLastContactMap();
  const t = TOUCH[kind];
  // Prospects first (who you're recruiting), then the rest of your team.
  const options = useMemo(() => {
    const list = team.filter((p) => p.id !== user.personId);
    const stale = byStaleness(ages);
    return list.sort(
      (a, b) =>
        Number(effectiveBizClass(a) !== "prospect") - Number(effectiveBizClass(b) !== "prospect") ||
        stale(a, b),
    );
  }, [team, user.personId, ages]);
  const [personId, setPersonId] = useState("");
  const [date, setDate] = useState(localDate());
  const [meetingDate, setMeetingDate] = useState("");
  // Pipeline board: where "Booked a meeting" moves the card ("" = next column).
  const board = useProspectPipeline(personId || undefined);
  const [boardPick, setBoardPick] = useState("");
  const [note, setNote] = useState("");
  const [win, setWin] = useWin(t.share, t.win, "Recruiting");

  if (options.length === 0) {
    return <EmptyState title="Nobody on your team yet" body="Log a new contact first." />;
  }

  const save = () => {
    if (!personId) return;
    const label =
      kind === "meeting" && meetingDate
        ? `${t.note} for ${format(parseDate(meetingDate), "MMM d")}`
        : t.note;
    const contact = logContact({
      personId,
      date,
      note: note.trim() ? `${label}: ${note.trim()}` : label,
    });
    const name = options.find((p) => p.id === personId)?.name ?? "";
    const target = kind === "meeting" ? boardTarget(board, boardPick) : null;
    const moved =
      kind === "plan"
        ? recordShowedPlan(personId)
        : target
          ? movePipelineCard(personId, target, {
              nextStep: "Meeting",
              nextStepDate: meetingDate || null,
            })
          : null;
    finish({
      message: `${label} with ${name} logged`,
      undoneMessage: "Removed",
      undo: () => {
        if (moved?.ok) moved.undo();
        removeContact(contact.id);
      },
      share: { winKind: t.winKind, refId: contact.id, draft: win },
    });
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label="Who">
        <PersonSelect
          people={options}
          value={personId}
          onChange={(id) => {
            setPersonId(id);
            setBoardPick("");
          }}
          placeholder="Pick a prospect or team member"
          ages={ages}
          label="Who"
        />
      </Field>
      {kind === "plan" && movesToPlan(board) && (
        <BoardNote>Moves them to First plan on the pipeline board.</BoardNote>
      )}
      <div className="grid grid-cols-2 gap-3">
        <DateField id={`log-${kind}-date`} value={date} onChange={setDate} />
        {kind === "meeting" && (
          <DateField
            id="log-meeting-on"
            label="Meeting on"
            value={meetingDate}
            onChange={setMeetingDate}
          />
        )}
      </div>
      {kind === "meeting" && (
        <BoardMoveField pipeline={board} pick={boardPick} onPick={setBoardPick} />
      )}
      <Field label="Note (optional)" htmlFor={`log-${kind}-note`}>
        <Textarea
          id={`log-${kind}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Only you and your upline see this"
        />
      </Field>
      <ShareAsWin id={`share-${kind}`} value={win} onChange={setWin} winKind={t.winKind} />
      <SubmitButton disabled={!personId} sharing={win.on} label={t.button} />
    </form>
  );
}
