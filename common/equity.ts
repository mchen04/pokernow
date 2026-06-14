// Pure win-equity calculator. Given each live player's hole cards, the current
// shared board(s), and the set of already-used (dead) cards, returns each
// player's probability of winning a SHARE of the pot (ties split evenly).
//
// Deterministic and RNG-injected: the caller supplies rng() in [0,1). No
// Math.random — the engine forbids it. Both callers seed from STABLE hand state
// (server: hand #, board, contenders' hole cards; client: hand # + street), so a
// given hand's equity/EV is reproducible and auditable — not a fresh crypto draw.
// Reuses the shared evaluator so scoring is identical to the authoritative showdown.
//
// Reusable on the server (all-in EV) and the client (replay win% per street).
//
// HI/LO: when opts.hiLo is set, each board completion is scored for BOTH the
// high and the (8-or-better) low. If any hand qualifies for the low, the pot
// splits 50/50 between the best high and best low (mirroring awardPots);
// otherwise the high takes it all. The returned equity is then the expected
// pot SHARE — a player who scoops both halves approaches 1.0, a high-only or
// low-only winner approaches 0.5. (`hiLoApproximated` is retained for API
// stability but is now always false — the low pot is no longer ignored.)

import type { Card } from "./cards";
import { cardCode, makeDeck } from "./cards";
import {
  evaluateBest,
  evaluateOmaha,
  evaluateLow5,
  evaluateOmahaLow,
  compareScore,
  compareLow,
  combinations,
} from "./evaluator";

export interface EquityPlayer {
  /** Stable id for the result map — typically the seat index. */
  id: number;
  holeCards: Card[];
}

export interface EquityResult {
  /** id -> win equity (pot share), in [0,1]. Sums to ~1 across players. */
  equity: Map<number, number>;
  method: "exact" | "monte-carlo";
  /** Number of board completions evaluated (per board). */
  samples: number;
  /** Retained for API stability. Always false now that the low pot is scored. */
  hiLoApproximated: boolean;
}

export interface EquityOptions {
  /** false -> NLHE any-2; true -> Omaha exactly-`holeCount`-of-4. */
  omaha: boolean;
  /** Omaha hole-count (always 2 for PLO). Ignored for NLHE. */
  holeCount?: number;
  /** true -> also score the 8-or-better low and split high/low when one qualifies (else high-only). */
  hiLo?: boolean;
  /** Above this exact-enumeration count we Monte-Carlo instead. */
  exactLimit?: number;
  /** Monte-Carlo completion count when not enumerating exactly. */
  mcSamples?: number;
  /** Required for the Monte-Carlo path. Deterministic [0,1). */
  rng?: () => number;
}

// Above DEFAULT_EXACT_LIMIT board completions we Monte-Carlo instead of
// enumerating. C(52,5) ≈ 2.6M ≫ this, so preflop all-ins (which need 5 board
// cards) take the MC path; flop/turn all-ins enumerate exactly. Callers tune
// mcSamples per use: the server uses 5k for all-in EV (~0.7% per-hand noise,
// immaterial to luck which averages over a session) and the client replay 4k;
// DEFAULT_MC_SAMPLES is the conservative fallback when a caller omits it.
const DEFAULT_EXACT_LIMIT = 200_000;
const DEFAULT_MC_SAMPLES = 20_000;

/**
 * Compute win equity (pot share, ties split) for each player.
 *
 * @param players Live contenders with their hole cards.
 * @param boards  One board per run (length 1 normally; 2 for RIT/double board).
 *                Each is the cards already on that board (0..5).
 * @param dead    Cards already used and unavailable. The module also defensively
 *                unions in the players' hole cards and the boards.
 */
export function computeEquity(
  players: EquityPlayer[],
  boards: Card[][],
  dead: Card[],
  opts: EquityOptions
): EquityResult {
  const exactLimit = opts.exactLimit ?? DEFAULT_EXACT_LIMIT;
  const mcSamples = opts.mcSamples ?? DEFAULT_MC_SAMPLES;
  const equity = new Map<number, number>();
  for (const p of players) equity.set(p.id, 0);

  if (players.length === 0) {
    return { equity, method: "exact", samples: 0, hiLoApproximated: false };
  }
  if (players.length === 1) {
    equity.set(players[0].id, 1);
    return { equity, method: "exact", samples: 1, hiLoApproximated: false };
  }

  // Dead set: caller-supplied dead + every player's hole cards + every board
  // card. Robust to an incomplete `dead` argument.
  const deadSet = new Set<string>();
  for (const c of dead) deadSet.add(cardCode(c));
  for (const p of players) for (const c of p.holeCards) deadSet.add(cardCode(c));
  for (const b of boards) for (const c of b) deadSet.add(cardCode(c));

  const liveDeck = makeDeck().filter((c) => !deadSet.has(cardCode(c)));
  const needs = boards.map((b) => Math.max(0, 5 - b.length));

  // Decide exact vs Monte-Carlo by the sum of per-board enumeration costs.
  const exactCost = needs.reduce((sum, need) => sum + choose(liveDeck.length, need), 0);

  if (exactCost <= exactLimit) {
    const n = enumerateExact(players, boards, needs, liveDeck, opts, equity);
    return { equity, method: "exact", samples: n, hiLoApproximated: false };
  }
  const rng = opts.rng;
  if (!rng) throw new Error("computeEquity: Monte-Carlo path requires opts.rng");
  const n = monteCarlo(players, boards, needs, liveDeck, opts, rng, mcSamples, equity);
  return { equity, method: "monte-carlo", samples: n, hiLoApproximated: false };
}

// ── exact enumeration ────────────────────────────────────────────────────────
// Each board completes independently and wins an equal fraction (1/nBoards) of
// the pot. Sum raw pot-shares, then divide by the completion count.
function enumerateExact(
  players: EquityPlayer[],
  boards: Card[][],
  needs: number[],
  liveDeck: Card[],
  opts: EquityOptions,
  equity: Map<number, number>
): number {
  const nBoards = boards.length;
  let completionsPerBoard = 1;
  for (let bi = 0; bi < nBoards; bi++) {
    const base = boards[bi];
    const need = needs[bi];
    let count = 0;
    if (need === 0) {
      awardShareWeighted(players, base, opts, equity, 1 / nBoards);
      count = 1;
    } else {
      for (const combo of combinations(liveDeck, need)) {
        awardShareWeighted(players, base.concat(combo), opts, equity, 1 / nBoards);
        count++;
      }
    }
    completionsPerBoard = count || 1;
  }
  for (const p of players) {
    equity.set(p.id, (equity.get(p.id) ?? 0) / completionsPerBoard);
  }
  return completionsPerBoard;
}

// ── Monte-Carlo ──────────────────────────────────────────────────────────────
function monteCarlo(
  players: EquityPlayer[],
  boards: Card[][],
  needs: number[],
  liveDeck: Card[],
  opts: EquityOptions,
  rng: () => number,
  mcSamples: number,
  equity: Map<number, number>
): number {
  const nBoards = boards.length;
  const work = liveDeck.slice();
  for (let s = 0; s < mcSamples; s++) {
    for (let bi = 0; bi < nBoards; bi++) {
      const need = needs[bi];
      const fullBoard = need === 0 ? boards[bi] : boards[bi].concat(partialShuffleDraw(work, need, rng));
      awardShareWeighted(players, fullBoard, opts, equity, 1 / nBoards);
    }
  }
  for (const p of players) {
    equity.set(p.id, (equity.get(p.id) ?? 0) / mcSamples);
  }
  return mcSamples;
}

// Draw `need` distinct cards from `deck` via a partial Fisher–Yates with the
// injected rng. Each board is an independent draw from the same live deck (the
// standard run-it-twice model).
function partialShuffleDraw(deck: Card[], need: number, rng: () => number): Card[] {
  const n = deck.length;
  const out: Card[] = [];
  for (let i = 0; i < need; i++) {
    const j = i + Math.floor(rng() * (n - i));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
    out.push(deck[i]);
  }
  return out;
}

// Score every player on `fullBoard`, find the best high (and, for hi/lo, the
// best qualifying low), and split `weight` among the tied winners — high-only
// when no low qualifies, else 50/50 between the high and low pots.
function awardShareWeighted(
  players: EquityPlayer[],
  fullBoard: Card[],
  opts: EquityOptions,
  acc: Map<number, number>,
  weight: number
) {
  let bestTuple: number[] | null = null;
  let highWinners: number[] = [];
  for (const p of players) {
    const score = opts.omaha
      ? evaluateOmaha(p.holeCards, fullBoard, opts.holeCount ?? 2)
      : evaluateBest(p.holeCards.concat(fullBoard));
    if (bestTuple === null) {
      bestTuple = score.tuple;
      highWinners = [p.id];
    } else {
      const cmp = compareScore(score.tuple, bestTuple);
      if (cmp > 0) {
        bestTuple = score.tuple;
        highWinners = [p.id];
      } else if (cmp === 0) {
        highWinners.push(p.id);
      }
    }
  }

  if (!opts.hiLo) {
    const share = weight / highWinners.length;
    for (const id of highWinners) acc.set(id, (acc.get(id) ?? 0) + share);
    return;
  }

  // Hi/Lo: find the best qualifying low (8-or-better). The low half of the pot
  // exists only if at least one hand qualifies; otherwise the high scoops.
  let bestLow: number[] | null = null;
  let lowWinners: number[] = [];
  for (const p of players) {
    const low = opts.omaha
      ? evaluateOmahaLow(p.holeCards, fullBoard, opts.holeCount ?? 2)
      : evaluateLow5(p.holeCards.concat(fullBoard));
    if (!low) continue;
    if (bestLow === null) {
      bestLow = low;
      lowWinners = [p.id];
    } else {
      const cmp = compareLow(low, bestLow);
      if (cmp < 0) {
        bestLow = low;
        lowWinners = [p.id];
      } else if (cmp === 0) {
        lowWinners.push(p.id);
      }
    }
  }

  const hasLow = lowWinners.length > 0;
  const highWeight = hasLow ? weight / 2 : weight;
  const highShare = highWeight / highWinners.length;
  for (const id of highWinners) acc.set(id, (acc.get(id) ?? 0) + highShare);
  if (hasLow) {
    const lowShare = weight / 2 / lowWinners.length;
    for (const id of lowWinners) acc.set(id, (acc.get(id) ?? 0) + lowShare);
  }
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return Math.round(result);
}

/** Deterministic seedable RNG in [0,1). mulberry32. No Math.random. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
