import { useEffect, useRef } from "react";
import type { PublicTableState } from "@common/protocol";
import { sound } from "./sound";

// Plays sounds on meaningful state transitions: new deal, your turn, and your
// wins. Driven entirely off the redacted snapshot.
export function useSound(state: PublicTableState | null) {
  const prev = useRef<{ hand: number; toAct: number | null; pot: number; phase: string } | null>(null);

  useEffect(() => {
    if (!state) return;
    const p = prev.current;
    const mySeat = state.yourSeat;

    if (p) {
      if (state.handNumber > p.hand) sound.deal();
      if (mySeat !== null && state.toActSeat === mySeat && p.toAct !== mySeat) sound.yourTurn();
      if (state.totalPot > p.pot && state.phase === "hand") sound.bet();
      if (state.phase === "showdown" && p.phase !== "showdown" && mySeat !== null) {
        const me = state.seats[mySeat];
        if (me && me.winner && me.wonAmount > 0) sound.win();
      }
    }
    prev.current = {
      hand: state.handNumber,
      toAct: state.toActSeat,
      pot: state.totalPot,
      phase: state.phase,
    };
  }, [state]);
}
