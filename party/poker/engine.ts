// Authoritative No-Limit Hold'em / Pot-Limit Omaha engine.
//
// The server owns one PokerEngine per room. Clients send commands; the engine
// validates them against the rules and mutates the single source of truth. A
// browser never learns a card it isn't entitled to see — redaction happens in
// snapshotFor().
//
// Chip conservation invariant: sum(stack) + sum(committed) is constant within a
// hand. Bets move stack -> committed; awards move committed -> stack.

import type { Card } from "../../common/cards";
import { cardCode } from "../../common/cards";
import {
  type GameVariant,
  type TableConfig,
  TOURNEY_SCHEDULE,
  MAX_BUYIN,
  payoutStructure,
  holeCardCount,
  isOmaha,
  isHiLo,
} from "../../common/config";
import type {
  ChatMessage,
  HandSummary,
  LedgerEntry,
  LegalAction,
  LogEntry,
  PlayerActionType,
  PlayerStats,
  PublicPot,
  PublicSeat,
  PublicTableState,
  Street,
  TourneyState,
  TourneyStanding,
} from "../../common/protocol";
import {
  evaluateBest,
  evaluateOmaha,
  evaluateOmahaLow,
  evaluateLow5,
  compareScore,
  compareLow,
  type HandScore,
} from "../../common/evaluator";
import { computeEquity, mulberry32 } from "../../common/equity";
import { freshShuffledDeck } from "./deck";

export const DISCONNECTED_ACTION_GRACE_MS = 3000;

export interface Seat {
  index: number;
  playerId: string;
  name: string;
  stack: number;
  sittingOut: boolean;
  connected: boolean;
  // ── per-hand state ──
  inHand: boolean;
  holeCards: Card[];
  lastHole: Card[] | null; // cards from the just-finished hand, retained through showdown/between so a player can voluntarily show; cleared on the next deal
  folded: boolean;
  allIn: boolean;
  betThisStreet: number;
  committed: number; // running total wagered this hand
  hasActed: boolean; // acted since the last reopening of betting
  mayRaise: boolean; // allowed to raise when next to act
  revealed: boolean; // cards shown at showdown
  lastAction: string | null;
  winner: boolean;
  wonAmount: number; // total chips collected this hand (pot winnings + 7-2 bounty)
  bountyWon: number; // of wonAmount, the portion from 7-2 bounty transfers (not pot)
  bounty: boolean; // holds a 7-2 win this hand (visual)
  micOn: boolean; // WebRTC presence
  camOn: boolean;
  timeBankMs: number; // remaining time-bank for the current hand
  joinedHand: number;
  // ── per-hand stat flags ──
  vpipThisHand: boolean;
  pfrThisHand: boolean;
  sawPreflop: boolean;
  sawFlop: boolean; // live when the flop was dealt (WTSD / c-bet denominator)
  wentToShowdown: boolean; // reached a contested showdown (WTSD / W$SD numerator)
  // preflop 3-bet / fold-to-3bet
  wasPreflopOpener: boolean; // made the first voluntary raise (the open)
  faced3betChance: boolean; // exactly one prior voluntary raise stood when they acted
  made3bet: boolean; // re-raised on that opportunity
  faced3betAsRaiser: boolean; // the opener later faced a 3-bet
  foldedTo3bet: boolean; // and folded to it
  // c-bet
  wasPreflopAggressor: boolean; // last preflop raiser, reached the flop
  cbetOppResolved: boolean; // latch: first flop decision already counted
  cbetOppFlop: boolean; // had a flop c-bet opportunity
  madeCbetFlop: boolean; // bet the flop as the preflop aggressor
  facedCbetFlop: boolean; // faced a flop c-bet
  foldedToCbetFlop: boolean; // folded to it
  // postflop aggression counters
  pfBets: number;
  pfRaises: number;
  pfCalls: number;
  pfFolds: number;
  // all-in EV / luck
  wasAllInRunout: boolean; // chips all-in with the board incomplete, >=2 contenders
  allInEquityWon: number; // equity-weighted expected pot share at the all-in
}

interface Pot {
  amount: number;
  eligible: number[]; // seat indices that may win this pot
  contributors: number[]; // seat indices that put chips into this layer
}

// Viewer-independent slice of a table snapshot, computed once per broadcast and
// shared across every connection's per-viewer snapshot (see snapshotShared).
export interface SharedSnapshot {
  publicPots: PublicPot[];
  totalPot: number;
  ledger: LedgerEntry[];
  stats: PlayerStats[];
  tourney: TourneyState | null;
  handCount: number;
  canStart: boolean;
  seatedCount: number;
  log: LogEntry[];
  chat: ChatMessage[];
  boards: Card[][];
  seatHandLabels: (string | null)[];
}

// Lifetime stat accumulator per player. Every percentage is a numerator/
// opportunity pair so the rate is only computed where the opportunity existed.
interface PlayerStatAcc {
  name: string;
  handsPlayed: number;
  // VPIP / PFR
  vpipOpp: number;
  vpip: number;
  pfr: number;
  // 3-bet / fold-to-3bet
  threeBetOpp: number;
  threeBet: number;
  faced3betAsRaiserCount: number;
  foldTo3bet: number;
  // postflop aggression
  aggBets: number;
  aggRaises: number;
  aggCalls: number;
  aggFolds: number;
  // showdown
  sawFlopCount: number;
  wtsd: number;
  wonSd: number;
  // c-bet
  cbetOpp: number;
  cbet: number;
  facedCbet: number;
  foldToCbet: number;
  // results
  handsWon: number;
  biggestPotWon: number;
  biggestPotLost: number;
  // all-in EV
  allInCount: number;
  allInEvWon: number;
  allInActualWon: number;
}

const MAX_LOG = 2000;

export class PokerEngine {
  config: TableConfig;
  readonly roomId: string;
  seats: (Seat | null)[];
  hostId: string | null = null;
  handNumber = 0;
  buttonSeat = -1;
  phase: "lobby" | "hand" | "runout" | "showdown" | "between" = "lobby";
  street: Street = "idle";
  boards: Card[][] = [[]];
  private deck: Card[] = [];
  currentBet = 0;
  minRaise = 0;
  toActSeat: number | null = null;
  lastAggressorSeat: number | null = null;
  actionDeadline: number | null = null;
  actionSeq = 0;
  paused = false;
  log: LogEntry[] = [];
  chat: ChatMessage[] = [];
  rabbitCards: Card[] | null = null;
  // Settings the host changed mid-hand: held here and applied when the next hand
  // is dealt, so adjusting blinds/options during a live hand queues instead of
  // erroring. Null when there's nothing pending.
  pendingConfig: TableConfig | null = null;
  handHistories: HandSummary[] = [];
  private ledgerMap = new Map<string, { name: string; buyIn: number; cashOut: number }>();
  private handStartStacks = new Map<number, number>();
  private statsMap = new Map<string, PlayerStatAcc>();

  // ── hand-scoped stat context (reset at the top of startHand) ──
  private preflopRaiseCount = 0; // voluntary preflop raises so far (blinds/straddle excluded)
  private flopCbetActive = false; // the preflop aggressor has c-bet the current flop
  private flopCbetAmount = 0; // size of that c-bet, so a later raise over it isn't "fold to c-bet"
  private preflopAggressorSeat: number | null = null; // snapshot before collectStreet() nulls lastAggressorSeat
  private allInEquityCaptured = false; // once-per-hand latch for captureAllInEquity()

  private sbSeat = -1;
  private bbSeat = -1;
  private straddleSeat = -1;
  private tourney: {
    active: boolean;
    level: number; // 0-based index into TOURNEY_SCHEDULE
    levelEndsAt: number | null;
    startingStack: number;
    entrants: number;
    entrantIds: Set<string>;
    eliminated: { playerId: string; name: string; place: number }[];
    finished: boolean;
    standings: TourneyStanding[];
  } | null = null;
  private logId = 1;
  private chatId = 1;
  private now: () => number;
  private deckFactory: () => Card[];

  constructor(
    roomId: string,
    config: TableConfig,
    now: () => number = () => Date.now(),
    deckFactory: () => Card[] = freshShuffledDeck
  ) {
    this.roomId = roomId;
    this.config = config;
    this.seats = new Array(config.maxSeats).fill(null);
    this.now = now;
    this.deckFactory = deckFactory;
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private occupied(): Seat[] {
    return this.seats.filter((s): s is Seat => s !== null);
  }

  private seatOf(playerId: string): Seat | null {
    return this.seats.find((s) => s?.playerId === playerId) ?? null;
  }

  private nextSeat(from: number, pred: (s: Seat) => boolean): number | null {
    const n = this.config.maxSeats;
    for (let i = 1; i <= n; i++) {
      const idx = (from + i) % n;
      const s = this.seats[idx];
      if (s && pred(s)) return idx;
    }
    return null;
  }

  private dealtIn(s: Seat): boolean {
    return !s.sittingOut && s.stack > 0;
  }

  private livePlayers(): Seat[] {
    return this.occupied().filter((s) => s.inHand && !s.folded);
  }

  private canActSeats(): Seat[] {
    return this.occupied().filter((s) => s.inHand && !s.folded && !s.allIn);
  }

  private addLog(text: string) {
    this.log.push({ id: this.logId++, hand: this.handNumber, ts: this.now(), text });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  addChat(playerId: string | null, name: string, text: string, system = false) {
    const clean = text.slice(0, 400);
    this.chat.push({ id: this.chatId++, playerId, name, text: clean, ts: this.now(), system });
    if (this.chat.length > 500) this.chat.splice(0, this.chat.length - 500);
  }

  // ── ledger (buy-ins / cash-outs / up-down) ───────────────────────────────
  private addBuyIn(playerId: string, name: string, amount: number) {
    const e = this.ledgerMap.get(playerId) ?? { name, buyIn: 0, cashOut: 0 };
    e.buyIn += amount;
    e.name = name;
    this.ledgerMap.set(playerId, e);
  }

  private addCashOut(playerId: string, amount: number) {
    const e = this.ledgerMap.get(playerId);
    if (e) e.cashOut += amount;
  }

  ledgerRows(): LedgerEntry[] {
    // O(seats) map instead of an O(seats) seatOf() scan per ledger row.
    const seatByPid = new Map<string, Seat>();
    for (const s of this.occupied()) seatByPid.set(s.playerId, s);
    const rows: LedgerEntry[] = [];
    for (const [pid, e] of this.ledgerMap) {
      const seat = seatByPid.get(pid) ?? null;
      // count chips in the current pot as still the player's, so the ledger
      // reconciles to bought-in chips at every moment, not just between hands
      const stack = seat ? seat.stack + seat.committed : 0;
      rows.push({
        playerId: pid,
        name: seat?.name ?? e.name,
        buyIn: e.buyIn,
        stack,
        net: stack + e.cashOut - e.buyIn,
        seated: !!seat,
      });
    }
    return rows.sort((a, b) => b.net - a.net);
  }

  private captureHandSummary() {
    if (this.handNumber === 0 || this.handStartStacks.size === 0) return;
    const actions = this.log.filter((l) => l.hand === this.handNumber).map((l) => l.text);
    // Iterate the dealt-in seats directly (handStartStacks is keyed by seat index
    // in seat order) rather than scanning + filtering all occupied seats.
    const players: HandSummary["players"] = [];
    for (const [seatIdx, startStack] of this.handStartStacks) {
      const s = this.seats[seatIdx];
      if (!s) continue;
      players.push({
        seat: s.index,
        name: s.name,
        holeCards: s.revealed ? s.holeCards.slice() : null,
        net: s.stack - startStack,
        won: s.wonAmount,
      });
    }
    this.handHistories.push({
      handNumber: this.handNumber,
      button: this.buttonSeat,
      boards: this.boards.map((b) => [...b]),
      players,
      actions,
      ts: this.now(),
    });
    if (this.handHistories.length > 1000) this.handHistories.shift();
  }

  private blankAcc(name: string): PlayerStatAcc {
    return {
      name,
      handsPlayed: 0,
      vpipOpp: 0,
      vpip: 0,
      pfr: 0,
      threeBetOpp: 0,
      threeBet: 0,
      faced3betAsRaiserCount: 0,
      foldTo3bet: 0,
      aggBets: 0,
      aggRaises: 0,
      aggCalls: 0,
      aggFolds: 0,
      sawFlopCount: 0,
      wtsd: 0,
      wonSd: 0,
      cbetOpp: 0,
      cbet: 0,
      facedCbet: 0,
      foldToCbet: 0,
      handsWon: 0,
      biggestPotWon: 0,
      biggestPotLost: 0,
      allInCount: 0,
      allInEvWon: 0,
      allInActualWon: 0,
    };
  }

  private updateStats() {
    for (const s of this.occupied()) {
      if (!this.handStartStacks.has(s.index)) continue; // only dealt-in seats
      const st = this.statsMap.get(s.playerId) ?? this.blankAcc(s.name);
      st.name = s.name;
      st.handsPlayed++;

      // VPIP / PFR (denominator = a real preflop decision existed)
      if (s.sawPreflop) {
        st.vpipOpp++;
        if (s.vpipThisHand) st.vpip++;
        if (s.pfrThisHand) st.pfr++;
      }
      // 3-bet
      if (s.faced3betChance) {
        st.threeBetOpp++;
        if (s.made3bet) st.threeBet++;
      }
      // fold to 3-bet (as the opener)
      if (s.faced3betAsRaiser) {
        st.faced3betAsRaiserCount++;
        if (s.foldedTo3bet) st.foldTo3bet++;
      }
      // postflop aggression
      st.aggBets += s.pfBets;
      st.aggRaises += s.pfRaises;
      st.aggCalls += s.pfCalls;
      st.aggFolds += s.pfFolds;
      // showdown
      if (s.sawFlop) st.sawFlopCount++;
      if (s.wentToShowdown) {
        st.wtsd++;
        if (s.wonAmount > 0) st.wonSd++;
      }
      // c-bet
      if (s.cbetOppFlop) {
        st.cbetOpp++;
        if (s.madeCbetFlop) st.cbet++;
      }
      if (s.facedCbetFlop) {
        st.facedCbet++;
        if (s.foldedToCbetFlop) st.foldToCbet++;
      }
      // results. potWon excludes 7-2 bounty receipts (a side transfer, not a pot)
      // so "biggest pot won" reflects an actual pot, not pot+bounty.
      const potWon = s.wonAmount - s.bountyWon;
      if (s.wonAmount > 0) {
        st.handsWon++;
        st.biggestPotWon = Math.max(st.biggestPotWon, potWon);
      }
      const start = this.handStartStacks.get(s.index);
      if (start !== undefined) {
        const handNet = s.stack - start; // committed already swept into stack by award time
        if (handNet < 0) st.biggestPotLost = Math.max(st.biggestPotLost, -handNet);
      }
      // all-in EV / luck — only hands with all-in variance contribute
      if (s.wasAllInRunout) {
        st.allInCount++;
        st.allInEvWon += s.allInEquityWon;
        // pot winnings only — the equity snapshot (allInEquityWon) is pot-based,
        // so the bounty must be excluded to keep luck (actual − EV) zero-sum.
        st.allInActualWon += potWon;
      }

      this.statsMap.set(s.playerId, st);
    }
  }

  // `ledger` may be supplied by the caller (snapshotShared) to avoid recomputing
  // it — statsRows is otherwise called right alongside ledgerRows every snapshot.
  statsRows(ledger?: LedgerEntry[]): PlayerStats[] {
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
    const ratio1 = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10) / 10 : n);
    const bb = this.config.bigBlind || 1;
    const isTourney = this.isTournament();
    const netByPlayer = new Map((ledger ?? this.ledgerRows()).map((l) => [l.playerId, l.net]));
    const seatByPid = new Map<string, Seat>();
    for (const s of this.occupied()) seatByPid.set(s.playerId, s);
    const rows: PlayerStats[] = [];
    for (const [pid, st] of this.statsMap) {
      const net = netByPlayer.get(pid) ?? 0;
      const aggActions = st.aggBets + st.aggRaises + st.aggCalls + st.aggFolds;
      rows.push({
        playerId: pid,
        name: seatByPid.get(pid)?.name ?? st.name,
        handsPlayed: st.handsPlayed,

        vpip: pct(st.vpip, st.vpipOpp),
        pfr: pct(st.pfr, st.vpipOpp),
        threeBet: pct(st.threeBet, st.threeBetOpp),
        foldTo3bet: pct(st.foldTo3bet, st.faced3betAsRaiserCount),

        af: ratio1(st.aggBets + st.aggRaises, st.aggCalls),
        aggPct: pct(st.aggBets + st.aggRaises, aggActions),

        wtsd: pct(st.wtsd, st.sawFlopCount),
        wsd: pct(st.wonSd, st.wtsd),
        cbet: pct(st.cbet, st.cbetOpp),
        foldToCbet: pct(st.foldToCbet, st.facedCbet),

        handsWon: st.handsWon,
        winRate: pct(st.handsWon, st.handsPlayed),
        net,
        bb100:
          isTourney || st.handsPlayed === 0
            ? null
            : Math.round((net / bb / st.handsPlayed) * 100 * 10) / 10,
        biggestPotWon: st.biggestPotWon,
        biggestPotLost: st.biggestPotLost,

        allInCount: st.allInCount,
        allInEv: Math.round(st.allInEvWon),
        allInLuck: Math.round(st.allInActualWon - st.allInEvWon),
      });
    }
    return rows.sort((a, b) => b.net - a.net);
  }

  // ── seating / membership ─────────────────────────────────────────────────
  ensureHost(playerId: string) {
    if (!this.hostId) this.hostId = playerId;
  }

  setConnected(playerId: string, connected: boolean) {
    const s = this.seatOf(playerId);
    if (!s) return;
    s.connected = connected;
    if (!connected && s.index === this.toActSeat) this.shortenDisconnectedActionClock();
  }

  isHost(playerId: string): boolean {
    return this.hostId === playerId;
  }

  handInProgress(): boolean {
    return this.phase === "hand";
  }

  seatName(playerId: string): string | null {
    return this.seatOf(playerId)?.name ?? null;
  }

  setMedia(playerId: string, mic: boolean, cam: boolean) {
    const s = this.seatOf(playerId);
    if (s) {
      s.micOn = mic;
      s.camOn = cam;
    }
  }

  sit(playerId: string, name: string, seatIndex: number, buyIn: number): string | null {
    if (seatIndex < 0 || seatIndex >= this.config.maxSeats) return "Invalid seat";
    if (this.seats[seatIndex]) return "Seat taken";
    if (this.seatOf(playerId)) return "Already seated";
    // No upper cap: buy in for at least the minimum, up to the safety ceiling.
    const buy = Math.max(
      this.config.minBuyIn,
      Math.min(MAX_BUYIN, safeInt(buyIn, this.config.minBuyIn))
    );
    const seat = this.makeSeat(seatIndex, playerId, name, buy);
    this.seats[seatIndex] = seat;
    this.ensureHost(playerId);
    this.addBuyIn(playerId, seat.name, buy);
    this.addLog(`${seat.name} joined with ${buy}`);
    return null;
  }

  private makeSeat(index: number, playerId: string, name: string, stack: number): Seat {
    return {
      index,
      playerId,
      name: name.slice(0, 20) || "Player",
      stack,
      sittingOut: false,
      connected: true,
      inHand: false,
      holeCards: [],
      lastHole: null,
      folded: false,
      allIn: false,
      betThisStreet: 0,
      committed: 0,
      hasActed: false,
      mayRaise: true,
      revealed: false,
      lastAction: null,
      winner: false,
      wonAmount: 0,
      bountyWon: 0,
      bounty: false,
      micOn: false,
      camOn: false,
      timeBankMs: this.config.timeBankSec * 1000,
      joinedHand: this.handNumber,
      vpipThisHand: false,
      pfrThisHand: false,
      sawPreflop: false,
      sawFlop: false,
      wentToShowdown: false,
      wasPreflopOpener: false,
      faced3betChance: false,
      made3bet: false,
      faced3betAsRaiser: false,
      foldedTo3bet: false,
      wasPreflopAggressor: false,
      cbetOppResolved: false,
      cbetOppFlop: false,
      madeCbetFlop: false,
      facedCbetFlop: false,
      foldedToCbetFlop: false,
      pfBets: 0,
      pfRaises: 0,
      pfCalls: 0,
      pfFolds: 0,
      wasAllInRunout: false,
      allInEquityWon: 0,
    };
  }

  // ── MTT table moves (coordinator-only, between hands) ──────────────────────
  takeOutForMove(playerId: string): { name: string; stack: number } | null {
    const s = this.seatOf(playerId);
    if (!s) return null;
    this.seats[s.index] = null;
    return { name: s.name, stack: s.stack };
  }

  putInForMove(playerId: string, name: string, stack: number): boolean {
    if (this.seatOf(playerId)) return true;
    const idx = this.seats.findIndex((x) => x === null);
    if (idx < 0) return false;
    this.seats[idx] = this.makeSeat(idx, playerId, name, stack);
    return true;
  }

  // Coordinator sets blinds directly (MTT level change, between hands).
  setBlinds(smallBlind: number, bigBlind: number, ante: number) {
    this.config = { ...this.config, smallBlind, bigBlind, ante };
  }

  occupiedPlayers(): { playerId: string; name: string; stack: number }[] {
    return this.occupied().map((s) => ({ playerId: s.playerId, name: s.name, stack: s.stack }));
  }

  tournamentEntrants(): { playerId: string; name: string; stack: number }[] {
    return this.occupied()
      .filter((s) => !s.sittingOut && s.stack > 0)
      .map((s) => ({ playerId: s.playerId, name: s.name, stack: s.stack }));
  }

  // total chips at this table including chips committed to the current pot
  chipsInPlay(): number {
    return this.occupied().reduce((sum, s) => sum + s.stack + s.committed, 0);
  }

  stand(playerId: string): string | null {
    const s = this.seatOf(playerId);
    if (!s) return "Not seated";
    // if in a live hand, fold them first
    if (s.inHand && !s.folded && this.phase === "hand") {
      this.applyFold(s, true);
    }
    this.addCashOut(playerId, s.stack); // record chips they leave with
    this.addLog(`${s.name} left the table`);
    this.seats[s.index] = null;
    if (this.hostId === playerId) {
      // reassign host to the longest-seated remaining player
      const next = this.occupied()[0];
      this.hostId = next ? next.playerId : null;
    }
    return null;
  }

  rename(playerId: string, name: string) {
    const s = this.seatOf(playerId);
    if (s) s.name = name.slice(0, 20) || "Player";
  }

  rebuy(playerId: string, amount: number): string | null {
    const s = this.seatOf(playerId);
    if (!s) return "Not seated";
    if (this.tourney?.active) return "No rebuys in a tournament";
    const add = safeInt(amount, 0);
    if (add <= 0) return "Invalid amount";
    const before = s.stack;
    // No upper cap on top-ups either; only guard the safety ceiling.
    s.stack = Math.min(MAX_BUYIN, s.stack + add);
    const delta = s.stack - before;
    this.addBuyIn(s.playerId, s.name, delta);
    // A player who had busted (stack 0 → sat out) is back in the action the
    // moment they re-buy.
    if (before <= 0) s.sittingOut = false;
    this.addLog(`${s.name} added ${delta} in chips`);
    return null;
  }

  sitOut(playerId: string): string | null {
    const s = this.seatOf(playerId);
    if (!s) return "Not seated";
    if (this.tourney?.active) return "Sit-out is only available in cash games";
    if (s.stack <= 0) return "Re-buy to sit back in";
    if (s.sittingOut) return null;
    s.sittingOut = true;
    this.addLog(s.inHand && this.phase === "hand" ? `${s.name} will sit out after this hand` : `${s.name} is sitting out`);
    return null;
  }

  sitIn(playerId: string): string | null {
    const s = this.seatOf(playerId);
    if (!s) return "Not seated";
    if (this.tourney?.active) return "Tournament players rejoin automatically when connected";
    if (s.stack <= 0) return "Re-buy to sit back in";
    if (!s.sittingOut) return null;
    s.sittingOut = false;
    this.addLog(`${s.name} is back`);
    return null;
  }

  // host moderation
  hostSetStack(host: string, seatIndex: number, stack: number): string | null {
    if (!this.isHost(host)) return "Only the host can do that";
    const s = this.seats[seatIndex];
    if (!s) return "No player there";
    if (s.inHand && this.phase === "hand") return "Can't edit chips mid-hand";
    const before = s.stack;
    s.stack = Math.max(0, safeInt(stack, before));
    const delta = s.stack - before;
    if (delta > 0) this.addBuyIn(s.playerId, s.name, delta);
    else if (delta < 0) this.addCashOut(s.playerId, -delta);
    this.addLog(`Host set ${s.name}'s stack to ${s.stack}`);
    return null;
  }

  hostKick(host: string, seatIndex: number): string | null {
    if (!this.isHost(host)) return "Only the host can do that";
    const s = this.seats[seatIndex];
    if (!s) return "No player there";
    if (s.inHand && !s.folded && this.phase === "hand") this.applyFold(s, true);
    this.addLog(`Host removed ${s.name}`);
    this.seats[seatIndex] = null;
    return null;
  }

  updateConfig(host: string, next: TableConfig): string | null {
    if (!this.isHost(host)) return "Only the host can change settings";
    // A hand is in flight (dealing, running out, or showing down) — applying new
    // settings now could change blinds/seat count mid-deal. Queue them and roll
    // them in when the next hand starts instead of rejecting the change.
    if (this.phase === "hand" || this.phase === "runout" || this.phase === "showdown") {
      this.pendingConfig = next;
      this.addLog(`Host queued new table settings (apply next hand)`);
      return null;
    }
    this.pendingConfig = null;
    this.applyConfig(next);
    this.addLog(`Host updated table settings`);
    return null;
  }

  // Swap in a new config and resize the seat array if maxSeats changed. Shared by
  // the immediate path (between hands) and the queued path (applied at deal time).
  private applyConfig(next: TableConfig) {
    this.config = next;
    if (next.maxSeats !== this.seats.length) {
      const grown: (Seat | null)[] = new Array(next.maxSeats).fill(null);
      for (const s of this.occupied()) if (s.index < next.maxSeats) grown[s.index] = s;
      this.seats = grown;
    }
  }

  // ── tournament (Sit & Go, G9) ──────────────────────────────────────────────
  private effectiveBlinds(): { sb: number; bb: number; ante: number } {
    if (this.tourney?.active) {
      const lvl = TOURNEY_SCHEDULE[Math.min(this.tourney.level, TOURNEY_SCHEDULE.length - 1)];
      return { sb: lvl.smallBlind, bb: lvl.bigBlind, ante: lvl.ante };
    }
    return { sb: this.config.smallBlind, bb: this.config.bigBlind, ante: this.config.ante };
  }

  isTournament(): boolean {
    return !!this.tourney?.active;
  }

  tourneyLevelEndsAt(): number | null {
    return this.tourney?.active ? this.tourney.levelEndsAt : null;
  }

  startTournament(host: string, now: number): string | null {
    if (!this.isHost(host)) return "Only the host can start the tournament";
    if (this.phase === "hand") return "Finish the current hand first";
    const entrants = this.occupied().filter((s) => !s.sittingOut && s.stack > 0);
    if (entrants.length < 2) return "Need at least two registered players";
    const entrantIds = new Set(entrants.map((s) => s.playerId));
    const startingStack = this.config.tourneyStartingStack;
    for (const s of this.occupied()) {
      if (entrantIds.has(s.playerId)) {
        s.stack = startingStack;
        s.sittingOut = false;
      } else {
        s.sittingOut = true;
        s.inHand = false;
      }
    }
    this.tourney = {
      active: true,
      level: 0,
      levelEndsAt: now + this.config.tourneyLevelSec * 1000,
      startingStack,
      entrants: entrants.length,
      entrantIds,
      eliminated: [],
      finished: false,
      standings: [],
    };
    this.addLog(`🏆 Sit & Go started — ${entrants.length} players, ${startingStack} chips each`);
    return null;
  }

  advanceLevel(now: number): boolean {
    if (!this.tourney?.active || this.tourney.finished) return false;
    if (this.tourney.level >= TOURNEY_SCHEDULE.length - 1) {
      this.tourney.levelEndsAt = now + this.config.tourneyLevelSec * 1000;
      return false;
    }
    this.tourney.level++;
    this.tourney.levelEndsAt = now + this.config.tourneyLevelSec * 1000;
    const b = this.effectiveBlinds();
    this.addLog(`⏫ Blinds up — level ${this.tourney.level + 1}: ${b.sb}/${b.bb}${b.ante ? ` ante ${b.ante}` : ""}`);
    return true;
  }

  // After a hand, eliminate busted players and finish the tournament if one left.
  private processEliminations() {
    if (!this.tourney?.active || this.tourney.finished) return;
    const isEntrant = (s: Seat) => this.tourney!.entrantIds.has(s.playerId);
    const alive = this.occupied().filter((s) => isEntrant(s) && s.stack > 0);
    const busted = this.occupied().filter(
      (s) => isEntrant(s) && s.stack <= 0 && !this.tourney!.eliminated.some((e) => e.playerId === s.playerId)
    );
    // place: players still alive (incl. those busting now) determine finishing order
    for (const s of busted) {
      const place = alive.length + busted.length - busted.indexOf(s);
      this.tourney.eliminated.push({ playerId: s.playerId, name: s.name, place });
      s.sittingOut = true;
      this.addLog(`${s.name} finished in ${ordinal(place)} place`);
    }
    if (alive.length <= 1 && this.tourney.entrants >= 2) {
      this.finishTournament(alive[0]);
    }
  }

  private finishTournament(winner: Seat | undefined) {
    if (!this.tourney) return;
    this.tourney.finished = true;
    this.tourney.active = false;
    const prizePool = this.tourney.startingStack * this.tourney.entrants;
    const structure = payoutStructure(this.tourney.entrants);
    // build finishing order: winner 1st, then eliminations by descending place
    const order: { name: string; playerId: string }[] = [];
    if (winner) order.push({ name: winner.name, playerId: winner.playerId });
    const byPlace = [...this.tourney.eliminated].sort((a, b) => a.place - b.place);
    for (const e of byPlace) order.push({ name: e.name, playerId: e.playerId });
    const standings: TourneyStanding[] = order.map((p, i) => ({
      place: i + 1,
      name: p.name,
      payout: Math.round((structure[i] ?? 0) * prizePool),
    }));
    this.tourney.standings = standings;
    if (winner) this.addLog(`🏆 ${winner.name} wins the Sit & Go!`);
  }

  // Host bails out of tournament mode back to a cash game. Current stacks become
  // cash chips; busted players stay sat out until they re-buy (now permitted).
  // Blocked mid-hand so it can't disrupt an in-progress deal.
  exitTournament(host: string): string | null {
    if (!this.isHost(host)) return "Only the host can exit the tournament";
    if (!this.tourney) return "Not in a tournament";
    if (this.phase === "hand" || this.phase === "runout") return "Finish the current hand first";
    this.tourney = null;
    this.addLog("Tournament ended — back to a cash game");
    return null;
  }

  private tourneyState(): TourneyState | null {
    if (!this.tourney) return null;
    const b = this.effectiveBlinds();
    const playersLeft = this.occupied().filter(
      (s) => this.tourney!.entrantIds.has(s.playerId) && s.stack > 0
    ).length;
    return {
      active: this.tourney.active,
      level: this.tourney.level + 1,
      smallBlind: b.sb,
      bigBlind: b.bb,
      ante: b.ante,
      levelEndsAt: this.tourney.levelEndsAt,
      playersLeft,
      startingStack: this.tourney.startingStack,
      prizePool: this.tourney.startingStack * this.tourney.entrants,
      finished: this.tourney.finished,
      standings: this.tourney.standings,
    };
  }

  // ── starting a hand ────────────────────────────────────────────────────────
  canStart(): boolean {
    if (this.phase === "hand") return false;
    if (this.tourney?.finished) return false;
    const ready = this.occupied().filter((s) => this.dealtIn(s));
    return ready.length >= 2;
  }

  startHand(): string | null {
    if (this.phase === "hand") return "Hand already in progress";
    // Roll in any settings the host queued during the previous hand before we
    // read blinds/seat count for this deal.
    if (this.pendingConfig) {
      this.applyConfig(this.pendingConfig);
      this.pendingConfig = null;
      this.addLog(`Queued table settings now in effect`);
    }
    const ready = this.occupied().filter((s) => this.dealtIn(s));
    if (ready.length < 2) return "Need at least two players with chips";

    this.handNumber++;
    const eb = this.effectiveBlinds();
    this.rabbitCards = null;
    this.boards = this.config.doubleBoard ? [[], []] : [[]];
    this.deck = this.deckFactory();
    this.phase = "hand";
    this.street = "preflop";
    this.currentBet = 0;
    this.minRaise = eb.bb;
    this.lastAggressorSeat = null;
    // reset hand-scoped stat context
    this.preflopRaiseCount = 0;
    this.flopCbetActive = false;
    this.flopCbetAmount = 0;
    this.preflopAggressorSeat = null;
    this.allInEquityCaptured = false;

    // reset per-hand seat state
    this.handStartStacks.clear();
    for (const s of this.occupied()) {
      s.inHand = this.dealtIn(s);
      if (s.inHand) this.handStartStacks.set(s.index, s.stack);
      this.resetSeatForHand(s);
    }

    // move button to next dealt-in seat
    const from = this.buttonSeat < 0 ? this.config.maxSeats - 1 : this.buttonSeat;
    const nextButton = this.nextSeat(from, (s) => s.inHand);
    this.buttonSeat = nextButton ?? (ready[0]?.index ?? 0);

    const inHandSeats = this.occupied().filter((s) => s.inHand);
    const headsUp = inHandSeats.length === 2;

    // blind positions
    this.straddleSeat = -1;
    if (headsUp) {
      this.sbSeat = this.buttonSeat; // button is SB heads-up
      this.bbSeat = this.nextSeat(this.buttonSeat, (s) => s.inHand)!;
    } else {
      this.sbSeat = this.nextSeat(this.buttonSeat, (s) => s.inHand)!;
      this.bbSeat = this.nextSeat(this.sbSeat, (s) => s.inHand)!;
    }

    const isBomb =
      this.config.bombPotEvery > 0 && this.handNumber % this.config.bombPotEvery === 0;
    this.addLog(
      `Hand #${this.handNumber} — button: ${this.seats[this.buttonSeat]!.name}${isBomb ? " · BOMB POT" : ""}`
    );

    const k = holeCardCount(this.config.variant);

    if (isBomb) {
      // bomb pot: everyone antes, no blinds, deal straight to the flop
      const ante = this.config.bombPotAnte > 0 ? this.config.bombPotAnte : eb.bb;
      for (const s of inHandSeats) this.postBlind(s, ante, "bomb ante");
      this.currentBet = 0;
      this.minRaise = eb.bb;
      this.sbSeat = -1;
      this.bbSeat = -1;
      for (let r = 0; r < k; r++) for (const s of inHandSeats) s.holeCards.push(this.deck.pop()!);
      this.street = "flop";
      this.dealBoard(3);
      for (const s of inHandSeats) s.sawFlop = true; // bomb pots deal straight to the flop
      this.addLog(
        "Flop: " + this.boards.map((b) => b.map(cardCode).join(" ")).join("  |  ")
      );
      this.toActSeat = this.nextSeat(this.buttonSeat, (s) => this.needsToAct(s));
    } else {
      if (eb.ante > 0) {
        for (const s of inHandSeats) this.postBlind(s, eb.ante, "ante");
      }
      const sb = this.seats[this.sbSeat]!;
      const bb = this.seats[this.bbSeat]!;
      this.postBlind(sb, eb.sb, "small blind");
      this.postBlind(bb, eb.bb, "big blind");
      this.currentBet = eb.bb;
      this.minRaise = eb.bb;
      sb.hasActed = false;
      bb.hasActed = false;

      // live straddle (UTG posts 2x BB) — needs a UTG distinct from the blinds
      if (this.config.straddle && inHandSeats.length >= 3) {
        this.straddleSeat = this.nextSeat(this.bbSeat, (s) => s.inHand)!;
        const str = this.seats[this.straddleSeat]!;
        const amt = eb.bb * 2;
        this.postBlind(str, amt, "straddle");
        this.currentBet = Math.max(this.currentBet, amt);
        this.minRaise = amt;
        str.hasActed = false;
      }

      for (let r = 0; r < k; r++) for (const s of inHandSeats) s.holeCards.push(this.deck.pop()!);
      for (const s of inHandSeats) s.sawPreflop = true; // preflop decision exists (not a bomb pot)

      const fromSeat = this.straddleSeat >= 0 ? this.straddleSeat : this.bbSeat;
      this.toActSeat = headsUp
        ? this.straddleSeat >= 0
          ? this.nextSeat(this.straddleSeat, (s) => s.inHand && !s.allIn)
          : this.sbSeat
        : this.nextSeat(fromSeat, (s) => s.inHand && !s.allIn);
    }

    this.bumpSeq();
    this.resetClock();

    if (!this.someoneCanAct()) {
      this.beginRunout();
    } else if (this.toActSeat !== null && this.seats[this.toActSeat]!.allIn) {
      this.advanceAction();
    }
    return null;
  }

  // Reset a seat's per-hand state (everything except inHand, which the caller
  // sets from dealtIn).
  private resetSeatForHand(s: Seat) {
    s.holeCards = [];
    s.lastHole = null;
    s.folded = false;
    s.allIn = false;
    s.betThisStreet = 0;
    s.committed = 0;
    s.hasActed = false;
    s.mayRaise = true;
    s.revealed = false;
    s.lastAction = null;
    s.winner = false;
    s.wonAmount = 0;
    s.bountyWon = 0;
    s.bounty = false;
    s.timeBankMs = this.config.timeBankSec * 1000;
    s.vpipThisHand = false;
    s.pfrThisHand = false;
    s.sawPreflop = false;
    s.sawFlop = false;
    s.wentToShowdown = false;
    s.wasPreflopOpener = false;
    s.faced3betChance = false;
    s.made3bet = false;
    s.faced3betAsRaiser = false;
    s.foldedTo3bet = false;
    s.wasPreflopAggressor = false;
    s.cbetOppResolved = false;
    s.cbetOppFlop = false;
    s.madeCbetFlop = false;
    s.facedCbetFlop = false;
    s.foldedToCbetFlop = false;
    s.pfBets = 0;
    s.pfRaises = 0;
    s.pfCalls = 0;
    s.pfFolds = 0;
    s.wasAllInRunout = false;
    s.allInEquityWon = 0;
  }

  private postBlind(s: Seat, amount: number, kind: string) {
    const post = Math.min(amount, s.stack);
    s.stack -= post;
    s.betThisStreet += post;
    s.committed += post;
    if (s.stack === 0) s.allIn = true;
    this.addLog(`${s.name} posts ${kind} ${post}`);
  }

  // ── betting actions ────────────────────────────────────────────────────────
  act(playerId: string, action: PlayerActionType, amount: number | undefined, seq: number): string | null {
    if (this.phase !== "hand") return "No hand in progress";
    const s = this.seatOf(playerId);
    if (!s) return "Not seated";
    if (this.toActSeat !== s.index) return "Not your turn";
    if (seq !== this.actionSeq) return null; // stale/duplicate action — ignore silently
    const toCall = this.currentBet - s.betThisStreet;
    // Does this action commit chips ABOVE the current bet (i.e. raise vs call)?
    // An all-in that can't exceed the bet is a call, not a raise. Used to
    // classify all-ins consistently for VPIP/PFR/3-bet/aggression.
    const raisesOver = s.betThisStreet + s.stack > this.currentBet;
    const isAggro = action === "bet" || action === "raise" || (action === "allin" && raisesOver);

    // ── preflop HUD tracking (these read the betting context BEFORE the action
    //    mutates it, so order matters; nothing here is forced-blind activity) ──
    if (this.street === "preflop") {
      // VPIP / PFR
      if (action === "call" && toCall > 0) s.vpipThisHand = true;
      if (action === "bet" || action === "raise") {
        s.vpipThisHand = true;
        s.pfrThisHand = true;
      }
      // toCall>0 catches an all-in CALL; raisesOver catches an all-in RAISE made
      // when the player's bet already matches the current bet (e.g. the BB
      // jamming its option) — a fully voluntary, aggressive open.
      if (action === "allin" && (toCall > 0 || raisesOver)) {
        s.vpipThisHand = true;
        if (raisesOver) s.pfrThisHand = true;
      }
      // Fold-to-3bet, judged for the original opener facing a re-raise.
      if (s.wasPreflopOpener && this.preflopRaiseCount >= 2 && toCall > 0 && !s.faced3betAsRaiser) {
        s.faced3betAsRaiser = true;
        if (action === "fold") s.foldedTo3bet = true;
      }
      // 3-bet opportunity: exactly one prior voluntary raise (the open) stands.
      if (this.preflopRaiseCount === 1 && toCall > 0 && !s.faced3betChance) {
        s.faced3betChance = true;
        if (isAggro) s.made3bet = true;
      }
      // Opener mark + voluntary-raise count (blinds/straddle never reach act()).
      if (isAggro) {
        if (this.preflopRaiseCount === 0) s.wasPreflopOpener = true;
        this.preflopRaiseCount++;
      }
    } else {
      // ── postflop HUD tracking ──
      // Flop c-bet by the preflop aggressor (their first flop decision facing no bet).
      if (this.street === "flop" && s.wasPreflopAggressor && !s.cbetOppResolved && toCall <= 0) {
        s.cbetOppFlop = true;
        s.cbetOppResolved = true;
        if (action === "bet" || (action === "allin" && raisesOver)) {
          s.madeCbetFlop = true;
          this.flopCbetActive = true;
          // Record the c-bet size (becomes the new currentBet). A later RAISE
          // over it makes currentBet exceed this, so players who only ever face
          // the raise are excluded from fold-to-c-bet.
          this.flopCbetAmount = action === "bet" ? amount ?? 0 : s.betThisStreet + s.stack;
        }
      }
      // Fold-to-c-bet by a non-aggressor facing the CLEAN c-bet (currentBet still
      // at the c-bet size — not a raise of it).
      if (
        this.street === "flop" &&
        this.flopCbetActive &&
        !s.wasPreflopAggressor &&
        toCall > 0 &&
        this.currentBet <= this.flopCbetAmount &&
        !s.facedCbetFlop
      ) {
        s.facedCbetFlop = true;
        if (action === "fold") s.foldedToCbetFlop = true;
      }
      // Aggression counters (checks are excluded by convention).
      if (action === "bet") s.pfBets++;
      else if (action === "raise") s.pfRaises++;
      else if (action === "call") s.pfCalls++;
      else if (action === "fold") s.pfFolds++;
      else if (action === "allin") raisesOver ? s.pfRaises++ : s.pfCalls++;
    }

    switch (action) {
      case "fold": {
        this.applyFold(s, false);
        break;
      }
      case "check": {
        if (toCall > 0) return "Can't check facing a bet";
        s.hasActed = true;
        s.lastAction = "Check";
        this.addLog(`${s.name} checks`);
        break;
      }
      case "call": {
        if (toCall <= 0) return "Nothing to call";
        const pay = Math.min(toCall, s.stack);
        this.putChips(s, pay);
        s.hasActed = true;
        if (s.stack === 0) {
          s.allIn = true;
          s.lastAction = `Call ${pay} (all in)`;
          this.addLog(`${s.name} calls ${pay} and is all in`);
        } else {
          s.lastAction = `Call ${pay}`;
          this.addLog(`${s.name} calls ${pay}`);
        }
        break;
      }
      case "bet":
      case "raise": {
        const err = this.applyBetOrRaise(s, amount ?? 0);
        if (err) return err;
        break;
      }
      case "allin": {
        const target = s.betThisStreet + s.stack;
        if (this.currentBet === 0 || s.betThisStreet + s.stack <= this.currentBet) {
          // all-in that just calls (or partial) — treat as call when it doesn't exceed
          if (target <= this.currentBet) {
            const pay = s.stack;
            this.putChips(s, pay);
            s.hasActed = true;
            s.allIn = true;
            s.lastAction = `Call ${pay} (all in)`;
            this.addLog(`${s.name} calls ${pay} and is all in`);
            break;
          }
        }
        const err = this.applyBetOrRaise(s, target, true);
        if (err) return err;
        break;
      }
      default:
        return "Unknown action";
    }

    this.advanceAction();
    return null;
  }

  private putChips(s: Seat, amount: number) {
    const pay = Math.min(amount, s.stack);
    s.stack -= pay;
    s.betThisStreet += pay;
    s.committed += pay;
  }

  private applyFold(s: Seat, silent: boolean) {
    s.folded = true;
    s.hasActed = true;
    s.lastAction = "Fold";
    if (!silent) this.addLog(`${s.name} folds`);
  }

  private applyBetOrRaise(s: Seat, totalTo: number, isAllInShortcut = false): string | null {
    const target = safeInt(totalTo, 0);
    const maxTo = s.betThisStreet + s.stack;
    const toCall = this.currentBet - s.betThisStreet;
    if (!s.mayRaise && this.currentBet > 0 && !isAllInShortcut) {
      return "You can't raise here";
    }
    if (s.stack <= Math.max(0, toCall)) return "Not enough chips to raise";

    let finalTo = target;
    if (finalTo > maxTo) finalTo = maxTo; // clamp to all-in
    const minTo = this.minRaiseTo(s);
    const goingAllIn = finalTo === maxTo;
    if (finalTo < minTo && !goingAllIn) {
      return `Minimum is ${minTo}`;
    }
    // pot-limit ceiling
    const potCap = this.maxRaiseTo(s);
    if (finalTo > potCap) finalTo = potCap;

    const raiseSize = finalTo - this.currentBet;
    const pay = finalTo - s.betThisStreet;
    this.putChips(s, pay);

    const isFullRaise = raiseSize >= this.minRaise || this.currentBet === 0;
    const prevBet = this.currentBet;
    this.currentBet = Math.max(this.currentBet, finalTo);

    if (s.stack === 0) s.allIn = true;
    s.hasActed = true;
    this.lastAggressorSeat = s.index;

    if (isFullRaise) {
      this.minRaise = Math.max(this.minRaise, raiseSize);
      // reopen action for everyone else still able to act
      for (const o of this.canActSeats()) {
        if (o.index !== s.index) {
          o.hasActed = false;
          o.mayRaise = true;
        }
      }
    } else {
      // short all-in: does not reopen betting for players who already acted
      for (const o of this.canActSeats()) {
        if (o.index !== s.index && o.hasActed) o.mayRaise = false;
      }
    }

    const verb = prevBet === 0 ? "bets" : "raises to";
    const allInTag = s.allIn ? " and is all in" : "";
    s.lastAction =
      prevBet === 0
        ? `Bet ${finalTo}${s.allIn ? " (all in)" : ""}`
        : `Raise to ${finalTo}${s.allIn ? " (all in)" : ""}`;
    this.addLog(`${s.name} ${verb} ${finalTo}${allInTag}`);
    return null;
  }

  private minRaiseTo(s: Seat): number {
    if (this.currentBet === 0)
      return Math.min(this.effectiveBlinds().bb, s.betThisStreet + s.stack);
    return this.currentBet + this.minRaise;
  }

  private potTotal(): number {
    return this.occupied().reduce((sum, s) => sum + s.committed, 0);
  }

  private maxRaiseTo(s: Seat): number {
    const nlMax = s.betThisStreet + s.stack;
    if (this.config.variant === "nlhe") return nlMax;
    // pot-limit
    const toCall = this.currentBet - s.betThisStreet;
    const potNow = this.potTotal();
    const plMax = this.currentBet + potNow + Math.max(0, toCall);
    return Math.min(nlMax, plMax);
  }

  // ── action flow ────────────────────────────────────────────────────────────
  private someoneCanAct(): boolean {
    return this.canActSeats().length > 0;
  }

  private needsToAct(s: Seat): boolean {
    return s.inHand && !s.folded && !s.allIn && (!s.hasActed || s.betThisStreet < this.currentBet);
  }

  private advanceAction() {
    // immediate win by folds
    const live = this.livePlayers();
    if (live.length <= 1) {
      this.endHandByFold(live[0]);
      return;
    }

    // find next seat that needs to act, starting after current
    const start = this.toActSeat ?? this.buttonSeat;
    let next: number | null = null;
    for (let i = 1; i <= this.config.maxSeats; i++) {
      const idx = (start + i) % this.config.maxSeats;
      const seat = this.seats[idx];
      if (seat && this.needsToAct(seat)) {
        next = idx;
        break;
      }
    }

    if (next === null) {
      // betting round complete for this street
      this.collectStreet();
      this.advanceStreet();
      return;
    }

    this.toActSeat = next;
    this.bumpSeq();
    this.resetClock();
  }

  private collectStreet() {
    // return uncalled bet to the lone top bettor
    const bets = this.occupied()
      .filter((s) => s.inHand && s.betThisStreet > 0)
      .sort((a, b) => b.betThisStreet - a.betThisStreet);
    if (bets.length >= 1) {
      const top = bets[0];
      const second = bets[1]?.betThisStreet ?? 0;
      if (top.betThisStreet > second) {
        const refund = top.betThisStreet - second;
        top.stack += refund;
        top.committed -= refund;
        top.betThisStreet -= refund;
        if (refund > 0) {
          this.addLog(`Returned uncalled ${refund} to ${top.name}`);
          if (top.allIn && top.stack > 0) top.allIn = false;
        }
      }
    }
    // Capture the preflop aggressor for c-bet tracking before lastAggressorSeat
    // is cleared (the flop-deal step then tags that seat wasPreflopAggressor).
    if (this.street === "preflop") this.preflopAggressorSeat = this.lastAggressorSeat;
    // sweep current-street bets into the pot (committed already holds them)
    for (const s of this.occupied()) {
      s.betThisStreet = 0;
      if (!s.folded) s.hasActed = false;
      s.mayRaise = true;
    }
    this.currentBet = 0;
    this.minRaise = this.effectiveBlinds().bb;
    this.lastAggressorSeat = null;
  }

  private advanceStreet() {
    // if at most one player can still act, run out the board without betting
    const canAct = this.canActSeats();
    const live = this.livePlayers();
    if (live.length <= 1) {
      this.endHandByFold(live[0]);
      return;
    }
    if (canAct.length <= 1) {
      // No more betting possible (everyone left is all-in). Reveal the hands and
      // hand off to a timed run-out so the board comes out one street at a time
      // for suspense, instead of flop+turn+river landing all at once.
      this.beginRunout();
      return;
    }

    switch (this.street) {
      case "preflop":
        this.dealBoard(3);
        this.street = "flop";
        break;
      case "flop":
        this.dealBoard(1);
        this.street = "turn";
        break;
      case "turn":
        this.dealBoard(1);
        this.street = "river";
        break;
      case "river":
        this.goToShowdown();
        return;
      default:
        return;
    }
    // The flop just landed: everyone still live "saw the flop" (WTSD/c-bet
    // denominator), and the captured preflop aggressor is tagged for c-bet.
    if (this.street === "flop") {
      for (const s of this.occupied()) if (s.inHand && !s.folded) s.sawFlop = true;
      if (this.preflopAggressorSeat !== null) {
        const agg = this.seats[this.preflopAggressorSeat];
        if (agg && agg.inHand && !agg.folded) agg.wasPreflopAggressor = true;
      }
    }
    this.addLog(
      `${capitalize(this.street)}: ` +
        this.boards.map((b) => b.map(cardCode).join(" ")).join("  |  ")
    );
    this.startStreetAction();
  }

  private startStreetAction() {
    // first to act postflop = first live seat left of the button
    this.toActSeat = this.nextSeat(this.buttonSeat, (s) => this.needsToAct(s));
    if (this.toActSeat === null) {
      // nobody to act (all all-in) -> proceed
      this.advanceStreet();
      return;
    }
    this.bumpSeq();
    this.resetClock();
  }

  private dealBoard(count: number) {
    for (const board of this.boards) {
      this.deck.pop(); // burn card (one per board)
      for (let i = 0; i < count; i++) board.push(this.deck.pop()!);
    }
  }

  // ── all-in run-out (timed, for suspense) ────────────────────────────────────
  // When betting is closed but the board isn't complete, we don't deal the rest
  // of the board in one shot. Instead we reveal the all-in hands, enter the
  // "runout" phase, and let the driver (server / tournament tick) call
  // runoutStep() once per street so flop → turn → river arrive with a pause
  // between them. finishRunout() takes it to showdown.
  // Snapshot the equity-weighted expected award per pot at the instant betting
  // closes with an incomplete board and >=2 contenders. Stores allInEquityWon
  // per seat so luck = actual − EV can be tracked. Runs at most once per hand
  // (the allInEquityCaptured latch), respecting side-pot eligibility — equity is
  // recomputed among only each pot's eligible seats.
  private captureAllInEquity() {
    if (this.allInEquityCaptured) return;
    const contenders = this.livePlayers(); // inHand && !folded
    if (contenders.length < 2) return;
    if (this.canActSeats().length > 1) return; // betting not actually closed
    this.allInEquityCaptured = true;

    for (const s of contenders) {
      s.wasAllInRunout = true;
      s.sawFlop = true; // a preflop all-in still reaches the board (WTSD)
      s.allInEquityWon = 0;
    }

    const pots = this.computePots();
    const dead: Card[] = [];
    for (const s of this.occupied()) if (s.inHand) dead.push(...s.holeCards);
    for (const b of this.boards) dead.push(...b);

    const omaha = isOmaha(this.config.variant);
    // Deterministic MC seed derived from the hand state (hand #, board, and the
    // contenders' hole cards) so the captured EV/luck is a reproducible, auditable
    // property of the hand — not a fresh crypto draw each call. (The deck SHUFFLE
    // still uses crypto; only this equity estimator must be reproducible, matching
    // the client replay path in LedgerModal.)
    let seed = (this.handNumber * 0x9e3779b1) ^ (this.boards[0]?.length ?? 0);
    for (const s of contenders) {
      seed = (seed * 31 + s.index) | 0;
      for (const card of s.holeCards) seed = (seed * 31 + card.rank * 5 + card.suit.charCodeAt(0)) | 0;
    }
    const seedRng = mulberry32(seed >>> 0);

    for (const pot of pots) {
      const eligible = pot.eligible
        .map((i) => this.seats[i]!)
        .filter((s) => s && s.inHand && !s.folded);
      if (eligible.length === 0) {
        // dead money refunded to contributors — mirror awardPots (same
        // left-of-button odd-chip order) so EV == chips.
        const ordered = this.orderFromButton(
          pot.contributors.map((i) => this.seats[i]!).filter(Boolean)
        );
        const refunds = this.splitInteger(pot.amount, ordered.length);
        ordered.forEach((s, i) => {
          s.allInEquityWon += refunds[i];
        });
        continue;
      }
      if (eligible.length === 1) {
        eligible[0].allInEquityWon += pot.amount;
        continue;
      }
      // recompute equity AMONG THIS POT'S ELIGIBLE SEATS ONLY (side-pot correct).
      // 5k Monte-Carlo samples (only ever hit on a preflop all-in; flop/turn
      // enumerate exactly) — luck averages over a session, so per-hand noise of
      // ~0.7% is immaterial and this keeps an all-in resolution well under ~20ms.
      const res = computeEquity(
        eligible.map((s) => ({ id: s.index, holeCards: s.holeCards })),
        this.boards,
        dead,
        { omaha, holeCount: 2, hiLo: isHiLo(this.config.variant), rng: seedRng, mcSamples: 5000 }
      );
      for (const s of eligible) {
        s.allInEquityWon += (res.equity.get(s.index) ?? 0) * pot.amount;
      }
    }
  }

  private beginRunout() {
    this.captureAllInEquity(); // board still as-stands — the moment betting closed
    // reveal every player still in the hand — all-in hands turn face up
    const contenders = this.livePlayers();
    if (contenders.length > 1) for (const s of contenders) s.revealed = true;

    // Run It Twice: split into two boards sharing the cards already dealt; the
    // remaining streets then run out independently on each (handled by dealBoard,
    // which advances every board).
    if (
      this.config.runItTwice &&
      !this.config.doubleBoard &&
      this.boards.length === 1 &&
      this.boards[0].length < 5 &&
      contenders.length >= 2
    ) {
      const common = [...this.boards[0]];
      this.boards = [common, [...common]];
      this.addLog("Running it twice");
    }

    this.toActSeat = null;
    this.actionDeadline = null;

    if (this.boards[0].length >= 5) {
      // all-in happened on the river — nothing left to deal, go straight to it
      this.goToShowdown();
      return;
    }
    this.phase = "runout";
    this.bumpSeq();
  }

  // Deal the next street of the run-out. Returns true if more streets remain.
  runoutStep(): boolean {
    if (this.phase !== "runout") return false;
    const need = this.boards[0].length === 0 ? 3 : 1;
    this.dealBoard(need);
    const len = this.boards[0].length;
    this.street = len >= 5 ? "river" : len === 4 ? "turn" : "flop";
    this.addLog(
      `${capitalize(this.street)}: ` +
        this.boards.map((b) => b.map(cardCode).join(" ")).join("  |  ")
    );
    this.bumpSeq();
    return this.boards[0].length < 5;
  }

  // Board complete — resolve the showdown.
  finishRunout() {
    if (this.phase !== "runout") return;
    this.goToShowdown();
  }

  // ── showdown ───────────────────────────────────────────────────────────────
  private goToShowdown() {
    this.street = "showdown";
    this.phase = "showdown";
    this.toActSeat = null;
    this.actionDeadline = null;
    const contenders = this.livePlayers();
    // reveal all contenders (contested showdown)
    if (contenders.length > 1) {
      for (const s of contenders) s.revealed = true;
      for (const s of contenders) s.wentToShowdown = true;
    }
    // River all-in case: capture equity on the (now complete) board. The guard
    // makes this a no-op if the runout already snapshotted; on a normal river
    // showdown the canActSeats>1 check inside means nothing is captured.
    this.captureAllInEquity();
    this.awardPots();
    this.bumpSeq();
  }

  private computePots(): Pot[] {
    const contribs = this.occupied()
      .filter((s) => s.committed > 0)
      .map((s) => ({ seat: s.index, amount: s.committed, folded: s.folded }));
    return this.computePotsFrom(contribs);
  }

  private computePotsFrom(contribs: { seat: number; amount: number; folded: boolean }[]): Pot[] {
    if (contribs.length === 0) return [];
    const levels = [...new Set(contribs.map((c) => c.amount))].sort((a, b) => a - b);
    const pots: Pot[] = [];
    let prev = 0;
    for (const lvl of levels) {
      const layer = lvl - prev;
      const contributors = contribs.filter((c) => c.amount >= lvl);
      const amount = layer * contributors.length;
      const eligible = contributors.filter((c) => !c.folded).map((c) => c.seat);
      if (amount > 0) {
        pots.push({ amount, eligible, contributors: contributors.map((c) => c.seat) });
      }
      prev = lvl;
    }
    // merge adjacent pots that share the same (non-empty) eligible set; never
    // merge dead (empty-eligible) layers so they can be refunded exactly.
    const merged: Pot[] = [];
    for (const p of pots) {
      const last = merged[merged.length - 1];
      if (last && p.eligible.length > 0 && sameSet(last.eligible, p.eligible)) {
        last.amount += p.amount;
      } else {
        merged.push({ ...p });
      }
    }
    return merged;
  }

  private callPotOddsPct(s: Seat): number | null {
    const call = Math.min(Math.max(0, this.currentBet - s.betThisStreet), s.stack);
    if (call <= 0) return null;
    const contribs = this.occupied()
      .map((seat) => ({
        seat: seat.index,
        amount: seat.committed + (seat.index === s.index ? call : 0),
        folded: seat.folded,
      }))
      .filter((c) => c.amount > 0);
    const winnable = this.computePotsFrom(contribs)
      .filter((pot) => pot.eligible.includes(s.index))
      .reduce((sum, pot) => sum + pot.amount, 0);
    return winnable > 0 ? Math.round((call / winnable) * 100) : null;
  }

  // The seat's hole cards for evaluation — falls back to lastHole so showdown
  // hand-labels still resolve during the between phase, after the live cards
  // have been cleared.
  private holeOf(seat: Seat): Card[] {
    return seat.holeCards.length ? seat.holeCards : seat.lastHole ?? [];
  }

  private bestHigh(seat: Seat, board: Card[]): HandScore {
    const hole = this.holeOf(seat);
    if (isOmaha(this.config.variant)) return evaluateOmaha(hole, board);
    return evaluateBest([...hole, ...board]);
  }

  private bestLow(seat: Seat, board: Card[]): number[] | null {
    const hole = this.holeOf(seat);
    if (isOmaha(this.config.variant)) return evaluateOmahaLow(hole, board);
    return evaluateLow5([...hole, ...board]);
  }

  // Split `amount` into `parts` integer shares, distributing the remainder to
  // the first shares (board 0 first).
  private splitInteger(amount: number, parts: number): number[] {
    const base = Math.floor(amount / parts);
    let rem = amount - base * parts;
    return Array.from({ length: parts }, () => {
      const extra = rem > 0 ? 1 : 0;
      rem -= extra;
      return base + extra;
    });
  }

  private awardPots() {
    const pots = this.computePots();
    const hiLo = isHiLo(this.config.variant);
    const boards = this.boards;
    const nBoards = boards.length;
    const winnings = new Map<number, number>();

    for (const pot of pots) {
      const eligible = pot.eligible
        .map((i) => this.seats[i]!)
        .filter((s) => s && s.inHand && !s.folded);
      if (eligible.length === 0) {
        // dead money (uncalled chips from folded over-committers) — refund it
        // to the players who put it in. Odd chips follow the same left-of-button
        // order as a normal split (see distribute) for fairness.
        const ordered = this.orderFromButton(
          pot.contributors.map((i) => this.seats[i]!).filter(Boolean)
        );
        const refunds = this.splitInteger(pot.amount, ordered.length);
        ordered.forEach((s, i) => addWin(winnings, s.index, refunds[i]));
        continue;
      }
      if (eligible.length === 1) {
        addWin(winnings, eligible[0].index, pot.amount);
        continue;
      }

      // split this pot across every board (run-it-twice / double board)
      const boardShares = this.splitInteger(pot.amount, nBoards);
      boards.forEach((board, bi) => {
        const share = boardShares[bi];
        if (share <= 0) return;
        if (hiLo) {
          const lows = eligible
            .map((s) => ({ s, low: this.bestLow(s, board) }))
            .filter((x) => x.low !== null) as { s: Seat; low: number[] }[];
          const hasLow = lows.length > 0;
          // Odd chip on a hi/lo split goes to the HIGH hand (standard poker
          // convention — the high always exists, the low may not).
          const lowShare = hasLow ? Math.floor(share / 2) : 0;
          const highShare = share - lowShare;
          this.distribute(eligible, highShare, winnings, (a, b) =>
            compareScore(this.bestHigh(a, board).tuple, this.bestHigh(b, board).tuple)
          );
          if (hasLow && lowShare > 0) {
            this.distribute(lows.map((x) => x.s), lowShare, winnings, (a, b) =>
              -compareLow(this.bestLow(a, board)!, this.bestLow(b, board)!)
            );
          }
        } else {
          this.distribute(eligible, share, winnings, (a, b) =>
            compareScore(this.bestHigh(a, board).tuple, this.bestHigh(b, board).tuple)
          );
        }
      });
    }

    // apply winnings
    for (const [seatIdx, amount] of winnings) {
      const s = this.seats[seatIdx]!;
      s.stack += amount;
      s.wonAmount += amount;
      s.winner = amount > 0;
    }

    // log results
    for (const [seatIdx, amount] of winnings) {
      const s = this.seats[seatIdx]!;
      const label = s.revealed && boards.length === 1 ? ` with ${this.bestHigh(s, boards[0]).label}` : "";
      this.addLog(`${s.name} wins ${amount}${label}`);
    }

    // 7-2 bounty payout (G4) and chip cleanup
    this.payBounties(winnings);
    for (const s of this.occupied()) s.committed = 0;
  }

  // 7-2 bounty: a player who wins a pot holding 7 and 2 collects a bounty from
  // every other player dealt into the hand. Free, host-set amount.
  private payBounties(winnings: Map<number, number>) {
    const bounty = this.config.sevenDeuce;
    if (bounty <= 0) return;
    for (const [seatIdx, amount] of winnings) {
      if (amount <= 0) continue;
      const winner = this.seats[seatIdx]!;
      const ranks = winner.holeCards.map((c) => c.rank).sort((a, b) => a - b);
      // exactly a 7 and a 2 (Hold'em hole cards) — the classic 7-2 bounty
      const has72 = ranks.length === 2 && ranks[0] === 2 && ranks[1] === 7;
      if (!has72) continue;
      winner.bounty = true;
      for (const other of this.occupied()) {
        if (other.index === seatIdx || !other.inHand) continue;
        const pay = Math.min(bounty, other.stack);
        if (pay <= 0) continue;
        other.stack -= pay;
        winner.stack += pay;
        winner.wonAmount += pay;
        winner.bountyWon += pay; // side transfer, not pot equity
      }
      this.addLog(`${winner.name} collects the 7-2 bounty!`);
    }
  }

  // distribute `amount` among the best hands in `pool` (by comparator, higher
  // is better), splitting ties and pushing odd chips to seats left of button.
  private distribute(
    pool: Seat[],
    amount: number,
    winnings: Map<number, number>,
    cmp: (a: Seat, b: Seat) => number
  ) {
    if (amount <= 0 || pool.length === 0) return;
    let best = pool[0];
    for (const s of pool) if (cmp(s, best) > 0) best = s;
    const winners = pool.filter((s) => cmp(s, best) === 0);
    const order = this.orderFromButton(winners);
    const base = Math.floor(amount / winners.length);
    let remainder = amount - base * winners.length;
    for (const w of order) {
      let share = base;
      if (remainder > 0) {
        share += 1;
        remainder -= 1;
      }
      addWin(winnings, w.index, share);
    }
  }

  private orderFromButton(seats: Seat[]): Seat[] {
    const n = this.config.maxSeats;
    return [...seats].sort((a, b) => {
      const da = (a.index - this.buttonSeat - 1 + n) % n;
      const db = (b.index - this.buttonSeat - 1 + n) % n;
      return da - db;
    });
  }

  private endHandByFold(winner: Seat | undefined) {
    this.collectStreetForFold();
    if (winner) {
      const pot = this.potTotal();
      winner.stack += pot;
      winner.wonAmount += pot;
      winner.winner = true;
      this.addLog(`${winner.name} wins ${pot}`);
      this.payBounties(new Map([[winner.index, pot]]));
      for (const s of this.occupied()) s.committed = 0;
    }
    this.street = "showdown";
    this.phase = "showdown";
    this.toActSeat = null;
    this.actionDeadline = null;
    this.bumpSeq();
  }

  private collectStreetForFold() {
    // return uncalled portion before awarding (fold to a bet)
    const bettors = this.occupied()
      .filter((s) => s.betThisStreet > 0)
      .sort((a, b) => b.betThisStreet - a.betThisStreet);
    if (bettors.length >= 1) {
      const top = bettors[0];
      const second = bettors[1]?.betThisStreet ?? 0;
      const refund = top.betThisStreet - second;
      if (refund > 0) {
        top.stack += refund;
        top.committed -= refund;
        top.betThisStreet -= refund;
      }
    }
    for (const s of this.occupied()) s.betThisStreet = 0;
  }

  // ── between-hands lifecycle ────────────────────────────────────────────────
  finishHand() {
    // called by the server after the showdown display delay
    this.captureHandSummary();
    this.updateStats();
    this.processEliminations();
    this.phase = "between";
    this.street = "idle";
    this.toActSeat = null;
    this.actionDeadline = null;
    // remove busted players' chips state; they stay seated but sitting out at 0
    for (const s of this.occupied()) {
      s.inHand = false;
      // Retain this hand's hole cards so a player can voluntarily show them
      // during the showdown/between window (cleared on the next deal). Already
      // revealed (showdown) hands keep showing; others stay hidden until shown.
      if (s.holeCards.length) s.lastHole = s.holeCards.slice();
      s.holeCards = [];
      s.betThisStreet = 0;
      // The hand is over: nobody is "all in" any more. Clearing it here (rather
      // than waiting for the next deal's resetSeatForHand) stops a stale ALL IN
      // badge lingering on a pod whose cards have been cleared — most visibly on
      // a player who busted all-in heads-up, where no next hand ever starts.
      s.allIn = false;
      if (s.stack <= 0) s.sittingOut = true;
    }
    this.bumpSeq();
  }

  // ── timers ─────────────────────────────────────────────────────────────────
  private resetClock() {
    this.actionDeadline = this.now() + this.config.actionTimeSec * 1000;
    this.shortenDisconnectedActionClock();
  }

  private shortenDisconnectedActionClock() {
    if (this.phase !== "hand" || this.toActSeat === null || this.actionDeadline === null) return;
    const s = this.seats[this.toActSeat];
    if (!s || s.connected) return;
    this.actionDeadline = Math.min(this.actionDeadline, this.now() + DISCONNECTED_ACTION_GRACE_MS);
  }

  timeoutCurrent(): boolean {
    if (this.phase !== "hand" || this.toActSeat === null) return false;
    const s = this.seats[this.toActSeat];
    if (!s) return false;
    // use the time bank before timing out, if any remains
    if (s.timeBankMs > 0 && this.config.timeBankSec > 0) {
      s.timeBankMs = 0;
      this.actionDeadline = this.now() + this.config.timeBankSec * 1000;
      this.shortenDisconnectedActionClock();
      this.addLog(`${s.name} is into the time bank`);
      return true;
    }
    // Auto-act so the table never stalls, but keep the player in their seat and
    // in the next hand — no "away"/sit-out. Check when it's free, otherwise fold.
    const toCall = this.currentBet - s.betThisStreet;
    if (toCall <= 0) {
      this.addLog(`${s.name} checks (timed out)`);
      s.hasActed = true;
      s.lastAction = "Check (timeout)";
    } else {
      this.applyFold(s, false);
      s.lastAction = "Fold (timeout)";
    }
    this.advanceAction();
    return true;
  }

  private bumpSeq() {
    this.actionSeq++;
  }

  // ── advanced features (G4) entry points (wired in later waves) ─────────────
  requestRabbit(playerId: string): string | null {
    if (!this.config.rabbitHunt) return "Rabbit hunt is off";
    if (this.phase !== "showdown" && this.phase !== "between") return "No hand to rabbit";
    if (this.boards[0].length >= 5) return "Board already complete";
    if (!this.seatOf(playerId)) return "Not seated";
    if (this.rabbitCards) return null; // already revealed
    // deal out the rest of the board exactly as the dealer would have
    const tmp = [...this.deck];
    const run = [...this.boards[0]];
    while (run.length < 5 && tmp.length > 0) {
      tmp.pop(); // burn (one per street)
      const need = run.length === 0 ? 3 : 1;
      for (let i = 0; i < need && tmp.length > 0; i++) run.push(tmp.pop()!);
    }
    this.rabbitCards = run.slice(this.boards[0].length);
    this.addLog(`Rabbit hunt: ${this.rabbitCards.map(cardCode).join(" ")}`);
    return null;
  }

  // Voluntarily reveal one's own cards after a hand. Available during the
  // showdown/between window to anyone who was dealt in this hand — including a
  // player who folded (so they can show a bluff). Idempotent once shown.
  showCards(playerId: string): string | null {
    if (this.phase !== "showdown" && this.phase !== "between") return "No hand to show";
    const s = this.seatOf(playerId);
    if (!s) return "Not seated";
    if (s.revealed) return null; // already showing
    const cards = s.holeCards.length ? s.holeCards : s.lastHole;
    if (!cards || cards.length === 0) return "No cards to show";
    s.revealed = true;
    this.addLog(`${s.name} shows ${cards.map(cardCode).join(" ")}`);
    // Between hands the summary for this hand was already captured (at finishHand)
    // with this seat still hidden, so a voluntary show wouldn't survive into the
    // saved hand history. Backfill the just-shown cards into that record so the
    // reveal is durable in Ledger & history, not just on the live felt.
    if (this.phase === "between") {
      const summary = this.handHistories[this.handHistories.length - 1];
      if (summary && summary.handNumber === this.handNumber) {
        const row = summary.players.find((p) => p.seat === s.index);
        if (row && !row.holeCards) row.holeCards = cards.slice();
      }
    }
    this.bumpSeq();
    return null;
  }

  // ── snapshot (redacted per viewer) ─────────────────────────────────────────
  // Compute the viewer-INDEPENDENT parts of a snapshot once. broadcast() reuses
  // this across every connection instead of recomputing pots, ledger, stats, and
  // showdown hand-labels per viewer (snapshotFor is otherwise O(connections) on
  // all of that). Only per-seat card redaction + the to-act viewer's legal
  // actions remain viewer-specific.
  snapshotShared(): SharedSnapshot {
    const pots = this.computePots();
    const publicPots: PublicPot[] = pots.map((p, idx) => ({
      amount: p.amount,
      label: pots.length === 1 ? "Pot" : idx === 0 ? "Main pot" : `Side pot ${idx}`,
    }));
    const ledger = this.ledgerRows();
    const stats = this.statsRows(ledger);
    const seatHandLabels: (string | null)[] = new Array(this.config.maxSeats).fill(null);
    if (this.boards.length === 1 && this.boards[0].length === 5) {
      for (let i = 0; i < this.config.maxSeats; i++) {
        const s = this.seats[i];
        if (s && s.revealed) seatHandLabels[i] = this.bestHigh(s, this.boards[0]).label;
      }
    }
    return {
      publicPots,
      totalPot: this.potTotal(),
      ledger,
      stats,
      tourney: this.tourneyState(),
      handCount: this.handHistories.length,
      canStart: this.canStart(),
      seatedCount: this.occupied().length,
      log: this.log.slice(-300),
      chat: this.chat.slice(-200),
      boards: this.boards.map((b) => [...b]),
      seatHandLabels,
    };
  }

  snapshotFor(
    viewerId: string | null,
    shared: SharedSnapshot = this.snapshotShared()
  ): PublicTableState {
    const viewerSeat = viewerId ? this.seatOf(viewerId) : null;
    const isSpectator = !viewerSeat;
    const seats: PublicSeat[] = [];
    for (let i = 0; i < this.config.maxSeats; i++) {
      const s = this.seats[i];
      if (!s) {
        seats.push(emptySeat(i));
        continue;
      }
      const isSelf = viewerId !== null && s.playerId === viewerId;
      // Spectators (when the host enables face-up viewing) see only LIVE hands —
      // a folded player's hole cards are mucked and stay hidden, matching the
      // "never learn a card you aren't entitled to" invariant.
      const spectatorPeek =
        isSpectator && this.config.spectatorsSeeCards && s.inHand && !s.folded;
      const showCards = isSelf || s.revealed || spectatorPeek;
      // Between hands the live holeCards are cleared, but lastHole still holds
      // the just-played cards so a shown hand (or your own) stays visible.
      const cards = s.holeCards.length > 0 ? s.holeCards : s.lastHole ?? [];
      seats.push({
        index: i,
        empty: false,
        playerId: s.playerId,
        name: s.name,
        stack: s.stack,
        sittingOut: s.sittingOut,
        connected: s.connected,
        inHand: s.inHand,
        folded: s.folded,
        allIn: s.allIn,
        betThisStreet: s.betThisStreet,
        hasCards: s.inHand && s.holeCards.length > 0 && !s.folded,
        holeCards: showCards && cards.length > 0 ? cards : null,
        cardCount: cards.length,
        isButton: i === this.buttonSeat && this.phase !== "lobby",
        isSmallBlind: i === this.sbSeat && this.phase === "hand",
        isBigBlind: i === this.bbSeat && this.phase === "hand",
        isToAct: i === this.toActSeat,
        isStraddle: i === this.straddleSeat && this.phase === "hand",
        revealed: s.revealed,
        handLabel: shared.seatHandLabels[i],
        micOn: s.micOn,
        camOn: s.camOn,
        lastAction: s.lastAction,
        winner: s.winner,
        wonAmount: s.wonAmount,
        timeLeftMs:
          i === this.toActSeat && this.actionDeadline
            ? Math.max(0, this.actionDeadline - this.now())
            : null,
        bounty: s.bounty,
      });
    }

    let legalActions: LegalAction[] = [];
    let callAmount = 0;
    let callPotOddsPct: number | null = null;
    let minRaiseTo = 0;
    let maxRaiseTo = 0;
    if (viewerSeat && this.toActSeat === viewerSeat.index && this.phase === "hand") {
      legalActions = this.legalActionsFor(viewerSeat);
      callAmount = Math.max(0, this.currentBet - viewerSeat.betThisStreet);
      callPotOddsPct = this.callPotOddsPct(viewerSeat);
      minRaiseTo = this.minRaiseTo(viewerSeat);
      maxRaiseTo = this.maxRaiseTo(viewerSeat);
    }

    return {
      roomId: this.roomId,
      config: this.config,
      variant: this.config.variant,
      hostId: this.hostId,
      youId: viewerId,
      yourSeat: viewerSeat?.index ?? null,
      isSpectator,
      phase: this.phase,
      street: this.street,
      handNumber: this.handNumber,
      buttonSeat: this.buttonSeat,
      seats,
      boards: shared.boards,
      pots: shared.publicPots,
      totalPot: shared.totalPot,
      currentBet: this.currentBet,
      toActSeat: this.toActSeat,
      actionDeadline: this.actionDeadline,
      legalActions,
      callAmount,
      callPotOddsPct,
      minRaiseTo,
      maxRaiseTo,
      potForBet: shared.totalPot,
      log: shared.log,
      chat: shared.chat,
      canStart: shared.canStart,
      paused: this.paused,
      seatedCount: shared.seatedCount,
      handInProgress: this.phase === "hand",
      settingsQueued: this.pendingConfig !== null,
      actionSeq: this.actionSeq,
      rabbitAvailable:
        this.config.rabbitHunt &&
        (this.phase === "showdown" || this.phase === "between") &&
        this.boards[0].length < 5,
      lastHandRabbit: this.rabbitCards,
      ledger: shared.ledger,
      stats: shared.stats,
      handCount: shared.handCount,
      tourney: shared.tourney,
    };
  }

  // full structured history for replay + download (server-side accessor)
  getHistories(): HandSummary[] {
    return this.handHistories;
  }

  private legalActionsFor(s: Seat): LegalAction[] {
    const actions: LegalAction[] = [];
    const toCall = this.currentBet - s.betThisStreet;
    if (toCall <= 0) {
      actions.push({ type: "check" });
    } else {
      actions.push({ type: "fold" });
      actions.push({ type: "call", amount: Math.min(toCall, s.stack) });
    }
    const canAggress = s.stack > Math.max(0, toCall) && (s.mayRaise || this.currentBet === 0);
    if (canAggress) {
      const min = this.minRaiseTo(s);
      const max = this.maxRaiseTo(s);
      if (max >= min) {
        actions.push({ type: this.currentBet === 0 ? "bet" : "raise", min, max });
      }
    }
    return actions;
  }
}

// ── small helpers ────────────────────────────────────────────────────────────
function emptySeat(i: number): PublicSeat {
  return {
    index: i,
    empty: true,
    playerId: null,
    name: "",
    stack: 0,
    sittingOut: false,
    connected: false,
    inHand: false,
    folded: false,
    allIn: false,
    betThisStreet: 0,
    hasCards: false,
    holeCards: null,
    cardCount: 0,
    isButton: false,
    isSmallBlind: false,
    isBigBlind: false,
    isToAct: false,
    isStraddle: false,
    revealed: false,
    handLabel: null,
    micOn: false,
    camOn: false,
    lastAction: null,
    winner: false,
    wonAmount: 0,
    timeLeftMs: null,
    bounty: false,
  };
}

// Coerce any client-supplied number to a safe integer; non-finite -> fallback.
function safeInt(v: number, fallback = 0): number {
  return Number.isFinite(v) ? Math.floor(v) : fallback;
}

function addWin(m: Map<number, number>, seat: number, amount: number) {
  m.set(seat, (m.get(seat) ?? 0) + amount);
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export type { GameVariant };
