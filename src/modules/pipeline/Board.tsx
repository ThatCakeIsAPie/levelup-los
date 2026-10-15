import { useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { useNavigate } from "@tanstack/react-router";
import { CalendarClock, ClockAlert, Flag, GripVertical, MoreHorizontal, X } from "lucide-react";
import { PersonAvatar, useIsDesktop } from "@/components/brand";
import { cn } from "@/lib/utils";
import {
  RECRUITING_BOARD,
  monthName,
  monthOf,
  localDate,
  useCurrentUser,
  type BoardBand,
  type BoardCard,
  type BoardColumn,
  type BoardDef,
  type PipelineBoard,
  type PipelineColumn,
  type RegisteredCard,
} from "@/data";
import { CardSheet } from "./CardSheet";
import { MoveMenu } from "./moveCard";
import { useMoveCard } from "./useMoveCard";
import { useBoardDrag, type DragInfo } from "./useBoardDrag";
import { ageLong, ageShort, nextStepText, overdue, ownCards, shortDate, stepBy } from "./format";

const SHOW = 5;

/** Menus render in a portal, but React events still bubble to the card: stop them here. */
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** The recruiting board (prospects, with the Register confirmation and the card sheet). */
export function Board({ board, month }: { board: PipelineBoard; month: string }) {
  const { move, dialog } = useMoveCard(board.columns);
  return (
    <BoardView
      board={board as unknown as PipelineBoard<string>}
      month={month}
      def={RECRUITING_BOARD as BoardDef<string>}
      move={move}
      sheet={({ card, open, onOpenChange }) => (
        <CardSheet
          card={card}
          columns={board.columns}
          open={open}
          onOpenChange={onOpenChange}
          onMove={move}
        />
      )}
    >
      {dialog}
    </BoardView>
  );
}

/**
 * A board (the recruiting pipeline, or the customer pipeline with
 * CUSTOMER_BOARD): its bands side by side, each with its milestone column and
 * the leader steps after it (the customer board adds fixed start and outcome
 * columns). Desktop: bands side by side, scrolling sideways when wider than
 * the screen; drag a card (or use its "Move to…" menu). Phones: one full
 * column at a time with the next one peeking in; hold a card to drag it, or
 * tap the grip for "Move to…".
 */
export function BoardView({
  board,
  month,
  def,
  move,
  sheet,
  children,
}: {
  board: PipelineBoard<string>;
  month: string;
  def: BoardDef<string>;
  move: (id: string, name: string, to: string) => void;
  /** The card details sheet (opened by a tap on a card). */
  sheet: (p: {
    card: BoardCard | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => ReactNode;
  /** Dialogs the mover needs (rendered once). */
  children?: ReactNode;
}) {
  const desktop = useIsDesktop();
  const me = useCurrentUser().personId;
  const scroller = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const cards = useMemo(() => {
    const m = new Map<string, BoardCard>();
    for (const b of board.bands)
      for (const c of b.columns) for (const card of c.cards) m.set(card.personId, card);
    return m;
  }, [board]);
  const { drag, start, suppressClick } = useBoardDrag({
    scroller,
    pageStep: !desktop,
    onDrop: (personId, to) => {
      const card = cards.get(personId);
      if (card) move(personId, card.name, to);
    },
  });

  const open = (personId: string) => {
    if (suppressClick.current) return;
    setOpenId(personId);
    setSheetOpen(true);
  };
  const markMine = useMemo(() => ownCards(board, me).mixed, [board, me]);
  const isMine = (ownerId: string) => markMine && ownerId === me;
  // On a mixed board your own cards come first in every column (otherwise in
  // the usual order: hot, then newest in the column).
  const shown = useMemo(() => (markMine ? mineFirst(board, me) : board), [board, me, markMine]);
  const ctx: CardCtx = { columns: board.columns, def, drag, start, open, move, markMine, isMine };
  const isThisMonth = monthOf(localDate()) === month;
  const label = def.kind === "customer" ? "Customer pipeline board" : "Pipeline board";

  return (
    <>
      {desktop ? (
        <div ref={scroller} className="overflow-x-auto pb-2" aria-label={label}>
          <div className="flex w-max items-start gap-3.5">
            {shown.bands.map((band) => (
              <DesktopBand
                key={band.milestone}
                band={band}
                month={month}
                isThisMonth={isThisMonth}
                registered={shown.registered}
                ctx={ctx}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <p className="text-center text-[11.5px] text-muted-foreground">
            Swipe sideways for more stages · hold a card to move it
          </p>
          <div
            ref={scroller}
            aria-label={label}
            className="-mx-4 flex snap-x snap-mandatory scroll-px-4 items-start gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {shown.bands.flatMap((band) =>
              band.columns.map((col) => (
                <PhoneColumn
                  key={col.column.id}
                  band={band.milestone}
                  col={col}
                  month={month}
                  isThisMonth={isThisMonth}
                  registered={shown.registered}
                  ctx={ctx}
                />
              )),
            )}
          </div>
        </div>
      )}
      {drag && <DragGhost drag={drag} />}
      {sheet({
        card: openId ? (cards.get(openId) ?? null) : null,
        open: sheetOpen && !!openId && cards.has(openId),
        onOpenChange: setSheetOpen,
      })}
      {children}
    </>
  );
}

/** The board with `me`'s cards first in each column and in Registered (stable sort). */
function mineFirst<B extends string>(board: PipelineBoard<B>, me: string): PipelineBoard<B> {
  const first = <T extends { ownerId: string }>(list: T[]) =>
    [...list].sort((a, b) => Number(b.ownerId === me) - Number(a.ownerId === me));
  return {
    ...board,
    bands: board.bands.map((band) => ({
      ...band,
      columns: band.columns.map((col) => ({ ...col, cards: first(col.cards) })),
    })),
    registered: { ...board.registered, cards: first(board.registered.cards) },
  };
}

interface CardCtx {
  columns: PipelineColumn<string>[];
  def: BoardDef<string>;
  drag: DragInfo | null;
  start: ReturnType<typeof useBoardDrag>["start"];
  open: (personId: string) => void;
  move: (personId: string, name: string, to: string) => void;
  /** The board mixes your cards with other people's, so yours are marked. */
  markMine: boolean;
  /** A card of yours on a mixed board (always false otherwise). */
  isMine: (ownerId: string) => boolean;
}

const bandDef = (def: BoardDef<string>, id: string) => def.bands.find((b) => b.id === id);
const bandLabel = (def: BoardDef<string>, id: string) => bandDef(def, id)?.label ?? id;
/** The recruiting board's Registered column lists the month's registrations, not cards. */
const isRegisteredList = (def: BoardDef<string>, c: PipelineColumn<string>) =>
  def.kind === "recruiting" && c.id === "registered";
/** The last milestone (Registered, On Ditto) gets a green count. */
const isWon = (def: BoardDef<string>, c: PipelineColumn<string>) =>
  c.kind === "milestone" && c.id === def.milestones[def.milestones.length - 1];

function reachedText(m: string, n: number, month: string, isThisMonth: boolean) {
  const when = isThisMonth ? "this month" : `in ${monthName(month, "short")}`;
  if (m === "first_meeting") return `${n} held ${when}`;
  if (m === "registered") return when;
  return `${n} ${when}`;
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

function BandBadge({ def, band }: { def: BoardDef<string>; band: string }) {
  const b = bandDef(def, band);
  const milestones = def.bands.filter((x) => x.kind === "milestone");
  return (
    <span
      className={cn(
        "grid size-5 place-items-center rounded-md text-[11px] font-extrabold",
        b?.kind === "milestone" ? "bg-foreground text-background" : "bg-surface-2 text-faint",
      )}
      aria-hidden="true"
    >
      {b?.kind === "milestone" ? (
        milestones.findIndex((x) => x.id === band) + 1
      ) : b?.kind === "outcome" ? (
        <X className="size-3" />
      ) : (
        "·"
      )}
    </span>
  );
}

function DesktopBand({
  band,
  month,
  isThisMonth,
  registered,
  ctx,
}: {
  band: BoardBand<string>;
  month: string;
  isThisMonth: boolean;
  registered: PipelineBoard<string>["registered"];
  ctx: CardCtx;
}) {
  const m = band.milestone;
  const kind = bandDef(ctx.def, m)?.kind;
  const regList = band.columns.some((c) => isRegisteredList(ctx.def, c.column));
  const yours = regList
    ? registered.cards.filter((r) => ctx.isMine(r.ownerId)).length
    : band.columns.reduce((n, c) => n + c.cards.filter((x) => ctx.isMine(x.ownerId)).length, 0);
  return (
    <section className="grid gap-2" aria-label={`${bandLabel(ctx.def, m)} band`}>
      <header className="flex items-center gap-2 px-0.5 text-[12.5px]">
        <BandBadge def={ctx.def} band={m} />
        <b>{bandLabel(ctx.def, m)}</b>
        <span className="text-[11.5px] text-muted-foreground">
          {regList
            ? `${band.count} ${isThisMonth ? "this month" : `in ${monthName(month, "short")}`}`
            : kind === "milestone"
              ? `${band.count} in this band`
              : band.count}
          {ctx.markMine && <YoursCount n={yours} />}
        </span>
      </header>
      <div
        className={cn(
          "flex items-start gap-2 rounded-2xl p-2",
          kind === "outcome" ? "border border-dashed border-line" : "bg-surface-2",
        )}
      >
        {band.columns.map((col) => (
          <DesktopColumn
            key={col.column.id}
            col={col}
            month={month}
            isThisMonth={isThisMonth}
            registered={registered}
            ctx={ctx}
          />
        ))}
      </div>
    </section>
  );
}

function ColumnHead({
  col,
  count,
  month,
  isThisMonth,
  def,
}: {
  col: BoardColumn<string>;
  count: number;
  month: string;
  isThisMonth: boolean;
  def: BoardDef<string>;
}) {
  const c = col.column;
  const won = isWon(def, c);
  const regList = isRegisteredList(def, c);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 px-0.5 pb-1 pt-0.5">
      <b className="truncate text-[13px]" title={c.label}>
        {c.label}
      </b>
      <span
        className={cn(
          "rounded-full px-2 text-xs font-extrabold leading-5 tabular-nums",
          won ? "bg-good-soft text-good" : "bg-surface",
        )}
      >
        {count}
      </span>
      {col.reached !== null && !regList && (
        <span className="col-span-2 text-[11px] text-muted-foreground">
          {reachedText(c.band, col.reached, month, isThisMonth)}
        </span>
      )}
      {regList && (
        <span className="col-span-2 text-[11px] text-muted-foreground">
          {isThisMonth ? "this month" : `in ${monthName(month)}`}
        </span>
      )}
      {c.kind === "milestone" ? (
        <span className="col-span-2 inline-flex items-center gap-1 text-[10.5px] font-bold">
          <Flag className="size-3 text-amber-strong" aria-hidden="true" /> Milestone
        </span>
      ) : c.kind === "fixed" ? (
        <span className="col-span-2 text-[10.5px] font-semibold text-faint">{c.hint}</span>
      ) : (
        <span className="col-span-2 text-[10.5px] font-semibold text-faint">{stepBy(c)}</span>
      )}
    </div>
  );
}

function DesktopColumn({
  col,
  month,
  isThisMonth,
  registered,
  ctx,
}: {
  col: BoardColumn<string>;
  month: string;
  isThisMonth: boolean;
  registered: PipelineBoard<string>["registered"];
  ctx: CardCtx;
}) {
  const [all, setAll] = useState(false);
  const c = col.column;
  const isReg = isRegisteredList(ctx.def, c);
  const over = ctx.drag?.over === c.id && ctx.drag.from !== c.id;
  const list = isReg ? [] : col.cards;
  const shown = all ? list : list.slice(0, SHOW);
  return (
    <div
      data-drop-column={c.id}
      aria-label={`${c.label}, ${isReg ? registered.total : list.length}`}
      className={cn(
        "grid w-[186px] grid-cols-[minmax(0,1fr)] content-start gap-2 rounded-card bg-app p-2.5 transition-shadow",
        c.kind === "milestone" && "shadow-[inset_0_3px_0_var(--color-stage-ibo)]",
        over && "ring-2 ring-sky",
      )}
    >
      <ColumnHead
        col={col}
        count={isReg ? registered.total : list.length}
        month={month}
        isThisMonth={isThisMonth}
        def={ctx.def}
      />
      {isReg ? (
        <RegisteredList registered={registered} isMine={ctx.isMine} />
      ) : (
        <>
          {shown.map((card) => (
            <DesktopCard key={card.personId} card={card} ctx={ctx} />
          ))}
          {list.length === 0 && (
            <p className="rounded-[10px] border border-dashed border-line px-2 py-3 text-center text-[11px] text-faint">
              {ctx.drag ? "Drop here" : "Nobody here"}
            </p>
          )}
          {list.length > SHOW && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="rounded-sm py-0.5 text-center text-[11.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {all ? "Show less" : `+${list.length - SHOW} more`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Your own cards on a mixed board: a green bar down the left edge. */
const MINE_ACCENT = "shadow-[inset_3px_0_0_var(--color-primary)]";

/** "· 12 yours" after a count, on a mixed board. */
function YoursCount({ n }: { n: number }) {
  return <span className="font-bold text-primary-ink"> · {n} yours</span>;
}

function OwnerTag({
  card,
  mine = false,
}: {
  card: { ownerName: string; ownerStage?: BoardCard["ownerStage"] };
  mine?: boolean;
}) {
  if (mine)
    return (
      <span className="rounded-full bg-primary-soft px-1.5 text-[10px] font-extrabold text-primary-ink">
        You
      </span>
    );
  if (!card.ownerName) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 font-semibold text-foreground">
      <PersonAvatar
        name={card.ownerName}
        stage={card.ownerStage}
        size="sm"
        className="size-[18px] text-[8px]"
      />
      <span className="truncate">{card.ownerName}</span>
    </span>
  );
}

/** "Hot" / "Warm" chips. */
function Heat({ card }: { card: BoardCard }) {
  if (card.hot)
    return (
      <span className="rounded-full bg-bad-soft px-1.5 text-[10px] font-extrabold text-bad">
        Hot
      </span>
    );
  if (card.warm)
    return (
      <span className="rounded-full bg-warn-soft px-1.5 text-[10px] font-extrabold text-warn-ink">
        Warm
      </span>
    );
  return null;
}

function DesktopCard({ card, ctx }: { card: BoardCard; ctx: CardCtx }) {
  const dragging = ctx.drag?.personId === card.personId;
  const mine = ctx.isMine(card.ownerId);
  const next = nextStepText(card.nextStep, card.nextStepDate);
  return (
    <div
      onPointerDown={(e) => ctx.start(e, card)}
      onClick={() => ctx.open(card.personId)}
      className={cn(
        "group relative grid min-w-0 cursor-grab touch-manipulation select-none gap-1.5 rounded-[10px] border bg-surface px-2.5 py-2 text-xs transition-colors hover:border-primary/40 [-webkit-touch-callout:none]",
        card.stale ? "border-amber" : "border-line",
        mine && MINE_ACCENT,
        card.dim && "opacity-70",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-baseline justify-between gap-1.5 pr-5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            ctx.open(card.personId);
          }}
          className="min-w-0 truncate rounded-sm text-left text-[12.5px] font-bold focus-visible:outline-2 focus-visible:outline-ring"
        >
          {card.name}
        </button>
        <span className="whitespace-nowrap text-[10.5px] text-faint">
          {card.listed
            ? "list"
            : card.dim
              ? format(new Date(card.enteredAt), "MMM d")
              : ageShort(card.days)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <OwnerTag card={card} mine={mine} />
        <Heat card={card} />
        {card.source && <span className="truncate">{card.source}</span>}
      </div>
      {card.elsewhere && (
        <div className="text-[10.5px] text-muted-foreground">
          At {card.elsewhere.ownerName}&rsquo;s step: {card.elsewhere.label}
        </div>
      )}
      {card.stale ? (
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-warn-ink">
          <ClockAlert className="size-3.5 shrink-0" aria-hidden="true" />
          No movement in {ageLong(card.days)}
        </div>
      ) : (
        next && (
          <div
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-[11px] font-semibold",
              overdue(card.nextStepDate) ? "text-warn-ink" : "text-primary-ink",
            )}
          >
            <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{next}</span>
          </div>
        )
      )}
      <span data-no-drag className="absolute right-1 top-1" onClick={stop} onPointerDown={stop}>
        <MoveMenu
          columns={ctx.columns}
          bands={ctx.def.bands}
          current={card.column}
          onMove={(to) => ctx.move(card.personId, card.name, to)}
        >
          <button
            type="button"
            aria-label={`Move ${card.name} to…`}
            onClick={(e) => e.stopPropagation()}
            className="grid size-6 place-items-center rounded-md text-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </MoveMenu>
      </span>
    </div>
  );
}

function RegisteredList({
  registered,
  isMine,
}: {
  registered: PipelineBoard<string>["registered"];
  isMine: CardCtx["isMine"];
}) {
  const navigate = useNavigate();
  const [all, setAll] = useState(false);
  const shown = all ? registered.cards : registered.cards.slice(0, SHOW);
  const others = registered.total - registered.cards.length;
  return (
    <>
      {shown.map((r) => (
        <RegisteredCardView
          key={r.personId}
          r={r}
          mine={isMine(r.ownerId)}
          onOpen={() => navigate({ to: "/people/$id", params: { id: r.personId } })}
        />
      ))}
      {registered.cards.length > SHOW && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="rounded-sm py-0.5 text-center text-[11.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {all ? "Show less" : `+${registered.cards.length - SHOW} more`}
        </button>
      )}
      {others > 0 && (
        <p className="text-center text-[11px] text-muted-foreground">
          +{others} no longer on your list
        </p>
      )}
      {registered.total === 0 && (
        <p className="rounded-[10px] border border-dashed border-line px-2 py-3 text-center text-[11px] text-faint">
          No registrations yet
        </p>
      )}
    </>
  );
}

function RegisteredCardView({
  r,
  mine,
  onOpen,
}: {
  r: RegisteredCard;
  mine: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "grid gap-1.5 rounded-[10px] border border-line bg-surface px-2.5 py-2 text-left text-xs hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-ring",
        mine && MINE_ACCENT,
      )}
    >
      <span className="flex items-baseline justify-between gap-1.5">
        <b className="truncate text-[12.5px]">{r.name}</b>
        <span className="whitespace-nowrap text-[10.5px] text-faint">{shortDate(r.day)}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <OwnerTag card={r} mine={mine} />
        <span className="rounded-full bg-stage-apprentice-soft px-1.5 text-[10px] font-bold text-stage-apprentice-ink">
          Apprentice
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

function PhoneColumn({
  band,
  col,
  month,
  isThisMonth,
  registered,
  ctx,
}: {
  band: string;
  col: BoardColumn<string>;
  month: string;
  isThisMonth: boolean;
  registered: PipelineBoard<string>["registered"];
  ctx: CardCtx;
}) {
  const navigate = useNavigate();
  const c = col.column;
  const isReg = isRegisteredList(ctx.def, c);
  const over = ctx.drag?.over === c.id && ctx.drag.from !== c.id;
  const count = isReg ? registered.total : col.cards.length;
  const yours = (isReg ? registered.cards : col.cards).filter((x) => ctx.isMine(x.ownerId)).length;
  return (
    <section
      data-drop-column={c.id}
      aria-label={`${c.label}, ${count}`}
      className={cn(
        "grid w-[84%] flex-none snap-start content-start rounded-xl border border-line bg-surface px-3 py-2.5",
        over && "ring-2 ring-sky",
      )}
    >
      <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-faint">
        {bandLabel(ctx.def, band)}
      </div>
      <div className="flex items-center gap-1.5 pb-1 pt-0.5 text-sm">
        {c.kind === "milestone" && (
          <Flag className="size-3.5 shrink-0 text-amber-strong" aria-label="Milestone" />
        )}
        <b className="truncate">{c.label}</b>
        <span
          className={cn(
            "ml-auto rounded-full px-2 text-xs font-extrabold leading-5 tabular-nums",
            isWon(ctx.def, c) ? "bg-good-soft text-good" : "bg-surface-2",
          )}
        >
          {count}
        </span>
      </div>
      <div className="pb-1.5 text-[11px] text-muted-foreground">
        {c.kind === "step"
          ? stepBy(c)
          : c.kind === "fixed"
            ? c.hint
            : col.reached !== null
              ? reachedText(c.band, col.reached, month, isThisMonth)
              : ""}
        {ctx.markMine && <YoursCount n={yours} />}
      </div>
      {isReg ? (
        registered.cards.map((r) => (
          <button
            key={r.personId}
            type="button"
            onClick={() => navigate({ to: "/people/$id", params: { id: r.personId } })}
            className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5 border-t border-line py-2.5 text-left text-[12.5px] first-of-type:border-t-0"
          >
            <PersonAvatar name={r.name} stage="apprentice" />
            <span className="min-w-0">
              <b className="block truncate">{r.name}</b>
              <span className="text-[11px] text-muted-foreground">
                <Whose ownerName={r.ownerName} mine={ctx.isMine(r.ownerId)}>
                  registered {shortDate(r.day)}
                </Whose>
              </span>
            </span>
          </button>
        ))
      ) : (
        <>
          {col.cards.map((card) => (
            <PhoneRow key={card.personId} card={card} ctx={ctx} />
          ))}
          {col.cards.length === 0 && (
            <p className="py-4 text-center text-[12px] text-faint">
              {ctx.drag ? "Drop here" : "Nobody here"}
            </p>
          )}
        </>
      )}
      {isReg && registered.total > registered.cards.length && (
        <p className="pt-1 text-[11px] text-muted-foreground">
          +{registered.total - registered.cards.length} no longer on your list
        </p>
      )}
    </section>
  );
}

function PhoneRow({ card, ctx }: { card: BoardCard; ctx: CardCtx }) {
  const dragging = ctx.drag?.personId === card.personId;
  const next = nextStepText(card.nextStep, card.nextStepDate);
  const mine = ctx.isMine(card.ownerId);
  const sub = [card.listed ? (card.source ?? "") : ageLong(card.days)];
  if (!card.listed && card.source && ctx.def.kind === "customer") sub.push(card.source);
  if (!card.stale && next) sub.push(next.charAt(0).toLowerCase() + next.slice(1));
  return (
    <div
      onPointerDown={(e) => ctx.start(e, card)}
      onClick={() => ctx.open(card.personId)}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "grid select-none grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-line py-2 text-[12.5px] [-webkit-touch-callout:none] first-of-type:border-t-0",
        card.dim && "opacity-70",
        dragging && "opacity-40",
      )}
    >
      <PersonAvatar name={card.name} stage="prospect" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              ctx.open(card.personId);
            }}
            className="min-w-0 truncate rounded-sm text-left font-bold focus-visible:outline-2 focus-visible:outline-ring"
          >
            {card.name}
          </button>
          <Heat card={card} />
        </div>
        <div
          className={cn(
            "truncate text-[11px]",
            card.stale ? "font-semibold text-warn-ink" : "text-muted-foreground",
          )}
        >
          <Whose ownerName={card.ownerName} mine={mine}>
            {card.stale ? `no movement in ${ageLong(card.days)}` : sub.filter(Boolean).join(" · ")}
          </Whose>
        </div>
      </div>
      <span data-no-drag onClick={stop} onPointerDown={stop}>
        <MoveMenu
          columns={ctx.columns}
          bands={ctx.def.bands}
          current={card.column}
          onMove={(to) => ctx.move(card.personId, card.name, to)}
        >
          <button
            type="button"
            aria-label={`Move ${card.name} to…`}
            onClick={(e) => e.stopPropagation()}
            className="-mr-1 grid size-9 place-items-center rounded-lg text-faint focus-visible:outline-2 focus-visible:outline-ring"
          >
            <GripVertical className="size-4" />
          </button>
        </MoveMenu>
      </span>
    </div>
  );
}

/** Phone sub-lines: "Yours · …" on a mixed board, otherwise "Maria's · …". */
function Whose({
  ownerName,
  mine,
  children,
}: {
  ownerName: string;
  mine: boolean;
  children: ReactNode;
}) {
  const who = mine ? (
    <b className="font-bold text-primary-ink">Yours</b>
  ) : ownerName ? (
    <>{ownerName}&rsquo;s</>
  ) : null;
  if (!who) return <>{children}</>;
  return (
    <>
      {who}
      {children ? " · " : null}
      {children}
    </>
  );
}

function DragGhost({ drag }: { drag: DragInfo }) {
  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-[60] max-w-[200px] -translate-x-1/2 -translate-y-[120%] truncate rounded-[10px] border border-sky bg-surface px-3 py-2 text-[12.5px] font-bold shadow-lg"
      style={{ left: drag.x, top: drag.y }}
    >
      {drag.name}
    </div>,
    document.body,
  );
}
