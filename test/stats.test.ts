// Regression tests for the HUD analytics (VPIP/PFR/3-bet/c-bet, all-in EV/luck,
// biggest-pot) added in the "Luck/EV stats" commit. The prior suite never
// exercised these, so these tests pin the behaviour an adversarial audit found
// broken: each `bug:` test fails on the pre-fix engine and passes after the fix.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PokerEngine } from "../party/poker/engine.ts";
import { DEFAULT_CONFIG, type TableConfig } from "../common/config.ts";
import { makeDeck, parseCard, cardCode, type Card } from "../common/cards.ts";

function cfg(over: Partial<TableConfig> = {}): TableConfig {
  return { ...DEFAULT_CONFIG, smallBlind: 1, bigBlind: 2, minBuyIn: 1, maxBuyIn: 100000, ...over };
}
const c = (s: string) => parseCard(s);

// Deck whose pop() yields `dealOrder` first. Deal order is round-robin hole
// cards by seat (round 0, then round 1), then for each street: one burn + the
// street's cards.
function stack(dealOrder: Card[]): Card[] {
  const used = new Set(dealOrder.map(cardCode));
  const filler = makeDeck().filter((x) => !used.has(cardCode(x)));
  return [...filler, ...dealOrder.slice().reverse()];
}

// Drive an all-in run-out to showdown synchronously (as the server timer would).
function settle(e: PokerEngine): void {
  let g = 0;
  while (e.phase === "runout") {
    if (++g > 20) throw new Error("runout did not terminate");
    if (!e.runoutStep()) e.finishRunout();
  }
}

// Play to the end of a hand and run updateStats() (stats only populate then).
function endHand(e: PokerEngine): void {
  if (e.phase === "runout") settle(e);
  if (e.phase === "showdown") e.finishHand();
}

const statOf = (e: PokerEngine, pid: string) => e.statsRows().find((r) => r.playerId === pid)!;

// ── preflop: VPIP / PFR ──────────────────────────────────────────────────────

test("bug(vpip/pfr): BB option all-in jam over limpers counts as VPIP+PFR", () => {
  // 3-max: button=0 (UTG), SB=1, BB=2. UTG limps, SB completes, BB shoves on its
  // option (toCall===0 but a fully voluntary aggressive open). It must count as
  // both VPIP and PFR — the engine already treats it as a preflop open.
  const e = new PokerEngine("r", cfg({ maxSeats: 3 }), () => 0);
  e.sit("p0", "P0", 0, 1000);
  e.sit("p1", "P1", 1, 1000);
  e.sit("p2", "P2", 2, 1000);
  e.startHand();
  e.act("p0", "call", undefined, e.actionSeq); // UTG limps
  e.act("p1", "call", undefined, e.actionSeq); // SB completes
  e.act("p2", "allin", undefined, e.actionSeq); // BB jams its option (toCall===0)
  // others fold to the jam
  let g = 0;
  while (e.phase === "hand" && e.toActSeat !== null) {
    if (++g > 10) break;
    e.act(["p0", "p1", "p2"][e.toActSeat!], "fold", undefined, e.actionSeq);
  }
  endHand(e);
  const bb = statOf(e, "p2");
  assert.equal(bb.vpip, 100, "BB jam is voluntary -> VPIP 100");
  assert.equal(bb.pfr, 100, "BB jam is an aggressive open -> PFR 100");
});

test("sanity(vpip/pfr): BB checking its option is NOT voluntary", () => {
  const e = new PokerEngine("r", cfg({ maxSeats: 3 }), () => 0);
  e.sit("p0", "P0", 0, 1000);
  e.sit("p1", "P1", 1, 1000);
  e.sit("p2", "P2", 2, 1000);
  e.startHand();
  e.act("p0", "call", undefined, e.actionSeq);
  e.act("p1", "call", undefined, e.actionSeq);
  e.act("p2", "check", undefined, e.actionSeq); // BB checks the option
  // checked around to flop; everyone checks it down
  for (let s = 0; s < 4; s++) {
    let g = 0;
    while (e.phase === "hand" && e.toActSeat !== null) {
      if (++g > 10) break;
      const r = e.act(["p0", "p1", "p2"][e.toActSeat!], "check", undefined, e.actionSeq);
      if (r) break; // can't check -> street is done being checkable
    }
    if (e.phase !== "hand") break;
  }
  endHand(e);
  const bb = statOf(e, "p2");
  assert.equal(bb.vpip, 0, "BB option check is not VPIP");
  assert.equal(bb.pfr, 0, "BB option check is not PFR");
});

// ── postflop: fold-to-c-bet ──────────────────────────────────────────────────

test("bug(foldToCbet): folding to a RAISE of the c-bet is not a fold-to-c-bet", () => {
  // 4-handed. P3 opens, P0 calls, P2 (BB) 3-bets -> P2 is preflop aggressor.
  // Flop order is P2, P3, P0. P2 c-bets, P3 RAISES the c-bet, then P0 folds —
  // P0 never faced the clean c-bet, only the raise, so it must NOT count.
  const e = new PokerEngine("r", cfg({ maxSeats: 4 }), () => 0);
  e.sit("p0", "P0", 0, 1000);
  e.sit("p1", "P1", 1, 1000);
  e.sit("p2", "P2", 2, 1000);
  e.sit("p3", "P3", 3, 1000);
  e.startHand(); // button=0, SB=1, BB=2, UTG=3
  e.act("p3", "raise", 6, e.actionSeq); // UTG opens
  e.act("p0", "call", undefined, e.actionSeq); // button calls
  e.act("p1", "fold", undefined, e.actionSeq); // SB folds
  e.act("p2", "raise", 20, e.actionSeq); // BB 3-bets -> preflop aggressor
  e.act("p3", "call", undefined, e.actionSeq);
  e.act("p0", "call", undefined, e.actionSeq);
  assert.equal(e.street, "flop", "reached the flop");
  e.act("p2", "bet", 15, e.actionSeq); // the c-bet
  e.act("p3", "raise", 50, e.actionSeq); // raises the c-bet before it reaches P0
  e.act("p0", "fold", undefined, e.actionSeq); // P0 folds to the RAISE
  // close the hand out
  let g = 0;
  while (e.phase === "hand" && e.toActSeat !== null) {
    if (++g > 10) break;
    e.act(["p0", "p1", "p2", "p3"][e.toActSeat!], "fold", undefined, e.actionSeq);
  }
  endHand(e);
  const p0 = statOf(e, "p0");
  assert.equal(p0.foldToCbet, 0, "P0 only faced a raise of the c-bet, not the c-bet");
});

test("sanity(foldToCbet): folding to the clean c-bet still counts", () => {
  const e = new PokerEngine("r", cfg({ maxSeats: 3 }), () => 0);
  e.sit("p0", "P0", 0, 1000);
  e.sit("p1", "P1", 1, 1000);
  e.sit("p2", "P2", 2, 1000);
  e.startHand(); // button=0, SB=1, BB=2, UTG=0
  e.act("p0", "raise", 6, e.actionSeq); // button opens -> preflop aggressor
  e.act("p1", "call", undefined, e.actionSeq); // SB calls
  e.act("p2", "fold", undefined, e.actionSeq); // BB folds
  assert.equal(e.street, "flop");
  // flop order: SB(1) first, then aggressor button(0)
  e.act("p1", "check", undefined, e.actionSeq);
  e.act("p0", "bet", 10, e.actionSeq); // clean c-bet
  e.act("p1", "fold", undefined, e.actionSeq); // SB folds to the clean c-bet
  endHand(e);
  const p1 = statOf(e, "p1");
  assert.equal(p1.foldToCbet, 100, "fold to the clean c-bet is counted");
});

// ── all-in EV / luck ─────────────────────────────────────────────────────────

// As Ks (seat0) vs 2c 2d (seat1), all-in PREFLOP -> Monte-Carlo equity capture.
const AIPF_DECK = (): Card[] =>
  stack([c("As"), c("2c"), c("Ks"), c("2d")]);

function runPreflopAllIn(): PokerEngine {
  const e = new PokerEngine("r", cfg({ maxSeats: 2 }), () => 0, AIPF_DECK);
  e.sit("a", "A", 0, 100);
  e.sit("b", "B", 1, 100);
  e.startHand(); // HU: button=0 acts first
  e.act("a", "allin", undefined, e.actionSeq);
  e.act("b", "call", undefined, e.actionSeq);
  settle(e);
  e.finishHand();
  return e;
}

test("bug(allInEv): equity capture is deterministic for identical hands", () => {
  // Two identical preflop all-ins (same deck, same actions) must yield the same
  // captured EV — the estimator must not reseed from a fresh crypto draw.
  const ev1 = statOf(runPreflopAllIn(), "a").allInEv;
  const ev2 = statOf(runPreflopAllIn(), "a").allInEv;
  assert.equal(ev1, ev2, "same hand state -> same captured all-in EV");
});

test("allInLuck zero-sum: AA vs 22 all-in nets to zero across the table", () => {
  const e = runPreflopAllIn();
  const a = statOf(e, "a");
  const b = statOf(e, "b");
  assert.equal(a.allInCount, 1);
  assert.equal(b.allInCount, 1);
  assert.ok(Math.abs(a.allInLuck + b.allInLuck) <= 1, `luck zero-sum, got ${a.allInLuck}+${b.allInLuck}`);
});

test("bug(allInLuck): a 7-2 bounty does not break the luck zero-sum invariant", () => {
  // A (seat0/7-2) and B (seat2) go all-in preflop for 100 each; C (seat1) folds
  // but keeps a deep stack, so C is the one who actually pays the 20 bounty when
  // A scoops with quad 7s. The bounty is a side transfer, not pot equity, so it
  // must not skew the all-in luck of the A/B confrontation.
  // Board: 7h 7d 7c 2d Kd -> A (7s 2c) makes quad 7s.
  const deck = (): Card[] =>
    stack([
      c("7s"), c("Ah"), c("9h"), // hole round 0 (seats 0,1,2)
      c("2c"), c("Kc"), c("9d"), // hole round 1
      c("5s"), c("7h"), c("7d"), c("7c"), // burn + flop
      c("6s"), c("2d"), // burn + turn
      c("8s"), c("Kd"), // burn + river
    ]);
  const e = new PokerEngine("r", cfg({ maxSeats: 3, sevenDeuce: 20 }), () => 0, deck);
  e.sit("a", "A", 0, 100); // 7-2, all-in
  e.sit("c", "C", 1, 500); // SB, folds but pays the bounty
  e.sit("b", "B", 2, 100); // all-in
  e.startHand(); // button=0=UTG, SB=1, BB=2
  e.act("a", "allin", undefined, e.actionSeq); // A jams
  e.act("c", "fold", undefined, e.actionSeq); // C folds (still in-hand, pays bounty)
  e.act("b", "call", undefined, e.actionSeq); // B calls all-in
  settle(e);
  e.finishHand();
  assert.equal(e.seats[0]!.bounty, true, "A collected the 7-2 bounty");
  const a = statOf(e, "a");
  const b = statOf(e, "b");
  assert.equal(a.allInCount, 1);
  assert.equal(b.allInCount, 1);
  assert.ok(Math.abs(a.allInLuck + b.allInLuck) <= 1, `luck must net to ~0, got ${a.allInLuck}+${b.allInLuck}`);
});

// ── biggest pot won ──────────────────────────────────────────────────────────

test("bug(biggestPotWon): 7-2 bounty is excluded from biggest pot won", () => {
  // 3-max, Alice (seat0/UTG) holds 7-2, opens, both fold. She wins the blinds
  // (pot=3) plus a 20-each bounty from two folders (40). 'Biggest pot won' must
  // report the pot (3), not pot+bounty (43).
  const deck = (): Card[] =>
    stack([c("7s"), c("Ah"), c("Kh"), c("2c"), c("Qd"), c("Jd")]);
  const e = new PokerEngine("r", cfg({ maxSeats: 3, sevenDeuce: 20 }), () => 0, deck);
  e.sit("a", "A", 0, 500);
  e.sit("b", "B", 1, 500);
  e.sit("d", "D", 2, 500);
  e.startHand(); // button=0=UTG, SB=1, BB=2
  e.act("a", "raise", 50, e.actionSeq); // Alice opens holding 7-2
  e.act("b", "fold", undefined, e.actionSeq);
  e.act("d", "fold", undefined, e.actionSeq);
  endHand(e);
  assert.equal(e.seats[0]!.bounty, true, "Alice collected the 7-2 bounty");
  const a = statOf(e, "a");
  const potWon = e.seats[0]!.wonAmount - 40; // strip the two 20-chip bounties
  assert.equal(a.biggestPotWon, potWon, "biggestPotWon is pot-only, excludes bounty");
  assert.ok(a.biggestPotWon < 40, `pot was small (${a.biggestPotWon}), not inflated by the 40 bounty`);
});
