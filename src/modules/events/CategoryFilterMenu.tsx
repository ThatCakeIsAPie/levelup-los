import { ChevronDown, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EventCategory } from "@/data";
import { categoryIcon } from "./categoryIcons";

const ALL = "all";

/**
 * The events page's one filter button: "Filter", or the chosen category's icon and name; it opens a
 * menu of "All" and each category (one at a time). The choice itself lives in the page's URL.
 */
export function CategoryFilterMenu({
  categories,
  selected,
  onChoose,
}: {
  categories: EventCategory[];
  selected: EventCategory | undefined;
  /** Called with a category id, or undefined for "All". */
  onChoose: (id: string | undefined) => void;
}) {
  const Icon = selected ? categoryIcon(selected) : ListFilter;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-[11rem] min-w-0 sm:max-w-[16rem]"
          aria-label={selected ? `Filter: ${selected.name}` : undefined}
        >
          <Icon aria-hidden="true" />
          <span className="truncate">{selected ? selected.name : "Filter"}</span>
          <ChevronDown className="!size-3.5 max-sm:hidden" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuRadioGroup
          value={selected?.id ?? ALL}
          onValueChange={(v) => onChoose(v === ALL ? undefined : v)}
        >
          <DropdownMenuRadioItem value={ALL}>All</DropdownMenuRadioItem>
          {categories.map((c) => {
            const CategoryIcon = categoryIcon(c);
            return (
              <DropdownMenuRadioItem key={c.id} value={c.id}>
                <CategoryIcon
                  className="mr-2 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                {c.name}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
