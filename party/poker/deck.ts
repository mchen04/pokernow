// Server-side deck and crypto-strong shuffle. This lives only on the server —
// the client never sees the deck order or undealt cards.

import type { Card } from "../../common/cards";
import { makeDeck } from "../../common/cards";

// Uniform random integer in [0, range) using crypto, with rejection sampling
// to avoid modulo bias. `crypto` is a global in the PartyKit/Workers runtime.
function secureRandomInt(range: number): number {
  if (range <= 0) throw new Error("range must be positive");
  if (range === 1) return 0;
  const MAX = 2 ** 32;
  const limit = MAX - (MAX % range);
  const buf = new Uint32Array(1);
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % range;
}

// Fisher–Yates shuffle with a crypto-strong RNG. Returns a new array.
export function shuffle<T>(input: readonly T[]): T[] {
  const a = input.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

export function freshShuffledDeck(): Card[] {
  return shuffle(makeDeck());
}

export { secureRandomInt };
