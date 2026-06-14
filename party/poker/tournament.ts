// Multi-table tournament coordinator (G9 MTT). Owns several PokerEngine tables,
// shares one escalating blind schedule, eliminates busted players globally,
// breaks/consolidates tables as the field shrinks, and pays out by place. A
// single-table tournament (Sit & Go) is just the N=1 case.

import { PokerEngine } from "./engine";
import { type TableConfig, TOURNEY_SCHEDULE, payoutStructure } from "../../common/config";
import type { PublicTableState, TourneyState, TourneyStanding } from "../../common/protocol";
import { SHOWDOWN_DELAY_MS, RUNOUT_STEP_MS } from "../timings";

interface Table {
  engine: PokerEngine;
  nextHandAt: number | null;
  runoutNextAt: number | null;
}

export class Tournament {
  tables: Table[] = [];
  finished = false;
  standings: TourneyStanding[] = [];
  private level = 0;
  private levelEndsAt: number;
  private readonly levelMs: number;
  private readonly startingStack: number;
  private readonly entrantCount: number;
  private readonly cap: number;
  private eliminated: { playerId: string; name: string; place: number }[] = [];
  // O(1) lookups, rebuilt whenever table membership changes (reindex). Player
  // membership is frozen between ticks, so these stay consistent.
  private playerEngine = new Map<string, PokerEngine>();
  private placeByPid = new Map<string, number>();

  constructor(
    private readonly roomId: string,
    private readonly config: TableConfig,
    registrants: { playerId: string; name: string }[],
    private readonly now: () => number
  ) {
    this.startingStack = config.tourneyStartingStack;
    this.levelMs = config.tourneyLevelSec * 1000;
    this.cap = Math.max(2, Math.min(config.tourneyTableSize, 10));
    this.entrantCount = registrants.length;
    this.levelEndsAt = now() + this.levelMs;
    this.buildTables(registrants);
  }

  private blinds() {
    return TOURNEY_SCHEDULE[Math.min(this.level, TOURNEY_SCHEDULE.length - 1)];
  }

  private newEngine(seats = this.cap): PokerEngine {
    const b = this.blinds();
    return new PokerEngine(
      this.roomId,
      { ...this.config, maxSeats: seats, smallBlind: b.smallBlind, bigBlind: b.bigBlind, ante: b.ante },
      this.now
    );
  }

  private buildTables(players: { playerId: string; name: string }[]) {
    const nTables = Math.max(1, Math.ceil(players.length / this.cap));
    for (let i = 0; i < nTables; i++)
      this.tables.push({ engine: this.newEngine(), nextHandAt: null, runoutNextAt: null });
    players.forEach((p, i) => {
      this.tables[i % nTables].engine.putInForMove(p.playerId, p.name, this.startingStack);
    });
    for (const t of this.tables) this.startTableHand(t);
    this.reindex();
  }

  // Rebuild the player->engine index. Called after any table-membership change
  // (construction, eliminations, table breaks/merges).
  private reindex() {
    this.playerEngine.clear();
    for (const t of this.tables) {
      for (const p of t.engine.occupiedPlayers()) this.playerEngine.set(p.playerId, t.engine);
    }
  }

  private startTableHand(t: Table) {
    const e = t.engine;
    if (e.phase === "hand") return;
    const withChips = e.occupiedPlayers().filter((p) => p.stack > 0);
    if (withChips.length >= 2) {
      const b = this.blinds();
      e.setBlinds(b.smallBlind, b.bigBlind, b.ante);
      e.startHand();
      t.nextHandAt = null;
    }
  }

  private engineFor(playerId: string): PokerEngine | null {
    return this.playerEngine.get(playerId) ?? null;
  }

  // ── server-facing API ──────────────────────────────────────────────────────
  act(playerId: string, action: Parameters<PokerEngine["act"]>[1], amount: number | undefined, seq: number) {
    return this.engineFor(playerId)?.act(playerId, action, amount, seq) ?? "Not in this tournament";
  }
  chat(playerId: string, name: string, text: string) {
    this.engineFor(playerId)?.addChat(playerId, name, text);
  }
  setConnected(playerId: string, connected: boolean) {
    this.engineFor(playerId)?.setConnected(playerId, connected);
  }

  // players still in the tournament = everyone still seated at any table
  // (a player all-in mid-hand has stack 0 but is NOT out until the hand resolves)
  private remainingPlayers(): number {
    return this.tables.reduce((n, t) => n + t.engine.occupiedPlayers().length, 0);
  }

  private isIdle(e: PokerEngine): boolean {
    return e.phase === "between" || e.phase === "lobby";
  }

  // Eliminate busted players, break/merge tables, finish when one remains.
  private reconcile() {
    // 1. eliminate busted players — only on fully-resolved (idle) tables, so a
    // mid-hand all-in (stack 0) is never mistaken for a bust. Finishing place =
    // number of players still in the tournament at the moment of busting.
    for (const t of this.tables) {
      if (!this.isIdle(t.engine)) continue;
      for (const p of t.engine.occupiedPlayers()) {
        if (p.stack <= 0) {
          const place = this.entrantCount - this.eliminated.length;
          this.eliminated.push({ playerId: p.playerId, name: p.name, place });
          this.placeByPid.set(p.playerId, place);
          t.engine.takeOutForMove(p.playerId);
        }
      }
    }
    this.reindex(); // eliminations changed membership

    const anyActive = this.tables.some((t) => !this.isIdle(t.engine));
    const remaining = this.remainingPlayers();
    if (!anyActive && remaining <= 1) {
      this.finish();
      return;
    }

    // 2. consolidate: if the whole field fits one table, merge to a final table
    if (!anyActive && remaining <= this.cap && this.tables.length > 1) {
      this.mergeToFinalTable();
      return;
    }

    // 3. break a table that can't continue (1 player) into open seats elsewhere
    for (const t of this.tables) {
      if (!this.isIdle(t.engine)) continue;
      const players = t.engine.occupiedPlayers();
      if (players.length === 1 && this.tables.length > 1) {
        this.movePlayers(t, players.map((p) => ({ ...p })));
      }
    }
    this.tables = this.tables.filter((t) => t.engine.occupiedPlayers().length > 0);
  }

  private movePlayers(from: Table, players: { playerId: string; name: string; stack: number }[]) {
    for (const p of players) {
      const target = this.tables.find(
        (t) => t !== from && t.engine.phase !== "hand" && t.engine.occupiedPlayers().length < this.cap
      );
      if (!target) continue;
      const taken = from.engine.takeOutForMove(p.playerId);
      if (taken) target.engine.putInForMove(p.playerId, taken.name, taken.stack);
    }
    this.reindex();
  }

  private mergeToFinalTable() {
    const all: { playerId: string; name: string; stack: number }[] = [];
    for (const t of this.tables) {
      for (const p of t.engine.occupiedPlayers().filter((x) => x.stack > 0)) {
        t.engine.takeOutForMove(p.playerId);
        all.push(p);
      }
    }
    // size the final table to fit everyone, so no player (and no chips) is dropped
    const final = {
      engine: this.newEngine(Math.max(this.cap, all.length)),
      nextHandAt: null,
      runoutNextAt: null,
    };
    for (const p of all) final.engine.putInForMove(p.playerId, p.name, p.stack);
    this.tables = [final];
    this.reindex();
  }

  private finish() {
    this.finished = true;
    // winner = the last player with chips
    let winner: { playerId: string; name: string } | null = null;
    for (const t of this.tables) {
      const w = t.engine.occupiedPlayers().find((p) => p.stack > 0);
      if (w) winner = { playerId: w.playerId, name: w.name };
    }
    const prizePool = this.startingStack * this.entrantCount;
    const structure = payoutStructure(this.entrantCount);
    const order: { playerId: string; name: string }[] = [];
    if (winner) order.push(winner);
    for (const e of [...this.eliminated].sort((a, b) => a.place - b.place)) {
      order.push({ playerId: e.playerId, name: e.name });
    }
    this.standings = order.map((p, i) => ({
      place: i + 1,
      name: p.name,
      payout: Math.round((structure[i] ?? 0) * prizePool),
    }));
  }

  // Drive timers/hands across all tables. Returns true if anything changed.
  tick(): boolean {
    if (this.finished) return false;
    const t0 = this.now();
    let changed = false;

    if (t0 >= this.levelEndsAt) {
      if (this.level < TOURNEY_SCHEDULE.length - 1) this.level++;
      this.levelEndsAt = t0 + this.levelMs;
      changed = true;
    }

    for (const t of this.tables) {
      const e = t.engine;
      if (e.phase === "hand" && e.actionDeadline && t0 >= e.actionDeadline + 250) {
        if (e.timeoutCurrent()) changed = true;
      }
      if (e.phase === "runout") {
        // run the all-in board out one street per RUNOUT_STEP_MS, then showdown
        if (t.runoutNextAt === null) {
          t.runoutNextAt = t0 + RUNOUT_STEP_MS;
          changed = true;
        } else if (t0 >= t.runoutNextAt) {
          const more = e.runoutStep();
          if (!more) e.finishRunout();
          t.runoutNextAt = more ? t0 + RUNOUT_STEP_MS : null;
          changed = true;
        }
      }
      if (e.phase === "showdown" && t.nextHandAt === null) {
        t.nextHandAt = t0 + SHOWDOWN_DELAY_MS;
        changed = true;
      }
      if (t.nextHandAt !== null && t0 >= t.nextHandAt) {
        e.finishHand();
        t.nextHandAt = null;
        changed = true;
      }
    }

    this.reconcile();
    if (!this.finished) {
      for (const t of this.tables) {
        if (t.engine.phase !== "hand" && t.nextHandAt === null) {
          const before = t.engine.handNumber;
          this.startTableHand(t);
          if (t.engine.handNumber !== before) changed = true;
        }
      }
    }
    return changed || this.finished;
  }

  nextDeadline(): number | null {
    if (this.finished) return null;
    return this.levelEndsAt;
  }

  isPlayerIn(playerId: string): boolean {
    return this.engineFor(playerId) !== null;
  }

  snapshotFor(playerId: string | null): PublicTableState {
    const myEngine = playerId ? this.engineFor(playerId) : null;
    const tableIdx = myEngine ? this.tables.findIndex((t) => t.engine === myEngine) : 0;
    const engine = myEngine ?? this.tables[0]?.engine;
    const snap = engine.snapshotFor(playerId);
    const place = playerId ? this.placeByPid.get(playerId) ?? null : null;
    const tourney: TourneyState = {
      active: !this.finished,
      level: this.level + 1,
      smallBlind: this.blinds().smallBlind,
      bigBlind: this.blinds().bigBlind,
      ante: this.blinds().ante,
      levelEndsAt: this.levelEndsAt,
      playersLeft: this.remainingPlayers(),
      startingStack: this.startingStack,
      prizePool: this.startingStack * this.entrantCount,
      finished: this.finished,
      standings: this.standings,
      multiTable: true,
      tablesLeft: this.tables.length,
      entrants: this.entrantCount,
      yourTable: tableIdx + 1,
      yourPlace: place,
    };
    return { ...snap, tourney };
  }
}
