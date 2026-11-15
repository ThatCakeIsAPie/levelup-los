import type { CardRef } from "@/data";
import { CardNotes } from "./CardNotes";
import { CardTasks } from "./CardTasks";

/** A card's Tasks and Notes, the two sections every card panel and the profile's pipeline card share. */
export function CardFollowups({ card }: { card: CardRef }) {
  return (
    <div className="grid gap-4">
      <CardTasks card={card} />
      <CardNotes card={card} />
    </div>
  );
}
