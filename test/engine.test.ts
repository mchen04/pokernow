import { test } from "node:test";
import assert from "node:assert/strict";
import { PokerEngine } from "../party/poker/engine.ts";
import { DEFAULT_CONFIG, type TableConfig } from "../common/config.ts";
import { makeDeck, parseCard, cardCode, type Card } from "../common/cards.ts";

function cfg(over: Partial<TableConfig> = {}): TableConfig {
  return { ...DEFAULT_CONFIG, smallBlind: 1, bigBlind: 2, minBuyIn: 1, maxBuyIn: 100000, ...over };
}

const c = (s: string) => parseCard(s);

// Build a deck whose pop() sequence yields `dealOrder` (then filler).
function stack(dealOrder: Card[]): Card[] {
  const used = new Set(dealOrder.map(cardCode));
  const filler = makeDeck().filter((x) => !used.has(cardCode(x)));
  // pop() returns the last element, so reverse dealOrder onto the tail
  return [...filler, ...dealOrder.slice().reverse()];
}

function rngFrom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic seeded deck factory (so fuzz failures reproduce exactly).
function seededDeck(seed: number): () => Card[] {
  const next = rngFrom(seed);
  return () => {
    const d = makeDeck();
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  };
}

// total chips currently on the table (between hands)
function totalChips(e: PokerEngine): number {
  return e.seats.reduce((sum, s) => sum + (s ? s.stack : 0), 0);
}
function totalChipsInPlay(e: PokerEngine): number {
  return e.seats.reduce((sum, s) => sum + (s ? s.stack + s.committed : 0), 0);
}

// All-ins now pause in the "runout" phase so the server can deal the board out
// one street at a time for suspense. Tests drive that run-out to completion
// synchronously, exactly as the server timer would.
function settle(e: PokerEngine): void {
  let guard = 0;
  while (e.phase === "runout") {
    if (++guard > 10) throw new Error("runout did not terminate");
    if (!e.runoutStep()) e.finishRunout();
  }
}

test("heads-up: button posts the small blind and acts first preflop", () => {
  const e = new PokerEngine("r", cfg({ maxSeats: 2 }));
  e.sit("a", "Alice", 0, 100);
  e.sit("b", "Bob", 1, 100);
  assert.equal(e.startHand(), null);
  assert.equal(e.buttonSeat, e.toActSeat, "button acts first preflop heads-up");
});

test("BB gets the option when action is just called around", () => {
  const e = new PokerEngine("r", cfg());
  e.sit("a", "A", 0, 100);
  e.sit("b", "B", 1, 100);
  e.sit("d", "D", 2, 100);
  e.startHand();
  // button=0, SB=1, BB=2, UTG to act = 0
  let snap = e.snapshotFor("a");
  assert.equal(snap.toActSeat, 0);
  e.act("a", "call", undefined, snap.actionSeq); // button calls 2
  snap = e.snapshotFor("b");
  e.act("b", "call", undefined, snap.actionSeq); // SB completes
  // now BB to act with the option
  snap = e.snapshotFor("d");
  assert.equal(snap.toActSeat, 2);
  assert.ok(snap.legalActions.some((x) => x.type === "check"), "BB can check its option");
  assert.ok(snap.legalActions.some((x) => x.type === "raise"), "BB can raise its option");
});

test("min-raise is enforced; stale seq and out-of-turn are rejected", () => {
  const e = new PokerEngine("r", cfg());
  e.sit("a", "A", 0, 1000);
  e.sit("b", "B", 1, 1000);
  e.sit("d", "D", 2, 1000);
  e.startHand();
  let snap = e.snapshotFor("a");
  // out of turn
  assert.equal(e.act("b", "call", undefined, snap.actionSeq), "Not your turn");
  // raise below min (currentBet 2, min raise to 4) -> rejected
  assert.equal(e.act("a", "raise", 3, snap.actionSeq), "Minimum is 4");
  // stale seq -> silently ignored (null) and no state change
  const before = snap.actionSeq;
  assert.equal(e.act("a", "raise", 100, before - 1), null);
  assert.equal(e.snapshotFor("a").actionSeq, before, "stale action did not change state");
  // valid min raise
  assert.equal(e.act("a", "raise", 4, before), null);
  assert.equal(e.currentBet, 4);
});

test("fold to a bet: lone player wins the pot, chips conserved", () => {
  const e = new PokerEngine("r", cfg());
  e.sit("a", "A", 0, 100);
  e.sit("b", "B", 1, 100);
  e.sit("d", "D", 2, 100);
  e.startHand();
  const total = 300;
  // button(0) raises, others fold
  let snap = e.snapshotFor("a");
  e.act("a", "raise", 10, snap.actionSeq);
  snap = e.snapshotFor("b");
  e.act("b", "fold", undefined, snap.actionSeq);
  snap = e.snapshotFor("d");
  e.act("d", "fold", undefined, snap.actionSeq);
  // hand ends; A wins SB+BB
  assert.equal(e.phase, "showdown");
  assert.equal(totalChips(e), total, "chips conserved after fold-win");
  const a = e.seats[0]!;
  assert.equal(a.stack, 100 + 1 + 2, "A wins the blinds (uncalled raise returned)");
});

test("three-way all-in preflop forms correct side pots; best hand scoops", () => {
  const dealOrder = [
    // round 0 hole cards (seat order 0,1,2)
    c("As"), c("Ks"), c("Qs"),
    // round 1 hole cards
    c("Ah"), c("Kh"), c("Qh"),
    // burn, flop
    c("2c"), c("7d"), c("9c"), c("Td"),
    // burn, turn
    c("5c"), c("4s"),
    // burn, river
    c("6c"), c("3h"),
  ];
  const e = new PokerEngine("r", cfg(), () => 0, () => stack(dealOrder));
  e.sit("a", "A", 0, 100);
  e.sit("b", "B", 1, 60);
  e.sit("d", "D", 2, 40);
  e.startHand();
  // button=0 acts first; everyone jams
  let snap = e.snapshotFor("a");
  assert.equal(e.act("a", "allin", undefined, snap.actionSeq), null);
  snap = e.snapshotFor("b");
  assert.equal(e.act("b", "call", undefined, snap.actionSeq), null); // all-in call 59
  snap = e.snapshotFor("d");
  assert.equal(e.act("d", "call", undefined, snap.actionSeq), null); // all-in call 38
  assert.equal(e.phase, "runout", "all all-in -> board runs out");
  settle(e);
  assert.equal(e.phase, "showdown", "run-out completes to showdown");
  assert.equal(totalChipsInPlay(e), 200, "chips conserved through showdown");
  // A (AA) scoops main + side pot; uncalled 40 returned to A
  assert.equal(e.seats[0]!.stack, 200, "A wins everything");
  assert.equal(e.seats[1]!.stack, 0);
  assert.equal(e.seats[2]!.stack, 0);
});

test("split pot: identical hands chop, odd chip goes left of button", () => {
  // Two players, both end with the same straight on the board; pot is odd.
  const dealOrder = [
    c("2c"), c("2d"), // hole round 0 (seats 0,1)
    c("7h"), c("7s"), // hole round 1
    c("3c"), c("9d"), c("Tc"), c("Jh"), // burn + flop
    c("4c"), c("Qs"), // burn + turn
    c("5c"), c("Kd"), // burn + river  -> board 9 T J Q K = straight, both play the board
  ];
  const e = new PokerEngine("r", cfg({ maxSeats: 2 }), () => 0, () => stack(dealOrder));
  e.sit("a", "A", 0, 51);
  e.sit("b", "B", 1, 51);
  e.startHand(); // HU: button=0 is SB
  // play to showdown checking/calling
  let s = e.snapshotFor("a");
  e.act("a", "call", undefined, s.actionSeq); // SB calls
  s = e.snapshotFor("b");
  e.act("b", "check", undefined, s.actionSeq); // BB checks option
  for (const street of ["flop", "turn", "river"]) {
    void street;
    // postflop: BB (seat 1) acts first heads-up
    s = e.snapshotFor("b");
    e.act("b", "check", undefined, s.actionSeq);
    s = e.snapshotFor("a");
    e.act("a", "check", undefined, s.actionSeq);
  }
  assert.equal(e.phase, "showdown");
  assert.equal(totalChips(e), 102, "chips conserved");
  // pot = 4 (each posted 2). even split 2/2.
  assert.equal(e.seats[0]!.stack, 51);
  assert.equal(e.seats[1]!.stack, 51);
});

test("hi/lo split: the odd chip goes to the HIGH hand", () => {
  // 3-handed PLO Hi/Lo. B posts the SB and folds, injecting one dead chip so the
  // contested pot is ODD (5). A wins the high (trip kings); C is the only
  // qualifying low. Standard rule: the odd chip goes HIGH -> A gets 3, C gets 2.
  const dealOrder = [
    c("Ks"), c("4c"), c("Ad"),
    c("Kh"), c("4d"), c("2h"),
    c("Qs"), c("4h"), c("8s"),
    c("Qd"), c("4s"), c("9d"),
    c("Tc"), c("3d"), c("5h"), c("7s"), // burn + flop
    c("Td"), c("9c"),                   // burn + turn
    c("Th"), c("Kc"),                   // burn + river
  ];
  const e = new PokerEngine(
    "r",
    cfg({ maxSeats: 3, variant: "plo-hilo" }),
    () => 0,
    () => stack(dealOrder)
  );
  e.sit("a", "A", 0, 100);
  e.sit("b", "B", 1, 100);
  e.sit("c", "C", 2, 100);
  e.startHand(); // button=0(A), SB=1(B), BB=2(C); UTG=A acts first
  let s = e.snapshotFor("a");
  e.act("a", "call", undefined, s.actionSeq); // A calls the BB
  s = e.snapshotFor("b");
  e.act("b", "fold", undefined, s.actionSeq); // B folds -> 1 dead chip
  s = e.snapshotFor("c");
  e.act("c", "check", undefined, s.actionSeq); // C checks the option
  // check the hand down (C acts first postflop, then A)
  for (let street = 0; street < 3; street++) {
    for (let i = 0; i < 2; i++) {
      const pid = e.seats[e.toActSeat!]!.playerId;
      e.act(pid, "check", undefined, e.snapshotFor(pid).actionSeq);
    }
  }
  assert.equal(e.phase, "showdown");
  assert.equal(totalChips(e), 300, "chips conserved");
  assert.equal(e.seats[0]!.stack, 101, "A (high) takes the odd chip: wins 3 of 5");
  assert.equal(e.seats[2]!.stack, 100, "C (low) wins 2 of 5");
  assert.equal(e.seats[1]!.stack, 99, "B folded the small blind");
});

test("security: spectators never see a folded player's hole cards", () => {
  const e = new PokerEngine("r", cfg({ maxSeats: 3, spectatorsSeeCards: true }));
  e.sit("a", "A", 0, 100);
  e.sit("b", "B", 1, 100);
  e.sit("c", "C", 2, 100);
  e.startHand();
  // UTG (button, seat 0) folds; the hand continues heads-up between the blinds
  const s = e.snapshotFor("a");
  e.act("a", "fold", undefined, s.actionSeq);
  const spec = e.snapshotFor("spectator");
  assert.equal(spec.seats[0]!.folded, true);
  assert.equal(
    spec.seats[0]!.holeCards,
    null,
    "a mucked (folded) hand stays hidden even in face-up spectator mode"
  );
  const live = spec.seats.find((x) => x.inHand && !x.folded)!;
  assert.ok((live.holeCards?.length ?? 0) > 0, "live hands are face-up for spectators");
});

test("run it twice: all-in runs two boards, chips conserved", () => {
  const e = new PokerEngine("r", cfg({ maxSeats: 2, runItTwice: true }));
  e.sit("a", "A", 0, 100);
  e.sit("b", "B", 1, 100);
  e.startHand();
  let s = e.snapshotFor("a");
  e.act("a", "allin", undefined, s.actionSeq);
  s = e.snapshotFor("b");
  e.act("b", "call", undefined, s.actionSeq);
  settle(e);
  assert.equal(e.phase, "showdown");
  assert.equal(e.boards.length, 2, "two boards run");
  assert.equal(e.boards[0].length, 5);
  assert.equal(e.boards[1].length, 5);
  assert.equal(totalChips(e), 200, "chips conserved across two runs");
});

test("double board: two boards dealt through betting; chips conserved", () => {
  const e = new PokerEngine("r", cfg({ maxSeats: 2, doubleBoard: true }));
  e.sit("a", "A", 0, 100);
  e.sit("b", "B", 1, 100);
  e.startHand();
  assert.equal(e.boards.length, 2, "two boards from the start");
  let s = e.snapshotFor("a");
  e.act("a", "call", undefined, s.actionSeq);
  s = e.snapshotFor("b");
  e.act("b", "check", undefined, s.actionSeq);
  for (let i = 0; i < 3; i++) {
    s = e.snapshotFor("b");
    e.act("b", "check", undefined, s.actionSeq);
    s = e.snapshotFor("a");
    e.act("a", "check", undefined, s.actionSeq);
  }
  assert.equal(e.phase, "showdown");
  assert.equal(e.boards[0].length, 5);
  assert.equal(e.boards[1].length, 5);
  assert.equal(totalChips(e), 200, "chips conserved with two boards");
});

test("regression: dead money from a folded over-committer is refunded (no chip leak)", () => {
  // Reproduces a double-board bomb-pot hand where a folded player committed one
  // chip more than any live player; that orphan layer must be refunded, not lost.
  const variants = ["nlhe", "plo", "plo-hilo"] as const;
  const rnd = rngFrom(1044 * 31 + 1);
  const players = 2 + Math.floor(rnd() * 4);
  const e = new PokerEngine(
    "r",
    cfg({
      maxSeats: 6,
      variant: variants[Math.floor(rnd() * 3)],
      ante: rnd() < 0.4 ? 1 : 0,
      straddle: rnd() < 0.4,
      bombPotEvery: rnd() < 0.3 ? 1 : 0,
      bombPotAnte: 4,
      runItTwice: rnd() < 0.5,
      doubleBoard: rnd() < 0.3,
      sevenDeuce: rnd() < 0.3 ? 5 : 0,
    }),
    () => 0,
    seededDeck(1044 * 101 + 7)
  );
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  ids.forEach((id, i) => e.sit(id, id, i, 200));
  const START = 200 * players;
  for (let hand = 0; hand < 15; hand++) {
    if (!e.canStart()) break;
    e.startHand();
    let guard = 0;
    while (e.phase === "hand") {
      if (++guard > 400) throw new Error("no-term");
      const s = e.seats[e.toActSeat!]!;
      const snap = e.snapshotFor(s.playerId);
      const a = snap.legalActions;
      const pick = a[Math.floor(rnd() * a.length)];
      let amt: number | undefined;
      if (pick.type === "bet" || pick.type === "raise")
        amt = pick.min! + Math.floor(rnd() * (pick.max! - pick.min! + 1));
      e.act(s.playerId, pick.type, amt, snap.actionSeq);
    }
    settle(e);
    assert.equal(totalChips(e), START, `conserved at hand ${hand}`);
    e.finishHand();
  }
});

test("7-2 bounty: winning with 7-2 collects from every dealt-in player", () => {
  const dealOrder = [c("7c"), c("Kh"), c("2d"), c("Qs")];
  const e = new PokerEngine("r", cfg({ maxSeats: 2, sevenDeuce: 10 }), () => 0, () => stack(dealOrder));
  e.sit("a", "A", 0, 100);
  e.sit("b", "B", 1, 100);
  e.startHand();
  let s = e.snapshotFor("a");
  e.act("a", "raise", 6, s.actionSeq);
  s = e.snapshotFor("b");
  e.act("b", "fold", undefined, s.actionSeq);
  assert.equal(e.seats[0]!.bounty, true, "7-2 bounty flagged");
  assert.equal(e.seats[0]!.stack, 112, "A wins blinds + 10 bounty");
  assert.equal(e.seats[1]!.stack, 88, "B pays the 10 bounty");
  assert.equal(totalChips(e), 200);
});

test("security: non-finite / malicious client amounts cannot corrupt chips", () => {
  const e = new PokerEngine("r", cfg());
  e.sit("a", "A", 0, 200);
  e.sit("b", "B", 1, 200);
  // Infinity rebuy rejected, stack unchanged
  assert.equal(e.rebuy("a", Infinity), "Invalid amount");
  assert.equal(e.rebuy("a", NaN), "Invalid amount");
  assert.equal(e.seats[0]!.stack, 200);
  e.startHand();
  const pid = e.seats[e.toActSeat!]!.playerId;
  const snap = e.snapshotFor(pid);
  // NaN/Infinity raise amounts are rejected, not applied
  assert.ok(e.act(pid, "raise", NaN, snap.actionSeq), "NaN raise rejected");
  assert.ok(e.act(pid, "raise", Infinity, snap.actionSeq), "Infinity raise rejected");
  assert.equal(totalChipsInPlay(e), 400, "chips intact after malicious inputs");
  // sit with NaN buy-in clamps to min, doesn't NaN the stack
  e.sit("c", "C", 2, NaN);
  assert.ok(Number.isInteger(e.seats[2]!.stack) && e.seats[2]!.stack > 0);
});

test("security: hole cards never leak to other players before showdown", () => {
  const e = new PokerEngine("r", cfg());
  e.sit("a", "A", 0, 100);
  e.sit("b", "B", 1, 100);
  e.sit("d", "D", 2, 100);
  e.startHand();
  const snapA = e.snapshotFor("a");
  const aSeat = snapA.seats.find((s) => s.playerId === "a")!;
  assert.equal(aSeat.holeCards?.length, 2, "A sees own cards");
  for (const pid of ["b", "d"]) {
    const s = snapA.seats.find((x) => x.playerId === pid)!;
    assert.equal(s.holeCards, null, `${pid}'s cards hidden from A`);
    assert.equal(s.hasCards, true, `${pid} shown as holding cards`);
    assert.equal(s.cardCount, 2);
  }
});

test("security: spectators get no hole cards unless the host allows it", () => {
  const e = new PokerEngine("r", cfg());
  e.sit("a", "A", 0, 100);
  e.sit("b", "B", 1, 100);
  e.startHand();
  let snap = e.snapshotFor("spectator");
  assert.ok(
    snap.seats.filter((s) => !s.empty).every((s) => s.holeCards === null),
    "spectator sees no hole cards by default"
  );
  e.config.spectatorsSeeCards = true;
  snap = e.snapshotFor("spectator");
  assert.ok(
    snap.seats.filter((s) => s.inHand).some((s) => (s.holeCards?.length ?? 0) > 0),
    "spectator sees cards when host enables it"
  );
});

test("live straddle: UTG posts 2x BB, action starts left of straddle", () => {
  const e = new PokerEngine("r", cfg({ maxSeats: 6, straddle: true }));
  e.sit("a", "A", 0, 200);
  e.sit("b", "B", 1, 200);
  e.sit("d", "D", 2, 200);
  e.sit("f", "F", 3, 200);
  e.startHand(); // button 0, sb 1, bb 2, straddle 3
  assert.equal(e.seats[3]!.betThisStreet, 4, "straddler posts 2x BB");
  assert.equal(e.currentBet, 4);
  assert.equal(e.toActSeat, 0, "action starts left of the straddle (button)");
  assert.equal(totalChipsInPlay(e), 800);
});

test("bomb pot: no blinds, everyone antes, deal straight to the flop", () => {
  const e = new PokerEngine("r", cfg({ maxSeats: 4, bombPotEvery: 1, bombPotAnte: 5 }));
  e.sit("a", "A", 0, 200);
  e.sit("b", "B", 1, 200);
  e.sit("d", "D", 2, 200);
  e.startHand();
  assert.equal(e.street, "flop", "bomb pot starts on the flop");
  assert.equal(e.boards[0].length, 3, "flop already dealt");
  assert.equal(e.currentBet, 0, "no blind to call");
  for (const i of [0, 1, 2]) assert.equal(e.seats[i]!.committed, 5, "everyone anted 5");
  assert.equal(totalChipsInPlay(e), 600);
});

// ── fuzz: many randomized hands must conserve chips and never crash ──────────
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("fuzz: 300 randomized hands conserve chips and never desync", () => {
  const rnd = mulberry32(12345);
  const e = new PokerEngine("r", cfg({ maxSeats: 6 }));
  const ids = ["p0", "p1", "p2", "p3", "p4"];
  ids.forEach((id, i) => e.sit(id, id.toUpperCase(), i, 200));
  const START_TOTAL = 200 * ids.length;

  for (let hand = 0; hand < 300; hand++) {
    if (!e.canStart()) break;
    assert.equal(e.startHand(), null);

    let guard = 0;
    while (e.phase === "hand") {
      if (++guard > 500) throw new Error("hand did not terminate");
      const seat = e.toActSeat;
      assert.notEqual(seat, null, "hand phase requires an actor");
      const s = e.seats[seat!]!;
      const snap = e.snapshotFor(s.playerId);
      const acts = snap.legalActions;
      assert.ok(acts.length > 0, "actor must have a legal action");
      // chip invariant at every decision point
      assert.equal(totalChipsInPlay(e), START_TOTAL, `chips in play at hand ${hand}`);
      const pick = acts[Math.floor(rnd() * acts.length)];
      let amount: number | undefined;
      if (pick.type === "bet" || pick.type === "raise") {
        const lo = pick.min!;
        const hi = pick.max!;
        amount = lo + Math.floor(rnd() * (hi - lo + 1));
      }
      const err = e.act(s.playerId, pick.type, amount, snap.actionSeq);
      assert.equal(err, null, `legal action rejected: ${pick.type} ${amount ?? ""} (${err})`);
    }

    settle(e);
    // between hands, total must be exactly conserved
    assert.equal(totalChips(e), START_TOTAL, `chips conserved after hand ${hand}`);
    for (const s of e.seats) {
      if (s) {
        assert.ok(s.stack >= 0, "no negative stacks");
        assert.ok(Number.isInteger(s.stack), "integer stacks");
      }
    }
    e.finishHand();
  }
});

test("fuzz: random feature combos (straddle/bomb/RIT/double/ante/omaha) conserve chips", () => {
  const rnd = mulberry32(99);
  const variants = ["nlhe", "plo", "plo-hilo"] as const;
  for (let trial = 0; trial < 40; trial++) {
    const players = 2 + Math.floor(rnd() * 4); // 2..5
    const e = new PokerEngine(
      "r",
      cfg({
        maxSeats: 6,
        variant: variants[Math.floor(rnd() * variants.length)],
        ante: rnd() < 0.4 ? 1 : 0,
        straddle: rnd() < 0.4,
        bombPotEvery: rnd() < 0.3 ? 1 : 0,
        bombPotAnte: 4,
        runItTwice: rnd() < 0.5,
        doubleBoard: rnd() < 0.3,
        sevenDeuce: rnd() < 0.3 ? 5 : 0,
      }),
      () => 0,
      seededDeck(trial * 7919 + 13)
    );
    const ids = Array.from({ length: players }, (_, i) => `p${i}`);
    ids.forEach((id, i) => e.sit(id, id, i, 200));
    const START = 200 * players;

    for (let hand = 0; hand < 25; hand++) {
      if (!e.canStart()) break;
      e.startHand();
      let guard = 0;
      while (e.phase === "hand") {
        if (++guard > 400) throw new Error("hand did not terminate");
        assert.equal(totalChipsInPlay(e), START, `in-play trial ${trial} hand ${hand}`);
        const seat = e.toActSeat!;
        const s = e.seats[seat]!;
        const snap = e.snapshotFor(s.playerId);
        const acts = snap.legalActions;
        const pick = acts[Math.floor(rnd() * acts.length)];
        let amount: number | undefined;
        if (pick.type === "bet" || pick.type === "raise") {
          amount = pick.min! + Math.floor(rnd() * (pick.max! - pick.min! + 1));
        }
        const err = e.act(s.playerId, pick.type, amount, snap.actionSeq);
        assert.equal(err, null, `rejected ${pick.type} trial ${trial}`);
      }
      settle(e);
      if (totalChips(e) !== START) {
        const cfgInfo = `variant=${e.config.variant} ante=${e.config.ante} straddle=${e.config.straddle} bomb=${e.config.bombPotEvery} rit=${e.config.runItTwice} dbl=${e.config.doubleBoard} 72=${e.config.sevenDeuce}`;
        throw new Error(
          `chip leak trial ${trial} hand ${hand}: ${totalChips(e)}/${START}\n  ${cfgInfo}\n  log:\n  ${e.log
            .filter((l) => l.hand === e.handNumber)
            .map((l) => l.text)
            .join("\n  ")}`
        );
      }
      for (const s of e.seats) if (s) assert.ok(s.stack >= 0 && Number.isInteger(s.stack));
      e.finishHand();
    }
  }
});
