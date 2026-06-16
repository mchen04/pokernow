import type * as Party from "partykit/server";
import { PokerEngine } from "./poker/engine";
import { Tournament } from "./poker/tournament";
import { DEFAULT_CONFIG, sanitizeConfig } from "../common/config";
import type { ClientMessage, ServerMessage } from "../common/protocol";
import { olog, MAX_MESSAGE_BYTES, type LogLevel } from "./log";
import { SHOWDOWN_DELAY_MS, RUNOUT_STEP_MS } from "./timings";

interface ConnState {
  playerId: string | null;
  name: string;
}

const NEXT_HAND_DELAY_MS = 1500;
const RUNOUT_REVEAL_MS = 1200; // beat to register the revealed all-in hands

// Boundary coercion for untrusted client input.
function asInt(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
}
function asStr(v: unknown, max: number): string {
  return (typeof v === "string" ? v : "").slice(0, max);
}

export default class PokerServer implements Party.Server {
  // Deliberately NOT hibernating: this room holds the authoritative, mutable
  // PokerEngine state in memory and mutates it on (almost) every message. Under
  // hibernation that state would be evicted between messages — we'd have to
  // serialize the whole engine to storage on each change and drive every timer
  // off alarms. Wrong trade-off for a sub-second realtime game; the recommended
  // pattern for a hot stateful room is to stay resident (hibernate: false).
  readonly options: Party.ServerOptions = { hibernate: false };

  engine: PokerEngine;
  tournament: Tournament | null = null; // set only for multi-table tournaments
  running = false;
  private suspended = false; // true while the room has no connections (timers off)
  private actionTimer: ReturnType<typeof setTimeout> | null = null;
  private handTimer: ReturnType<typeof setTimeout> | null = null;
  private tourneyTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {
    this.engine = new PokerEngine(room.id, { ...DEFAULT_CONFIG });
  }

  // Ops log scoped to this room (see party/log.ts). Never carries cards/chat.
  private log(level: LogLevel, event: string, ctx?: Record<string, unknown>) {
    olog(level, event, { room: this.room.id, ...ctx });
  }

  onConnect(conn: Party.Connection<ConnState>) {
    // A live connection means the room is no longer a dead lobby — restart any
    // background work we paused when the last player left.
    if (this.suspended) this.resume();
    conn.setState({ playerId: null, name: "" });
    this.log("info", "connect", { conn: conn.id });
    // initial empty snapshot; the client identifies itself via "join"
    this.sendTo(conn, { type: "state", state: this.snapshotState(null) });
  }

  private snapshotState(pid: string | null) {
    return this.tournament ? this.tournament.snapshotFor(pid) : this.engine.snapshotFor(pid);
  }

  private startTick() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => {
      if (!this.tournament) {
        if (this.tickTimer) clearInterval(this.tickTimer);
        this.tickTimer = null;
        return;
      }
      const changed = this.tournament.tick();
      if (changed) this.broadcast();
      if (this.tournament.finished && this.tickTimer) {
        clearInterval(this.tickTimer);
        this.tickTimer = null;
      }
    }, 1000);
  }

  onClose(conn: Party.Connection<ConnState>) {
    const pid = conn.state?.playerId;
    if (pid && !this.hasOtherConnection(pid, conn.id)) {
      this.log("info", "disconnect", { playerId: pid });
      this.engine.setConnected(pid, false);
      this.tournament?.setConnected(pid, false);
      this.broadcast();
    }
    // Dead-lobby cleanup: when the last connection leaves, stop every timer so
    // the room isn't dealing hands / escalating blinds / broadcasting to nobody.
    // Clearing the timers lets the (non-hibernating) Durable Object go idle and
    // be evicted by the platform. The game state is kept in memory so a quick
    // reconnect (before eviction) resumes exactly where it left off.
    if (!this.hasAnyConnection(conn.id)) this.suspend();
    else this.scheduleTimers();
  }

  // Stop all background work. Called when the room empties out.
  private suspend() {
    if (this.actionTimer) clearTimeout(this.actionTimer);
    if (this.handTimer) clearTimeout(this.handTimer);
    if (this.tourneyTimer) clearTimeout(this.tourneyTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.actionTimer = this.handTimer = this.tourneyTimer = null;
    this.tickTimer = null;
    this.suspended = true;
    this.log("info", "room_suspended");
  }

  // Re-arm whatever timer the current phase needs, for when a player returns to
  // a room we paused. Deadlines are absolute (Date.now()-based) so an expired
  // action/blind clock simply fires immediately and the game self-heals.
  private resume() {
    this.suspended = false;
    this.log("info", "room_resumed", { phase: this.engine.phase });
    if (this.tournament) {
      this.startTick();
      return;
    }
    const e = this.engine;
    this.scheduleTimers(); // action clock for the current actor (no-op otherwise)
    this.scheduleTourneyTimer(); // single-table blind levels (no-op if not a tourney)
    if (e.phase === "runout") this.scheduleRunout();
    else if (e.phase === "showdown") this.scheduleNextHand();
    else this.maybeResume(); // between/idle -> deal the next hand if the game is live
  }

  onMessage(raw: string, sender: Party.Connection<ConnState>) {
    // Drop oversized payloads before parsing (cheap DoS guard + observability).
    if (raw.length > MAX_MESSAGE_BYTES) {
      this.log("warn", "oversize_message", {
        len: raw.length,
        playerId: sender.state?.playerId ?? null,
      });
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.log("warn", "bad_json", { len: raw.length });
      return;
    }
    this.handle(msg, sender);
  }

  private handle(msg: ClientMessage, conn: Party.Connection<ConnState>) {
    const e = this.engine;
    const pid = () => conn.state?.playerId ?? null;
    let err: string | null = null;

    switch (msg.type) {
      case "join": {
        const playerId = String(msg.playerId || "").slice(0, 64);
        const name = String(msg.name || "Player").slice(0, 20);
        if (!playerId) return;
        conn.setState({ playerId, name });
        e.setConnected(playerId, true);
        this.tournament?.setConnected(playerId, true);
        e.ensureHost(playerId); // first joiner becomes host even before sitting
        this.log("info", "join", { playerId, host: e.isHost(playerId) });
        this.sendTo(conn, { type: "you", playerId });
        break;
      }
      case "rename":
        if (pid()) e.rename(pid()!, asStr(msg.name, 20));
        break;
      case "sit":
        if (pid()) err = e.sit(pid()!, conn.state!.name || "Player", asInt(msg.seat, -1), asInt(msg.buyIn, 0));
        break;
      case "stand":
        if (pid()) e.stand(pid()!);
        break;
      case "rebuy":
        if (pid()) err = e.rebuy(pid()!, asInt(msg.amount, 0));
        break;
      case "action":
        if (pid()) {
          const amount = msg.amount === undefined ? undefined : asInt(msg.amount, 0);
          if (this.tournament) {
            err = this.tournament.act(pid()!, msg.action, amount, asInt(msg.seq, -1));
          } else {
            err = e.act(pid()!, msg.action, amount, asInt(msg.seq, -1));
            this.afterStateChange();
          }
        }
        break;
      case "startGame":
        if (pid() && e.isHost(pid()!)) {
          this.running = true;
          e.paused = false;
          // Cancel any pending auto-deal so this is the single deal entry point —
          // otherwise an armed next-hand timer could fire and deal a second hand
          // on top of this one (the double-deal bug).
          if (this.handTimer) {
            clearTimeout(this.handTimer);
            this.handTimer = null;
          }
          if (e.canStart() && !e.handInProgress()) {
            err = e.startHand();
            this.afterStateChange();
          }
        }
        break;
      case "startTournament":
        if (pid() && e.isHost(pid()!) && !this.tournament) {
          const regs = e.occupiedPlayers();
          const cap = Math.max(2, Math.min(e.config.tourneyTableSize, 10));
          if (regs.length > cap) {
            // multi-table tournament: hand off to the coordinator
            this.tournament = new Tournament(
              this.room.id,
              e.config,
              regs.map((p) => ({ playerId: p.playerId, name: p.name })),
              () => Date.now()
            );
            this.log("info", "mtt_created", { entrants: regs.length });
            this.startTick();
          } else {
            err = e.startTournament(pid()!, Date.now());
            if (!err) {
              this.running = true;
              if (e.canStart() && !e.handInProgress()) {
                e.startHand();
                this.afterStateChange();
              }
              this.scheduleTourneyTimer();
            }
          }
        }
        break;
      case "exitTournament":
        if (pid() && e.isHost(pid()!)) {
          if (this.tournament) {
            // multi-table coordinator: dissolve it; fall back to the resident
            // engine's lobby (the common single-table Sit & Go uses e.tourney).
            this.tournament = null;
            if (this.tickTimer) {
              clearInterval(this.tickTimer);
              this.tickTimer = null;
            }
          } else {
            err = e.exitTournament(pid()!);
          }
          if (!err && this.tourneyTimer) {
            clearTimeout(this.tourneyTimer);
            this.tourneyTimer = null;
          }
        }
        break;
      case "pauseGame":
        if (pid() && e.isHost(pid()!)) {
          this.running = false;
          e.paused = true;
        }
        break;
      case "updateConfig":
        if (pid() && e.isHost(pid()!)) {
          const next = sanitizeConfig(msg.config, e.config);
          err = e.updateConfig(pid()!, next);
        }
        break;
      case "chat":
        if (pid()) {
          const who = e.seatName(pid()!) ?? conn.state!.name ?? "Player";
          const text = asStr(msg.text, 400);
          if (this.tournament) this.tournament.chat(pid()!, who, text);
          else e.addChat(pid()!, who, text);
        }
        break;
      case "kick":
        // host-gated at the boundary (the engine re-checks) for parity with the
        // other privileged actions above.
        if (pid() && e.isHost(pid()!)) err = e.hostKick(pid()!, asInt(msg.seat, -1));
        break;
      case "setStack":
        if (pid() && e.isHost(pid()!))
          err = e.hostSetStack(pid()!, asInt(msg.seat, -1), asInt(msg.stack, 0));
        break;
      case "rabbitHunt":
        if (pid()) err = e.requestRabbit(pid()!);
        break;
      case "showCards":
        if (pid()) err = e.showCards(pid()!);
        break;
      case "requestHistory":
        this.sendTo(conn, { type: "history", histories: e.getHistories() });
        return;
      case "rtc": {
        // relay WebRTC signaling to the target player's connection(s) in THIS room
        const from = pid();
        const to = asStr(msg.to, 64);
        if (!from || !to) return;
        for (const c of this.room.getConnections<ConnState>()) {
          if (c.state?.playerId === to) {
            c.send(JSON.stringify({ type: "rtc", from, data: msg.data } satisfies ServerMessage));
          }
        }
        return;
      }
      case "media":
        if (pid()) e.setMedia(pid()!, Boolean(msg.mic), Boolean(msg.cam));
        break;
      case "ping":
        this.sendTo(conn, { type: "pong" });
        return;
      default:
        break;
    }

    if (err) this.sendTo(conn, { type: "error", message: err });
    this.broadcast();
    this.scheduleTimers();
    this.maybeResume(); // resume dealing if players just became ready again
  }

  // Called after an action that may have ended a hand or moved the turn.
  private afterStateChange() {
    if (this.engine.phase === "runout") {
      this.scheduleRunout();
    } else if (this.engine.phase === "showdown") {
      this.scheduleNextHand();
    }
  }

  // Drive an all-in run-out: deal one street, broadcast, pause, repeat, then
  // resolve the showdown. Gives flop → turn → river the same suspense a live
  // dealer would, instead of dumping the whole board at once.
  private scheduleRunout() {
    if (this.handTimer) clearTimeout(this.handTimer);
    const advance = () => {
      const more = this.engine.runoutStep();
      this.broadcast();
      this.handTimer = setTimeout(() => {
        if (more) {
          advance();
        } else {
          this.engine.finishRunout();
          this.broadcast();
          this.scheduleNextHand();
        }
      }, RUNOUT_STEP_MS);
    };
    this.handTimer = setTimeout(advance, RUNOUT_REVEAL_MS);
  }

  private scheduleTimers() {
    // (re)arm the action clock for the current actor
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
    const e = this.engine;
    if (e.phase === "hand" && e.toActSeat !== null && e.actionDeadline) {
      const ms = Math.max(0, e.actionDeadline - Date.now());
      this.actionTimer = setTimeout(() => {
        const seat = e.toActSeat;
        if (e.timeoutCurrent()) {
          this.log("info", "action_timeout", { seat });
          this.broadcast();
          if (e.phase === "runout") this.scheduleRunout();
          else if (e.phase === "showdown") this.scheduleNextHand();
          this.scheduleTimers();
        }
      }, ms + 250);
    }
  }

  private scheduleTourneyTimer() {
    if (this.tourneyTimer) clearTimeout(this.tourneyTimer);
    this.tourneyTimer = null;
    const at = this.engine.tourneyLevelEndsAt();
    if (at === null) return;
    const ms = Math.max(0, at - Date.now());
    this.tourneyTimer = setTimeout(() => {
      if (!this.hasPlayers()) return; // don't escalate an abandoned room
      this.engine.advanceLevel(Date.now());
      this.broadcast();
      this.scheduleTourneyTimer(); // arm the next level
    }, ms + 100);
  }

  private scheduleNextHand() {
    if (this.handTimer) clearTimeout(this.handTimer);
    this.handTimer = setTimeout(() => {
      this.handTimer = null;
      this.engine.finishHand();
      this.broadcast();
      this.startNextHandSoon(NEXT_HAND_DELAY_MS);
    }, SHOWDOWN_DELAY_MS);
  }

  // Arm the next deal. Re-checks conditions when it fires and is a harmless
  // no-op if the table isn't ready (too few players, paused, etc.) — leaving
  // `running` intact so a later sit / rebuy can resume play via maybeResume().
  private startNextHandSoon(delay: number) {
    if (this.handTimer) clearTimeout(this.handTimer);
    this.handTimer = setTimeout(() => {
      this.handTimer = null;
      if (!this.running || this.engine.paused || this.tournament) return;
      if (this.engine.handInProgress() || !this.engine.canStart() || !this.hasPlayers()) return;
      const err = this.engine.startHand();
      if (err) return; // can't start yet; a future sit/rebuy retries via maybeResume
      this.broadcast();
      this.afterStateChange(); // a hand that opens already all-in (bomb pot) runs out
      this.scheduleTimers();
    }, delay);
  }

  // Resume dealing when the game is live and idle (e.g. players just rebought or
  // sat down after the table dropped below two). Without this the game would
  // stall forever after any transient shortage of ready players.
  private maybeResume() {
    if (!this.running || this.engine.paused || this.tournament) return;
    if (this.handTimer !== null) return; // a deal / resolution is already pending
    const e = this.engine;
    if (e.phase === "hand" || e.phase === "runout" || e.phase === "showdown") return;
    if (!e.canStart() || !this.hasPlayers()) return;
    this.startNextHandSoon(NEXT_HAND_DELAY_MS);
  }

  // ── connection helpers ────────────────────────────────────────────────────
  private hasPlayers(): boolean {
    for (const c of this.room.getConnections<ConnState>()) if (c.state?.playerId) return true;
    return false;
  }

  private hasOtherConnection(playerId: string, exceptId: string): boolean {
    for (const c of this.room.getConnections<ConnState>()) {
      if (c.id !== exceptId && c.state?.playerId === playerId) return true;
    }
    return false;
  }

  // Any live connection other than `exceptId`. Used in onClose to detect the
  // last departure — the closing connection can still appear in getConnections()
  // at that point, so we must exclude it rather than trust a raw count.
  private hasAnyConnection(exceptId: string): boolean {
    for (const c of this.room.getConnections<ConnState>()) {
      if (c.id !== exceptId) return true;
    }
    return false;
  }

  private sendTo(conn: Party.Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private broadcast() {
    const conns = this.room.getConnections<ConnState>();
    // Compute the viewer-independent snapshot work (pots, ledger, stats, hand
    // labels, log/chat slices) ONCE, then redact per viewer — instead of redoing
    // all of it for every connection. The tournament coordinator keeps its own
    // per-table path.
    const shared = this.tournament ? null : this.engine.snapshotShared();
    for (const conn of conns) {
      const pid = conn.state?.playerId ?? null;
      const state =
        shared && !this.tournament
          ? this.engine.snapshotFor(pid, shared)
          : this.snapshotState(pid);
      conn.send(JSON.stringify({ type: "state", state } satisfies ServerMessage));
    }
  }
}

PokerServer satisfies Party.Worker;
