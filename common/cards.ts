// Shared card model — used by both the authoritative server engine and the
// client renderer. The server owns the deck and shuffle; the client only ever
// receives cards it is entitled to see.

export type Suit = "c" | "d" | "h" | "s";
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  rank: Rank; // 2..10, 11=J, 12=Q, 13=K, 14=A
  suit: Suit;
}

export const SUITS: Suit[] = ["c", "d", "h", "s"];
export const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const RANK_CHARS: Record<Rank, string> = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "T",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

const CHAR_RANKS: Record<string, Rank> = Object.fromEntries(
  Object.entries(RANK_CHARS).map(([r, c]) => [c, Number(r) as Rank])
) as Record<string, Rank>;

export function rankChar(rank: Rank): string {
  return RANK_CHARS[rank];
}

export function cardCode(card: Card): string {
  return RANK_CHARS[card.rank] + card.suit;
}

export function parseCard(code: string): Card {
  const rank = CHAR_RANKS[code[0]];
  const suit = code[1] as Suit;
  if (rank === undefined || !SUITS.includes(suit)) {
    throw new Error(`Invalid card code: ${code}`);
  }
  return { rank, suit };
}

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export const SUIT_SYMBOL: Record<Suit, string> = {
  c: "♣", // ♣
  d: "♦", // ♦
  h: "♥", // ♥
  s: "♠", // ♠
};

export const SUIT_NAME: Record<Suit, string> = {
  c: "clubs",
  d: "diamonds",
  h: "hearts",
  s: "spades",
};
