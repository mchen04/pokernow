// Poker hand evaluator. Pure, deterministic, no secrets — safe to share with
// the client for strength hints, though the server remains the authority for
// showdown results.
//
// A hand is scored as a comparable tuple `number[]`: the first element is the
// category (0=high card .. 8=straight flush) and the rest are tiebreak kickers,
// each in 2..14. Compare two tuples lexicographically; bigger is better.

import type { Card, Rank } from "./cards";
import { rankChar } from "./cards";

export interface HandScore {
  tuple: number[];
  category: HandCategory;
  label: string;
}

export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export function compareScore(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// Detect a straight from a set of distinct ranks (already sorted desc).
// Returns the high card of the straight, or 0 if none. Handles the wheel
// (A-2-3-4-5) where the ace plays low and the straight is 5-high.
function straightHigh(distinctDesc: number[]): number {
  // distinctDesc is distinct and already sorted descending. The ace also plays
  // low (the A-2-3-4-5 wheel), so treat a present 14 as an extra 1 at the tail.
  const sorted = distinctDesc[0] === 14 ? [...distinctDesc, 1] : distinctDesc;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] - 1) {
      run++;
      if (run >= 5) return sorted[i - 4]; // high card of the 5-run
    } else if (sorted[i] !== sorted[i - 1]) {
      run = 1;
    }
  }
  return 0;
}

function categoryLabel(category: HandCategory, tiebreak: number[]): string {
  const name = (r: number) => rankChar(r as Rank);
  const plural = (r: number) => name(r) + "s";
  switch (category) {
    case HandCategory.StraightFlush:
      return tiebreak[0] === 14 ? "Royal Flush" : `Straight Flush, ${name(tiebreak[0])}-high`;
    case HandCategory.Quads:
      return `Four of a Kind, ${plural(tiebreak[0])}`;
    case HandCategory.FullHouse:
      return `Full House, ${plural(tiebreak[0])} full of ${plural(tiebreak[1])}`;
    case HandCategory.Flush:
      return `Flush, ${name(tiebreak[0])}-high`;
    case HandCategory.Straight:
      return `Straight, ${name(tiebreak[0])}-high`;
    case HandCategory.Trips:
      return `Three of a Kind, ${plural(tiebreak[0])}`;
    case HandCategory.TwoPair:
      return `Two Pair, ${plural(tiebreak[0])} and ${plural(tiebreak[1])}`;
    case HandCategory.Pair:
      return `Pair of ${plural(tiebreak[0])}`;
    case HandCategory.HighCard:
      return `${name(tiebreak[0])}-high`;
  }
}

// Evaluate exactly 5 cards into a HandScore.
//
// Hot path: this runs up to ~21× per 7-card hand and millions of times during
// equity enumeration, so it avoids a per-call Map and redundant sorts. A fixed
// 15-slot rank histogram (index = rank, 2..14) is walked once, high-to-low, to
// build `ranks` (desc, with dups), `distinctDesc`, and `groups` in a single
// pass. `groups` only needs a stable sort by count (rank-desc is already
// established by the walk order).
export function evaluate5(cards: Card[]): HandScore {
  if (cards.length !== 5) throw new Error("evaluate5 requires exactly 5 cards");

  const counts = new Array<number>(15).fill(0);
  const suit0 = cards[0].suit;
  let isFlush = true;
  for (const card of cards) {
    counts[card.rank]++;
    if (card.suit !== suit0) isFlush = false;
  }

  const ranks: number[] = [];
  const distinctDesc: number[] = [];
  const groups: [number, number][] = [];
  for (let r = 14; r >= 2; r--) {
    const cnt = counts[r];
    if (cnt === 0) continue;
    distinctDesc.push(r);
    groups.push([r, cnt]);
    for (let k = 0; k < cnt; k++) ranks.push(r);
  }
  // Stable sort by count desc; equal counts keep their rank-desc walk order.
  groups.sort((a, b) => b[1] - a[1]);

  const sHigh = distinctDesc.length === 5 ? straightHigh(distinctDesc) : 0;

  let category: HandCategory;
  let tiebreak: number[];

  if (isFlush && sHigh) {
    category = HandCategory.StraightFlush;
    tiebreak = [sHigh];
  } else if (groups[0][1] === 4) {
    category = HandCategory.Quads;
    tiebreak = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    category = HandCategory.FullHouse;
    tiebreak = [groups[0][0], groups[1][0]];
  } else if (isFlush) {
    category = HandCategory.Flush;
    tiebreak = ranks;
  } else if (sHigh) {
    category = HandCategory.Straight;
    tiebreak = [sHigh];
  } else if (groups[0][1] === 3) {
    category = HandCategory.Trips;
    tiebreak = [groups[0][0], ...distinctDesc.filter((r) => r !== groups[0][0])];
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    category = HandCategory.TwoPair;
    const highPair = Math.max(groups[0][0], groups[1][0]);
    const lowPair = Math.min(groups[0][0], groups[1][0]);
    const kicker = distinctDesc.find((r) => r !== highPair && r !== lowPair)!;
    tiebreak = [highPair, lowPair, kicker];
  } else if (groups[0][1] === 2) {
    category = HandCategory.Pair;
    tiebreak = [groups[0][0], ...distinctDesc.filter((r) => r !== groups[0][0])];
  } else {
    category = HandCategory.HighCard;
    tiebreak = ranks;
  }

  return {
    tuple: [category, ...tiebreak],
    category,
    label: categoryLabel(category, tiebreak),
  };
}

function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  const n = arr.length;
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

// Best 5-card hand from 5..7 cards (Hold'em-style: any combination).
export function evaluateBest(cards: Card[]): HandScore {
  if (cards.length < 5) throw new Error("need at least 5 cards");
  if (cards.length === 5) return evaluate5(cards);
  let best: HandScore | null = null;
  for (const combo of combinations(cards, 5)) {
    const score = evaluate5(combo);
    if (!best || compareScore(score.tuple, best.tuple) > 0) best = score;
  }
  return best!;
}

// Omaha-style: exactly `holeCount` of the hole cards (default 2) + the rest
// from the board, to make the best 5.
export function evaluateOmaha(hole: Card[], board: Card[], holeCount = 2): HandScore {
  const boardCount = 5 - holeCount;
  let best: HandScore | null = null;
  for (const h of combinations(hole, holeCount)) {
    for (const b of combinations(board, boardCount)) {
      const score = evaluate5([...h, ...b]);
      if (!best || compareScore(score.tuple, best.tuple) > 0) best = score;
    }
  }
  if (!best) throw new Error("evaluateOmaha: not enough cards");
  return best;
}

// ── Low hand (8-or-better) for Hi/Lo split games ────────────────────────────
// Returns a comparable low tuple where SMALLER is better, or null if no
// qualifying low (need 5 distinct ranks all <= 8, ace counts low). Straights
// and flushes do not count against the low.
export function evaluateLow5(cards: Card[]): number[] | null {
  const lowRanks = new Set<number>();
  for (const c of cards) {
    const r = c.rank === 14 ? 1 : c.rank; // ace low
    if (r <= 8) lowRanks.add(r);
  }
  if (lowRanks.size < 5) return null;
  // best low = the 5 smallest distinct qualifying ranks; compare high-to-low
  const sortedDesc = [...lowRanks].sort((a, b) => b - a);
  // take the 5 lowest -> the 5 smallest values
  const lowest5 = sortedDesc.slice(sortedDesc.length - 5);
  // compare descending (highest card first); smaller is better
  return lowest5.slice().sort((a, b) => b - a);
}

export function evaluateOmahaLow(hole: Card[], board: Card[], holeCount = 2): number[] | null {
  const boardCount = 5 - holeCount;
  let best: number[] | null = null;
  for (const h of combinations(hole, holeCount)) {
    for (const b of combinations(board, boardCount)) {
      const low = evaluateLow5([...h, ...b]);
      if (low && (!best || compareLow(low, best) < 0)) best = low;
    }
  }
  return best;
}

// Smaller low tuple is the better (nut) low.
export function compareLow(a: number[], b: number[]): number {
  for (let i = 0; i < 5; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export { combinations };
