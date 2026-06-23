// Wire protocol + the redacted public state the server sends to each client.
// The server computes a per-viewer snapshot so a browser only ever receives
// cards it is entitled to see.

import type { Card } from "./cards";
import type { GameVariant, TableConfig } from "./config";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "idle";

export type PlayerActionType = "fold" | "check" | "call" | "bet" | "raise" | "allin";

// ── Client → Server ─────────────────────────────────────────────────────────
export type ClientMessage =
  | { type: "join"; playerId: string; name: string }
  | { type: "rename"; name: string }
  | { type: "sit"; seat: number; buyIn: number }
  | { type: "stand" }
  | { type: "sitOut" }
  | { type: "sitIn" }
  | { type: "rebuy"; amount: number }
  | { type: "action"; action: PlayerActionType; amount?: number; seq: number }
  | { type: "startGame" }
  | { type: "startTournament" }
  | { type: "exitTournament" }
  | { type: "pauseGame" }
  | { type: "updateConfig"; config: Partial<TableConfig> }
  | { type: "chat"; text: string }
  // host moderation
  | { type: "kick"; seat: number }
  | { type: "setStack"; seat: number; stack: number }
  // in-hand interactions
  | { type: "rabbitHunt" }
  | { type: "showCards" }
  | { type: "requestHistory" }
  // WebRTC voice/video (G11) — signaling relayed peer-to-peer; never touches game state
  | { type: "rtc"; to: string; data: unknown }
  | { type: "media"; mic: boolean; cam: boolean }
  | { type: "ping" };

// ── Server → Client ─────────────────────────────────────────────────────────
export type ServerMessage =
  | { type: "state"; state: PublicTableState }
  | { type: "you"; playerId: string }
  | { type: "error"; message: string }
  | { type: "history"; histories: HandSummary[] }
  | { type: "rtc"; from: string; data: unknown }
  | { type: "pong" };

// ── Redacted public state ───────────────────────────────────────────────────
export interface PublicSeat {
  index: number;
  empty: boolean;
  playerId: string | null;
  name: string;
  stack: number;
  sittingOut: boolean;
  connected: boolean;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  betThisStreet: number;
  hasCards: boolean; // holding face-down cards this hand
  holeCards: Card[] | null; // self only, or face-up at showdown
  cardCount: number;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isToAct: boolean;
  isStraddle: boolean;
  revealed: boolean;
  handLabel: string | null; // made-hand label when revealed at showdown
  micOn: boolean; // WebRTC mic active (presence only)
  camOn: boolean; // WebRTC camera active (presence only)
  lastAction: string | null; // "Call 20", "Raise to 60", etc.
  winner: boolean;
  wonAmount: number;
  timeLeftMs: number | null;
  bounty: boolean; // 7-2 bounty visual
}

export interface PublicPot {
  amount: number;
  label: string;
}

export interface LegalAction {
  type: PlayerActionType;
  amount?: number; // for call: the call amount
  min?: number; // for bet/raise: min total-to
  max?: number; // for bet/raise: max total-to (all-in cap)
}

export interface LogEntry {
  id: number;
  hand: number;
  ts: number;
  text: string;
}

export interface ChatMessage {
  id: number;
  playerId: string | null;
  name: string;
  text: string;
  ts: number;
  system: boolean;
}

export interface LedgerEntry {
  playerId: string;
  name: string;
  buyIn: number; // total chips bought in across the session
  stack: number; // current chips (0 if not seated)
  net: number; // stack + cashed-out - buyIn
  seated: boolean;
}

export interface TourneyStanding {
  place: number;
  name: string;
  payout: number;
}

export interface TourneyState {
  active: boolean;
  level: number; // 1-based for display
  smallBlind: number;
  bigBlind: number;
  ante: number;
  levelEndsAt: number | null;
  playersLeft: number;
  startingStack: number;
  prizePool: number;
  finished: boolean;
  standings: TourneyStanding[];
  // multi-table fields (omitted for single-table Sit & Go)
  multiTable?: boolean;
  tablesLeft?: number;
  entrants?: number;
  yourTable?: number; // 1-based table the viewer is at
  yourPlace?: number | null; // finishing place once eliminated
}

export interface PlayerStats {
  playerId: string;
  name: string;
  handsPlayed: number;

  // ── preflop ──
  vpip: number; // % voluntarily put money in preflop
  pfr: number; // % raised preflop
  threeBet: number; // % 3-bet preflop (re-raise over the open)
  foldTo3bet: number; // % the opener folded when facing a 3-bet

  // ── postflop aggression ──
  af: number; // aggression factor (bets+raises)/calls, 1 decimal
  aggPct: number; // aggression frequency %

  // ── showdown ──
  wtsd: number; // % went to showdown given saw flop
  wsd: number; // % won money at showdown
  cbet: number; // % flop continuation bet as preflop aggressor
  foldToCbet: number; // % folded facing a flop c-bet

  // ── results ──
  handsWon: number;
  winRate: number; // handsWon / handsPlayed, %
  net: number; // session net, from the ledger
  bb100: number | null; // big blinds won per 100 hands (null in tournaments)
  biggestPotWon: number;
  biggestPotLost: number;

  // ── all-in EV / luck ──
  allInCount: number; // hands the player was all-in with the board incomplete
  allInEv: number; // cumulative equity-weighted expected chips won at all-in
  allInLuck: number; // cumulative actual − EV; + ran hot, − coolered
}

export interface HandSummary {
  handNumber: number;
  button: number;
  boards: Card[][];
  // per-seat hand outcome
  players: {
    seat: number;
    name: string;
    holeCards: Card[] | null; // revealed only
    net: number; // chips won/lost this hand
    won: number;
  }[];
  actions: string[]; // ordered, human-readable log lines for this hand
  ts: number;
}

export interface PublicTableState {
  roomId: string;
  config: TableConfig;
  variant: GameVariant;
  hostId: string | null;
  youId: string | null;
  yourSeat: number | null;
  isSpectator: boolean;
  phase: "lobby" | "hand" | "runout" | "showdown" | "between";
  street: Street;
  handNumber: number;
  buttonSeat: number;
  seats: PublicSeat[];
  boards: Card[][]; // usually one board; two for double-board / run-it-twice
  pots: PublicPot[];
  totalPot: number;
  currentBet: number;
  toActSeat: number | null;
  actionDeadline: number | null;
  legalActions: LegalAction[];
  callAmount: number;
  callPotOddsPct: number | null; // caller's price vs. final pot they can win
  minRaiseTo: number;
  maxRaiseTo: number;
  potForBet: number; // pot size used for pot-limit max calc
  log: LogEntry[];
  chat: ChatMessage[];
  canStart: boolean;
  paused: boolean;
  seatedCount: number;
  handInProgress: boolean;
  settingsQueued: boolean; // host changed settings mid-hand; they apply next hand
  actionSeq: number; // increments each time the action moves; guards stale acts
  rabbitAvailable: boolean;
  lastHandRabbit: Card[] | null; // revealed rabbit-hunt cards
  ledger: LedgerEntry[];
  stats: PlayerStats[];
  handCount: number; // number of completed hands in history
  tourney: TourneyState | null;
}
