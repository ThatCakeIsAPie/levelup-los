/**
 * Which person-invite dialog is open (one at a time, rendered by `InviteHost`
 * in the app shell). Opened from the profile card, the people list menu and
 * after a card is moved into Registered, so it survives the page that asked.
 */
import { create } from "zustand";

export interface InviteRequest {
  personId: string;
  /** "invite": from a profile or menu. "congrats": right after registering them. */
  mode: "invite" | "congrats";
  /** Changes on every opening so the form starts fresh. */
  seq: number;
}

interface State {
  request: InviteRequest | null;
}

let seq = 0;

export const useInviteDialogStore = create<State>()(() => ({ request: null }));

export function openInviteDialog(personId: string, mode: InviteRequest["mode"] = "invite"): void {
  useInviteDialogStore.setState({ request: { personId, mode, seq: ++seq } });
}

export function closeInviteDialog(personId?: string): void {
  const { request } = useInviteDialogStore.getState();
  if (request && (!personId || request.personId === personId)) {
    useInviteDialogStore.setState({ request: null });
  }
}
