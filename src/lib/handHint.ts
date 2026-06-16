import type { PublicTableState } from "@common/protocol";
import { evaluateBest, evaluateOmaha } from "@common/evaluator";
import { isOmaha } from "@common/config";
import { rankChar } from "@common/cards";

// Plain-English label of the hero's CURRENT holding, for the beginner "you have…"
// hint. Preflop it describes the starting hand; flop onward it names the best
// made hand only when there is a single board to evaluate.
export function heroHandLabel(state: PublicTableState): string | null {
  const seat = state.yourSeat !== null ? state.seats[state.yourSeat] : null;
  const hole = seat?.holeCards;
  const board = state.boards[0] ?? [];
  if (!hole || hole.length === 0 || seat?.folded) return null;

  if (board.length < 3) {
    if (hole.length !== 2) return null;
    const [a, b] = hole;
    if (a.rank === b.rank) return `a Pair of ${rankChar(a.rank)}s`;
    const hi = a.rank >= b.rank ? a : b;
    const lo = a.rank >= b.rank ? b : a;
    return `${rankChar(hi.rank)}-${rankChar(lo.rank)}${a.suit === b.suit ? " suited" : ""}`;
  }

  if (state.boards.length !== 1) return null;
  if (isOmaha(state.variant) && hole.length < 2) return null;
  if (!isOmaha(state.variant) && hole.length + board.length < 5) return null;

  const score = isOmaha(state.variant) ? evaluateOmaha(hole, board) : evaluateBest([...hole, ...board]);
  return score.label;
}
