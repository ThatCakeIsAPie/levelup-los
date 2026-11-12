import { Send } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { CrmPerson } from "@/data";
import { openInviteDialog } from "./inviteDialogStore";
import { usePersonSignIn } from "./personInvites";

/**
 * "Invite to sign in" in a people list row's menu. The menu content only
 * exists while the menu is open, so the (one database read) check runs then.
 */
export function RowInviteItem({ person }: { person: CrmPerson }) {
  const { eligible, invite } = usePersonSignIn(person);
  if (!eligible) return null;
  return (
    <DropdownMenuItem onSelect={() => openInviteDialog(person.id)}>
      <Send /> {invite ? "Send sign-in invite again" : "Invite to sign in"}
    </DropdownMenuItem>
  );
}
