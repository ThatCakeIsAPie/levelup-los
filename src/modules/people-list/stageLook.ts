import {
  PERSON_TYPE_CHIP_CLASS,
  PERSON_TYPE_SOLID_CLASS,
  STAGE_CHIP_CLASS,
  STAGE_LABEL,
  STAGE_SOLID_CLASS,
} from "@/components/brand";
import type { StageChipLook } from "@/components/filters/StageFilterChips";
import { PERSON_TYPE_LABEL } from "@/data";
import type { StageKey } from "./model";

/** Words, fill and dot of each stage filter chip (the three types, then apprentice and IBO). */
export function stageChipLook(s: StageKey): StageChipLook {
  if (s === "contact" || s === "prospect" || s === "filtered")
    return {
      label: PERSON_TYPE_LABEL[s],
      chip: PERSON_TYPE_CHIP_CLASS[s],
      dot: PERSON_TYPE_SOLID_CLASS[s],
    };
  return { label: STAGE_LABEL[s], chip: STAGE_CHIP_CLASS[s], dot: STAGE_SOLID_CLASS[s] };
}
