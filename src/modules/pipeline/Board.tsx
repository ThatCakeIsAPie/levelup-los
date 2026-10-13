import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { CalendarClock, ClockAlert, Flag, GripVertical, MoreHorizontal } from "lucide-react";
import { PersonAvatar, useIsDesktop } from "@/components/brand";
import { cn } from "@/lib/utils";
import {
  MILESTONE_LABEL,
  monthName,
  monthOf,
  localDate,
  type BoardBand,
  type BoardCard,
  type BoardColumn,
  type MilestoneCode,
  type PipelineBoard,
  type RegisteredCard,
} from "@/data";
import { CardSheet } from "./CardSheet";
import { MoveMenu } from "./moveCard";
import { useMoveCard } from "./useMoveCard";
import { useBoardDrag, type DragInfo } from "./useBoardDrag";
import { ageLong, ageShort, nextStepText, overdue, shortDate, stepBy } from "./format";

const SHOW = 5;

/** Menus render in a portal, but React events still bubble to the card: stop them here. */
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * The board: four bands (one per milestone), each with its milestone column
 * and the leader steps after it. Desktop: bands side by side, scrolling
 * sideways when wider than the screen; drag a card (or use its "Move to…"
 * menu). Phones: one full column at a time with the next one peeking in;
 * hold a card to drag it, or tap the grip for "Move to…".
 */
export function Board({ board, month }: { board: PipelineBoard; month: string }) {
  const desktop = useIsDesktop();
  const scroller = useRef<HTMLDivElement>(null);
  const { move, dialog } = useMoveCard(board.columns);
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
  const ctx: CardCtx = { columns: board.columns, drag, start, open, move };
  const isThisMonth = monthOf(localDate()) === month;

  return (
    <>
      {desktop ? (
        <div ref={scroller} className="overflow-x-auto pb-2" aria-label="Pipeline board">
          <div className="flex w-max items-start gap-3.5">
            {board.bands.map((band, i) => (
              <DesktopBand
                key={band.milestone}
                band={band}
                index={i}
                month={month}
                isThisMonth={isThisMonth}
                registered={board.registered}
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
            aria-label="Pipeline board"
            className="-mx-4 flex snap-x snap-mandatory scroll-px-4 items-start gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {board.bands.flatMap((band) =>
              band.columns.map((col) => (
                <PhoneColumn
                  key={col.column.id}
                  band={band.milestone}
                  col={col}
                  month={month}
                  isThisMonth={isThisMonth}
                  registered={board.registered}
                  ctx={ctx}
                />
              )),
            )}
          </div>
        </div>
      )}
      {drag && <DragGhost drag={drag} />}
      <CardSheet
        card={openId ? (cards.get(openId) ?? null) : null}
        columns={board.columns}
        open={sheetOpen && !!openId && cards.has(openId)}
        onOpenChange={setSheetOpen}
        onMove={move}
      />
      {dialog}
    </>
  );
}

interface CardCtx {
  columns: PipelineBoard["columns"];
  drag: DragInfo | null;
  start: ReturnType<typeof useBoardDrag>["start"];
  open: (personId: string) => void;
  move: (personId: string, name: string, to: string) => void;
}

function reachedText(m: MilestoneCode, n: number, month: string, isThisMonth: boolean) {
  const when = isThisMonth ? "this month" : `in ${monthName(month, "short")}`;
  if (m === "first_meeting") return `${n} held ${when}`;
  if (m === "registered") return when;
  return `${n} ${when}`;
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

function DesktopBand({
  band,
  index,
  month,
  isThisMonth,
  registered,
  ctx,
}: {
  band: BoardBand;
  index: number;
  month: string;
  isThisMonth: boolean;
  registered: PipelineBoard["registered"];
  ctx: CardCtx;
}) {
  const m = band.milestone;
  return (
    <section className="grid gap-2" aria-label={`${MILESTONE_LABEL[m]} band`}>
      <header className="flex items-center gap-2 px-0.5 text-[12.5px]">
        <span className="grid size-5 place-items-center rounded-md bg-foreground text-[11px] font-extrabold text-background">
          {index + 1}
        </span>
        <b>{MILESTONE_LABEL[m]}</b>
        <span className="text-[11.5px] text-muted-foreground">
          {m === "registered"
            ? `${band.count} ${isThisMonth ? "this month" : `in ${monthName(month, "short")}`}`
            : `${band.count} in this band`}
        </span>
      </header>
      <div className="flex items-start gap-2 rounded-2xl bg-surface-2 p-2">
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
}: {
  col: BoardColumn;
  count: number;
  month: string;
  isThisMonth: boolean;
}) {
  const c = col.column;
  const won = c.id === "registered";
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
      {col.reached !== null && c.id !== "registered" && (
        <span className="col-span-2 text-[11px] text-muted-foreground">
          {reachedText(c.band, col.reached, month, isThisMonth)}
        </span>
      )}
      {won && (
        <span className="col-span-2 text-[11px] text-muted-foreground">
          {isThisMonth ? "this month" : `in ${monthName(month)}`}
        </span>
      )}
      {c.kind === "milestone" ? (
        <span className="col-span-2 inline-flex items-center gap-1 text-[10.5px] font-bold">
          <Flag className="size-3 text-amber-strong" aria-hidden="true" /> Milestone
        </span>
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
  col: BoardColumn;
  month: string;
  isThisMonth: boolean;
  registered: PipelineBoard["registered"];
  ctx: CardCtx;
}) {
  const [all, setAll] = useState(false);
  const c = col.column;
  const isReg = c.id === "registered";
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
      />
      {isReg ? (
        <RegisteredList registered={registered} />
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

function OwnerTag({ card }: { card: { ownerName: string; ownerStage?: BoardCard["ownerStage"] } }) {
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

function DesktopCard({ card, ctx }: { card: BoardCard; ctx: CardCtx }) {
  const dragging = ctx.drag?.personId === card.personId;
  const next = nextStepText(card.nextStep, card.nextStepDate);
  return (
    <div
      onPointerDown={(e) => ctx.start(e, card)}
      onClick={() => ctx.open(card.personId)}
      className={cn(
        "group relative grid min-w-0 cursor-grab touch-manipulation select-none gap-1.5 rounded-[10px] border bg-surface px-2.5 py-2 text-xs transition-colors hover:border-primary/40 [-webkit-touch-callout:none]",
        card.stale ? "border-amber" : "border-line",
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
        <span className="whitespace-nowrap text-[10.5px] text-faint">{ageShort(card.days)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <OwnerTag card={card} />
        {card.hot && (
          <span className="rounded-full bg-bad-soft px-1.5 text-[10px] font-extrabold text-bad">
            Hot
          </span>
        )}
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

function RegisteredList({ registered }: { registered: PipelineBoard["registered"] }) {
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

function RegisteredCardView({ r, onOpen }: { r: RegisteredCard; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid gap-1.5 rounded-[10px] border border-line bg-surface px-2.5 py-2 text-left text-xs hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex items-baseline justify-between gap-1.5">
        <b className="truncate text-[12.5px]">{r.name}</b>
        <span className="whitespace-nowrap text-[10.5px] text-faint">{shortDate(r.day)}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <OwnerTag card={r} />
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
  band: MilestoneCode;
  col: BoardColumn;
  month: string;
  isThisMonth: boolean;
  registered: PipelineBoard["registered"];
  ctx: CardCtx;
}) {
  const navigate = useNavigate();
  const c = col.column;
  const isReg = c.id === "registered";
  const over = ctx.drag?.over === c.id && ctx.drag.from !== c.id;
  const count = isReg ? registered.total : col.cards.length;
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
        {MILESTONE_LABEL[band]}
      </div>
      <div className="flex items-center gap-1.5 pb-1 pt-0.5 text-sm">
        {c.kind === "milestone" && (
          <Flag className="size-3.5 shrink-0 text-amber-strong" aria-label="Milestone" />
        )}
        <b className="truncate">{c.label}</b>
        <span
          className={cn(
            "ml-auto rounded-full px-2 text-xs font-extrabold leading-5 tabular-nums",
            isReg ? "bg-good-soft text-good" : "bg-surface-2",
          )}
        >
          {count}
        </span>
      </div>
      <div className="pb-1.5 text-[11px] text-muted-foreground">
        {c.kind === "step"
          ? stepBy(c)
          : col.reached !== null
            ? reachedText(c.band, col.reached, month, isThisMonth)
            : ""}
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
                {r.ownerName ? `${r.ownerName}'s · ` : ""}registered {shortDate(r.day)}
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
  const sub = [card.ownerName ? `${card.ownerName}'s` : "", ageLong(card.days)];
  if (!card.stale && next) sub.push(next.charAt(0).toLowerCase() + next.slice(1));
  return (
    <div
      onPointerDown={(e) => ctx.start(e, card)}
      onClick={() => ctx.open(card.personId)}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "grid select-none grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-line py-2 text-[12.5px] [-webkit-touch-callout:none] first-of-type:border-t-0",
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
          {card.hot && (
            <span className="rounded-full bg-bad-soft px-1.5 text-[10px] font-extrabold text-bad">
              Hot
            </span>
          )}
        </div>
        <div
          className={cn(
            "truncate text-[11px]",
            card.stale ? "font-semibold text-warn-ink" : "text-muted-foreground",
          )}
        >
          {card.stale
            ? `${card.ownerName}'s · no movement in ${ageLong(card.days)}`
            : sub.filter(Boolean).join(" · ")}
        </div>
      </div>
      <span data-no-drag onClick={stop} onPointerDown={stop}>
        <MoveMenu
          columns={ctx.columns}
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
