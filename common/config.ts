// Table configuration. Every "premium" toggle here is free and host-settable —
// there is deliberately no payment, diamond, subscription, unlock, or usage-cap
// field anywhere in this product.

export type GameVariant = "nlhe" | "plo" | "plo-hilo";

// Buy-ins are uncapped — chips are play-money and every chip is tracked in the
// ledger, so there's no reason to limit them. The configured maxBuyIn is only a
// *suggested* default (slider ceiling); players may buy in for any amount up to
// this absolute safety ceiling, which exists solely to keep chip arithmetic well
// inside JS's safe-integer range.
export const MAX_BUYIN = 1_000_000_000;

export const VARIANT_LABELS: Record<GameVariant, string> = {
  nlhe: "No-Limit Hold'em",
  plo: "Pot-Limit Omaha",
  "plo-hilo": "PLO Hi/Lo (8 or Better)",
};

export interface TableConfig {
  roomName: string;
  variant: GameVariant;
  smallBlind: number;
  bigBlind: number;
  ante: number; // posted by every player each hand (0 = off)
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number; // 2..10
  actionTimeSec: number; // base action clock
  timeBankSec: number; // extra bankable time per player

  // ── Advanced game features — all free, all host toggles (G4) ──
  runItTwice: boolean; // offer run-it-twice on all-in with action closed
  rabbitHunt: boolean; // allow revealing the undealt board after a hand
  straddle: boolean; // allow a live UTG straddle
  bombPotEvery: number; // bomb pot every N hands (0 = off)
  bombPotAnte: number; // ante size for bomb pots (in big blinds * bb)
  sevenDeuce: number; // 7-2 bounty paid by losers to a 7-2 winner (0 = off)
  doubleBoard: boolean; // run two boards on bomb pots / all-ins
  nitMode: boolean; // NIT game: must announce before acting (no fast actions)
  spectatorsSeeCards: boolean; // spectators see all hole cards face-up (host choice)

  // ── Tournament (G9) ──
  tournament: boolean; // tournament mode (fixed stacks, escalating blinds, no rebuys)
  tourneyStartingStack: number;
  tourneyLevelSec: number; // seconds per blind level
  tourneyTableSize: number; // seats per tournament table; >this entrants => multi-table
}

export interface BlindLevel {
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

// A standard turbo-ish Sit & Go blind schedule.
export const TOURNEY_SCHEDULE: BlindLevel[] = [
  { smallBlind: 10, bigBlind: 20, ante: 0 },
  { smallBlind: 15, bigBlind: 30, ante: 0 },
  { smallBlind: 25, bigBlind: 50, ante: 5 },
  { smallBlind: 50, bigBlind: 100, ante: 10 },
  { smallBlind: 75, bigBlind: 150, ante: 15 },
  { smallBlind: 100, bigBlind: 200, ante: 25 },
  { smallBlind: 150, bigBlind: 300, ante: 25 },
  { smallBlind: 200, bigBlind: 400, ante: 50 },
  { smallBlind: 300, bigBlind: 600, ante: 75 },
  { smallBlind: 500, bigBlind: 1000, ante: 100 },
  { smallBlind: 1000, bigBlind: 2000, ante: 200 },
];

// SNG payout: fraction of the prize pool by finishing place (1st..).
export function payoutStructure(players: number): number[] {
  if (players <= 3) return [1];
  if (players <= 6) return [0.65, 0.35];
  return [0.5, 0.3, 0.2];
}

export const DEFAULT_CONFIG: TableConfig = {
  roomName: "Home Game",
  variant: "nlhe",
  smallBlind: 1,
  bigBlind: 2,
  ante: 0,
  minBuyIn: 40,
  maxBuyIn: 200,
  maxSeats: 9,
  actionTimeSec: 30,
  timeBankSec: 30,
  runItTwice: false,
  rabbitHunt: false,
  straddle: false,
  bombPotEvery: 0,
  bombPotAnte: 0,
  sevenDeuce: 0,
  doubleBoard: false,
  nitMode: false,
  spectatorsSeeCards: false,
  tournament: false,
  tourneyStartingStack: 1500,
  tourneyLevelSec: 300,
  tourneyTableSize: 9,
};

export function holeCardCount(variant: GameVariant): number {
  return variant === "nlhe" ? 2 : 4;
}

export function isOmaha(variant: GameVariant): boolean {
  return variant === "plo" || variant === "plo-hilo";
}

export function isHiLo(variant: GameVariant): boolean {
  return variant === "plo-hilo";
}

// Clamp/repair an incoming config so a malicious or buggy client can never put
// the table into an illegal state.
export function sanitizeConfig(input: Partial<TableConfig>, base: TableConfig): TableConfig {
  const n = (v: unknown, fallback: number, min: number, max: number) => {
    const x = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
    return Math.max(min, Math.min(max, x));
  };
  const variant: GameVariant =
    input.variant === "plo" || input.variant === "plo-hilo" || input.variant === "nlhe"
      ? input.variant
      : base.variant;
  const bb = n(input.bigBlind, base.bigBlind, 2, 1_000_000);
  const sb = n(input.smallBlind, base.smallBlind, 1, bb);
  const maxBuyIn = n(input.maxBuyIn, base.maxBuyIn, bb, 100_000_000);
  return {
    roomName: (typeof input.roomName === "string" ? input.roomName : base.roomName)
      .slice(0, 40)
      .trim() || "Home Game",
    variant,
    smallBlind: sb,
    bigBlind: bb,
    ante: n(input.ante, base.ante, 0, bb * 10),
    minBuyIn: n(input.minBuyIn, base.minBuyIn, bb, maxBuyIn),
    maxBuyIn,
    maxSeats: n(input.maxSeats, base.maxSeats, 2, 10),
    actionTimeSec: n(input.actionTimeSec, base.actionTimeSec, 10, 120),
    timeBankSec: n(input.timeBankSec, base.timeBankSec, 0, 120),
    runItTwice: Boolean(input.runItTwice ?? base.runItTwice),
    rabbitHunt: Boolean(input.rabbitHunt ?? base.rabbitHunt),
    straddle: Boolean(input.straddle ?? base.straddle),
    bombPotEvery: n(input.bombPotEvery, base.bombPotEvery, 0, 100),
    bombPotAnte: n(input.bombPotAnte, base.bombPotAnte, 0, bb * 50),
    sevenDeuce: n(input.sevenDeuce, base.sevenDeuce, 0, bb * 100),
    doubleBoard: Boolean(input.doubleBoard ?? base.doubleBoard),
    nitMode: Boolean(input.nitMode ?? base.nitMode),
    spectatorsSeeCards: Boolean(input.spectatorsSeeCards ?? base.spectatorsSeeCards),
    tournament: Boolean(input.tournament ?? base.tournament),
    tourneyStartingStack: n(input.tourneyStartingStack, base.tourneyStartingStack, 100, 1_000_000),
    tourneyLevelSec: n(input.tourneyLevelSec, base.tourneyLevelSec, 30, 3600),
    tourneyTableSize: n(input.tourneyTableSize, base.tourneyTableSize, 2, 10),
  };
}
