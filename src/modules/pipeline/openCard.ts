/**
 * "Open the card" from somewhere else in the app (Home's Today card): the page the board is on
 * opens, and its board opens that card's panel as soon as the card is on it. A request is only good
 * for a few seconds, so a card that is not on the board (another scope) never opens by surprise
 * later.
 */
import { useEffect } from "react";
import { create } from "zustand";
import type { CardRef } from "@/data";

const GOOD_FOR_MS = 5000;

interface State {
  request: (CardRef & { at: number }) | null;
}

const useRequest = create<State>()(() => ({ request: null }));

/** Ask the board a card is on to open its panel. */
export function requestOpenCard(card: CardRef): void {
  useRequest.setState({ request: { ...card, at: Date.now() } });
}

/** A board calls this: `open` runs once for a request for a card it has (`has`). */
export function useOpenCardRequest(
  board: CardRef["board"],
  has: (id: string) => boolean,
  open: (id: string) => void,
): void {
  const request = useRequest((s) => s.request);
  useEffect(() => {
    if (!request || request.board !== board) return;
    if (Date.now() - request.at > GOOD_FOR_MS) {
      useRequest.setState({ request: null });
      return;
    }
    if (!has(request.id)) return;
    useRequest.setState({ request: null });
    open(request.id);
  });
}
