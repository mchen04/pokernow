// Headless poker bots for playtesting. Connects N auto-playing clients to a
// room over the PartyKit websocket (same wire protocol the browser uses) so a
// real multi-player game runs while agent-browser observes / screenshots.
//
// Usage:
//   node scripts/bots.mjs --room <code> [--n 4] [--host localhost:1999]
//       [--jam 0.12] [--delay 500] [--buyin 1000] [--hands 0]
//       [--tournament] [--config '{"runItTwice":true,...}']
//
// Each bot sits, the first to join becomes host and (optionally) applies a
// config + starts the game. Bots call/check by default with a configurable
// chance to jam all-in (to exercise the all-in run-out). Busted bots rebuy so
// a cash game runs indefinitely. Logs public game events (hands, all-ins,
// run-out streets, showdowns, winners).

import { WebSocket } from "ws";

// ── args ─────────────────────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = process.argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else (args[key] = next), i++;
  }
}
const ROOM = args.room || "playtest";
const N = Number(args.n || 4);
const HOST = args.host || "localhost:1999";
const JAM = Number(args.jam ?? 0.12); // P(go all-in) on a decision when raising is legal
const RAISE = Number(args.raise ?? 0.18); // P(make a normal raise) on a decision
const DELAY = Number(args.delay ?? 500); // ms think time before acting
const BUYIN = Number(args.buyin ?? 1000); // chips each bot buys in for
const MAX_HANDS = Number(args.hands || 0); // 0 = run until killed
const TOURNAMENT = Boolean(args.tournament);
const CONFIG = args.config ? JSON.parse(args.config) : null;
const QUIET = Boolean(args.quiet);

const NAMES = ["Ada", "Boris", "Cleo", "Dex", "Esme", "Finn", "Gigi", "Hank", "Ivy", "Jax"];
const log = (...m) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...m);

// deterministic-ish per-process rng so reruns vary by index but are reproducible
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomId() {
  let out = "";
  for (let i = 0; i < 32; i++) out += "0123456789abcdef"[Math.floor(Math.random() * 16)];
  return out;
}

let startedOnce = false;
let lastLoggedHand = 0;
let lastPhase = "";
let lastBoardLen = -1;

class Bot {
  constructor(idx) {
    this.idx = idx;
    this.playerId = randomId();
    this.name = NAMES[idx % NAMES.length] + (idx >= NAMES.length ? idx : "");
    this.rand = rng(1000 + idx * 7);
    this.state = null;
    this.lastActedSeq = -1;
    this.satFor = -1; // actionSeq guard so we sit once per opportunity
    this.pending = false;
    this.ws = new WebSocket(`ws://${HOST}/parties/main/${ROOM}`);
    this.ws.on("open", () => this.send({ type: "join", playerId: this.playerId, name: this.name }));
    this.ws.on("message", (data) => this.onMessage(data));
    this.ws.on("error", (e) => log(`bot ${this.name} ws error`, e.message));
    this.ws.on("close", () => QUIET || log(`bot ${this.name} disconnected`));
  }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  get isHost() {
    return this.state && this.state.hostId === this.playerId;
  }

  onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type !== "state") return;
    this.state = msg.state;
    if (this.idx === 0) this.logEvents(msg.state);
    this.think();
  }

  // bot 0 narrates public game events
  logEvents(s) {
    if (QUIET) return;
    if (s.handNumber !== lastLoggedHand && s.phase === "hand") {
      lastLoggedHand = s.handNumber;
      const seated = s.seats.filter((x) => !x.empty).length;
      log(`── Hand #${s.handNumber} (${seated} seated, ${s.config.variant}) ──`);
    }
    if (s.phase !== lastPhase) {
      lastPhase = s.phase;
      if (s.phase === "runout") log(`  ALL-IN → running out the board…`);
    }
    const bl = s.boards[0]?.length ?? 0;
    if (s.phase === "runout" && bl !== lastBoardLen) {
      lastBoardLen = bl;
      const street = bl >= 5 ? "river" : bl === 4 ? "turn" : bl === 3 ? "flop" : "preflop";
      if (bl > 0) log(`    ${street}: ${s.boards.map((b) => b.map(cardCode).join(" ")).join("  |  ")}`);
    }
    if (s.phase === "showdown") {
      const winners = s.seats.filter((x) => x.winner && x.wonAmount > 0);
      if (winners.length && bl !== -2) {
        lastBoardLen = -2; // log once per showdown
        for (const w of winners) log(`  ${w.name} wins ${w.wonAmount}${w.handLabel ? ` (${w.handLabel})` : ""}`);
      }
    }
    if (s.phase !== "showdown" && s.phase !== "runout") lastBoardLen = -1;
  }

  think() {
    const s = this.state;
    if (!s) return;

    // host: apply config + kick off the game
    if (this.isHost && !startedOnce) {
      if (CONFIG && !this._configured) {
        this._configured = true;
        this.send({ type: "updateConfig", config: CONFIG });
      }
      if (s.canStart && !s.handInProgress) {
        startedOnce = true;
        setTimeout(() => {
          this.send({ type: TOURNAMENT ? "startTournament" : "startGame" });
        }, 600);
      }
    }

    const mine = s.yourSeat !== null ? s.seats[s.yourSeat] : null;

    // sit if we have no seat and the table isn't mid-hand
    if (!mine && !this.pending && (s.phase === "lobby" || s.phase === "between" || s.phase === "showdown" || s.street === "idle")) {
      const empty = s.seats.find((x) => x.empty);
      if (empty && this.satFor !== s.actionSeq) {
        this.satFor = s.actionSeq;
        this.send({ type: "sit", seat: empty.index, buyIn: BUYIN });
      }
      return;
    }

    // rebuy if busted (cash game only) so play continues
    if (mine && mine.stack === 0 && !mine.inHand && !s.tourney?.active && (s.phase === "between" || s.phase === "showdown" || s.phase === "lobby")) {
      this.send({ type: "rebuy", amount: BUYIN });
      this.send({ type: "sitIn" });
      return;
    }

    // act on our turn
    if (s.phase === "hand" && s.toActSeat === s.yourSeat && s.legalActions?.length) {
      if (this.lastActedSeq === s.actionSeq) return;
      const seq = s.actionSeq;
      setTimeout(() => {
        const cur = this.state;
        if (!cur || cur.phase !== "hand" || cur.toActSeat !== cur.yourSeat || cur.actionSeq !== seq) return;
        this.lastActedSeq = seq;
        const { action, amount } = this.choose(cur);
        this.send({ type: "action", action, amount, seq });
      }, DELAY + Math.floor(this.rand() * 300));
    }
  }

  choose(s) {
    const acts = s.legalActions;
    const r = this.rand();
    const aggro = acts.find((a) => a.type === "bet" || a.type === "raise");
    const call = acts.find((a) => a.type === "call");
    const check = acts.find((a) => a.type === "check");
    const fold = acts.find((a) => a.type === "fold");

    // jam all-in sometimes (drives the run-out)
    if (aggro && r < JAM) return { action: aggro.type, amount: aggro.max };
    // occasional sized raise
    if (aggro && r < JAM + RAISE) {
      const span = aggro.max - aggro.min;
      const amount = aggro.min + Math.floor(this.rand() * Math.max(1, span * 0.5));
      return { action: aggro.type, amount: Math.min(amount, aggro.max) };
    }
    // otherwise a call-station: check, else call, else fold to big bets sometimes
    if (check) return { action: "check" };
    if (call) {
      // fold occasionally to a large call relative to stack
      const mine = s.seats[s.yourSeat];
      if (call.amount > mine.stack * 0.6 && this.rand() < 0.35 && fold) return { action: "fold" };
      return { action: "call" };
    }
    return { action: fold ? "fold" : "check" };
  }
}

// minimal card formatter mirroring common/cards.ts cardCode
const RANKS = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const SUITS = { s: "♠", h: "♥", d: "♦", c: "♣" };
function cardCode(card) {
  if (!card) return "??";
  const r = RANKS[card.rank] || String(card.rank);
  return `${r}${SUITS[card.suit] || card.suit}`;
}

log(`Starting ${N} bots in room "${ROOM}" on ${HOST} (jam=${JAM}, buyin=${BUYIN}${TOURNAMENT ? ", tournament" : ""})`);
const bots = [];
for (let i = 0; i < N; i++) setTimeout(() => bots.push(new Bot(i)), i * 250);

if (MAX_HANDS > 0) {
  const iv = setInterval(() => {
    if (lastLoggedHand >= MAX_HANDS) {
      log(`Reached ${MAX_HANDS} hands — shutting down bots.`);
      for (const b of bots) b.ws.close();
      clearInterval(iv);
      setTimeout(() => process.exit(0), 500);
    }
  }, 1000);
}

process.on("SIGINT", () => {
  for (const b of bots) b.ws.close();
  process.exit(0);
});
