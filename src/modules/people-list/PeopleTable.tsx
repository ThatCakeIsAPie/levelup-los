import { Link } from "@tanstack/react-router";
import { PersonAvatar, StageChip } from "@/components/brand";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ContactText, FlagChips, ShowRateText, UplineLink } from "./cells";
import { shortDate, type PersonRow, type Segment } from "./model";
import { RowActions } from "./RowActions";

const TH =
  "h-9 whitespace-nowrap px-3 text-left align-middle text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground first:pl-4 sm:first:pl-[18px]";
const TD = "px-3 py-2.5 align-middle first:pl-4 sm:first:pl-[18px]";
export const CHECKBOX_FOCUS = "size-[18px] focus-visible:ring-2 focus-visible:ring-offset-2";

/** Desktop table (≥ 1024px). Sits flush inside a SectionCard. */
export function PeopleTable({
  rows,
  segment,
  viewerId,
  selected,
  onToggle,
  onToggleAll,
}: {
  rows: PersonRow[];
  segment: Segment;
  viewerId: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  const customers = segment === "customers";
  const selectable = rows.filter((r) => !r.isSelf);
  const selCount = selectable.filter((r) => selected.has(r.person.id)).length;
  const allState =
    selCount === 0 ? false : selCount === selectable.length ? true : ("indeterminate" as const);

  return (
    <div className="-mx-4 -mb-4 overflow-x-auto sm:-mx-[18px]">
      <table className="w-full min-w-[860px] border-collapse text-[13px]">
        <thead>
          <tr className="border-y border-line bg-surface-2/60">
            <th className={cn(TH, "w-10")}>
              <Checkbox
                checked={allState}
                onCheckedChange={onToggleAll}
                disabled={selectable.length === 0}
                aria-label={allState === true ? "Clear selection" : "Select everyone in this list"}
                className={CHECKBOX_FOCUS}
              />
            </th>
            <th className={TH}>{customers ? "Customer" : "Person"}</th>
            <th className={TH}>{customers ? "Owner · volume" : "Sponsor"}</th>
            <th className={TH}>Last contact</th>
            <th className={TH}>{customers ? "Last purchase" : "Show rate"}</th>
            <th className={TH}>Flags</th>
            <th className={cn(TH, "text-right")}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = r.person;
            const checked = selected.has(p.id);
            const sub = customers
              ? [p.location, p.email].filter(Boolean).join(" · ")
              : [p.location, p.iboNumber].filter(Boolean).join(" · ");
            return (
              <tr
                key={p.id}
                data-state={checked ? "selected" : undefined}
                className="border-b border-line transition-colors last:border-b-0 hover:bg-surface-2/60 data-[state=selected]:bg-primary-soft/50"
              >
                <td className={TD}>
                  {!r.isSelf && (
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => onToggle(p.id)}
                      aria-label={`Select ${p.name}`}
                      className={CHECKBOX_FOCUS}
                    />
                  )}
                </td>
                <td className={cn(TD, "max-w-[320px]")}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <PersonAvatar name={p.name} stage={r.stage} />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <Link
                          to="/people/$id"
                          params={{ id: p.id }}
                          className="truncate rounded-sm font-semibold hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {p.name}
                        </Link>
                        <StageChip stage={r.stage} />
                        {r.isSelf && (
                          <span className="text-[11px] font-semibold text-muted-foreground">
                            You
                          </span>
                        )}
                      </div>
                      {sub && (
                        <div className="truncate text-[11.5px] text-muted-foreground">{sub}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className={cn(TD, "whitespace-nowrap text-[12.5px]")}>
                  {customers ? (
                    <span className="grid leading-tight">
                      <UplineLink row={r} viewerId={viewerId} />
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {p.monthlyVolume ? `${p.monthlyVolume} PV a month` : "No volume yet"}
                      </span>
                    </span>
                  ) : (
                    <UplineLink row={r} viewerId={viewerId} />
                  )}
                </td>
                <td className={TD}>
                  <ContactText row={r} />
                </td>
                <td className={TD}>
                  {customers ? (
                    r.lastSale ? (
                      <span className="grid max-w-[180px] leading-tight">
                        <span className="truncate text-[12.5px] font-medium">
                          {r.lastSale.product}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {shortDate(r.lastSale.date)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[12.5px] text-faint">None yet</span>
                    )
                  ) : (
                    <ShowRateText row={r} />
                  )}
                </td>
                <td className={cn(TD, "max-w-[240px]")}>
                  <FlagChips row={r} />
                </td>
                <td className={cn(TD, "pr-4 sm:pr-[18px]")}>
                  <RowActions row={r} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
