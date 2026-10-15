/**
 * A text field with a dropdown of titles logged before (the Learning form's
 * Book / Title). Typing filters the list; when the text matches nothing logged
 * before, the last row adds it as a new entry. Follows the ARIA combobox
 * pattern: arrows move through the list, Enter picks, Escape closes.
 */
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseDate } from "@/data";
import { filterTitles, matchTitle, type TitleSuggestion } from "./titleSuggestions";

type Row = { kind: "past"; item: TitleSuggestion } | { kind: "new"; title: string };

export function TitleCombobox({
  id,
  value,
  onChange,
  titles,
  placeholder,
  noun,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** Titles logged before, most recent first. */
  titles: TitleSuggestion[];
  placeholder?: string;
  /** What one entry is called, e.g. "book". */
  noun: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const rows = useMemo<Row[]>(() => {
    const past: Row[] = filterTitles(titles, value).map((item) => ({ kind: "past", item }));
    const typed = value.trim();
    return typed && !matchTitle(titles, typed) ? [...past, { kind: "new", title: typed }] : past;
  }, [titles, value]);
  const shown = open && rows.length > 0;

  const show = () => {
    setOpen(true);
    setActive(-1);
  };
  const pick = (row: Row) => {
    onChange(row.kind === "past" ? row.item.title : row.title);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown) return show();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + rows.length) % rows.length);
    } else if (e.key === "Enter" && shown && active >= 0) {
      e.preventDefault();
      pick(rows[active]);
    } else if (e.key === "Escape" && shown) {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        className="pr-9"
        onChange={(e) => {
          onChange(e.target.value);
          show();
        }}
        onFocus={show}
        onClick={show}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {titles.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Show past ${noun}s`}
          // Keep focus in the field so the list doesn't close on blur.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (shown ? setOpen(false) : show())}
          className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform", shown && "rotate-180")} />
        </button>
      )}
      {shown && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`Past ${noun}s`}
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-line bg-popover p-1 text-popover-foreground shadow-md"
        >
          {rows.map((row, i) => [
            row.kind === "new" && i > 0 && (
              <li key="sep" role="presentation" className="mx-1 my-1 h-px bg-line" />
            ),
            <li
              key={row.kind === "past" ? row.item.title : "new"}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(row)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px]",
                i === active && "bg-surface-2",
              )}
            >
              {row.kind === "past" ? (
                <>
                  <span className="min-w-0 flex-1 truncate font-semibold">{row.item.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {format(parseDate(row.item.lastDate), "MMM d")}
                  </span>
                </>
              ) : (
                <>
                  <Plus className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">
                    New {noun}: <span className="font-semibold">{row.title}</span>
                  </span>
                </>
              )}
            </li>,
          ])}
        </ul>
      )}
    </div>
  );
}
