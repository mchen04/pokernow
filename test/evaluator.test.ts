import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCard } from "../common/cards.ts";
import {
  evaluate5,
  evaluateBest,
  evaluateOmaha,
  evaluateLow5,
  evaluateOmahaLow,
  compareScore,
  compareLow,
  HandCategory,
} from "../common/evaluator.ts";
import { computeEquity } from "../common/equity.ts";

const h = (s: string) => s.trim().split(/\s+/).map(parseCard);

test("category ordering: each beats the one below", () => {
  const royal = evaluate5(h("As Ks Qs Js Ts"));
  const straightFlush = evaluate5(h("9s 8s 7s 6s 5s"));
  const quads = evaluate5(h("9c 9d 9h 9s Kd"));
  const boat = evaluate5(h("9c 9d 9h Kc Kd"));
  const flush = evaluate5(h("As Js 9s 5s 2s"));
  const straight = evaluate5(h("9c 8d 7h 6s 5d"));
  const trips = evaluate5(h("9c 9d 9h Ks 2d"));
  const twoPair = evaluate5(h("9c 9d Kh Ks 2d"));
  const pair = evaluate5(h("9c 9d Kh 5s 2d"));
  const high = evaluate5(h("Ac Jd 9h 5s 2d"));

  const order = [high, pair, twoPair, trips, straight, flush, boat, quads, straightFlush, royal];
  for (let i = 1; i < order.length; i++) {
    assert.ok(
      compareScore(order[i].tuple, order[i - 1].tuple) > 0,
      `${order[i].label} should beat ${order[i - 1].label}`
    );
  }
  assert.equal(royal.category, HandCategory.StraightFlush);
  assert.equal(royal.label, "Royal Flush");
});

test("wheel straight A-2-3-4-5 is 5-high, loses to 6-high straight", () => {
  const wheel = evaluate5(h("Ad 2c 3h 4s 5d"));
  const six = evaluate5(h("6d 2c 3h 4s 5d"));
  assert.equal(wheel.category, HandCategory.Straight);
  assert.equal(wheel.tuple[1], 5);
  assert.ok(compareScore(six.tuple, wheel.tuple) > 0);
});

test("steel wheel is a straight flush, 5-high", () => {
  const steel = evaluate5(h("As 2s 3s 4s 5s"));
  assert.equal(steel.category, HandCategory.StraightFlush);
  assert.equal(steel.tuple[1], 5);
});

test("kicker resolution for one pair", () => {
  const a = evaluate5(h("Kc Kd Ah 5s 2d"));
  const b = evaluate5(h("Kc Kd Qh 5s 2d"));
  assert.ok(compareScore(a.tuple, b.tuple) > 0, "ace kicker beats queen kicker");
});

test("two pair tiebreak by high pair then low pair then kicker", () => {
  const a = evaluate5(h("Ac Ad 3h 3s Kd"));
  const b = evaluate5(h("Ac Ad 2h 2s Kd"));
  assert.ok(compareScore(a.tuple, b.tuple) > 0);
});

test("evaluateBest picks best 5 of 7", () => {
  // board makes a flush available
  const score = evaluateBest(h("As Ks  2s 7s 9s 3d 4c"));
  assert.equal(score.category, HandCategory.Flush);
  assert.equal(score.tuple[1], 14); // ace-high flush
});

test("evaluateBest: full house from 7", () => {
  const score = evaluateBest(h("9c 9d  9h Kc Kd 2s 3h"));
  assert.equal(score.category, HandCategory.FullHouse);
});

test("Omaha must use exactly two hole cards", () => {
  // hole has three spades but only two may be used: no flush from one hole spade
  const hole = h("As 2s 3d 4d");
  const board = h("Ks Qs Js 5h 6h");
  const score = evaluateOmaha(hole, board);
  // Using As+2s (2 hole) + Ks Qs Js (3 board) = flush. That's allowed (2 hole spades).
  assert.equal(score.category, HandCategory.Flush);

  // Now only ONE hole spade -> cannot complete the board's spade flush
  const hole2 = h("As 2d 3d 4c");
  const board2 = h("Ks Qs Js 5h 6h");
  const score2 = evaluateOmaha(hole2, board2);
  assert.notEqual(score2.category, HandCategory.Flush);
});

test("low hand: wheel is the nut low; non-qualifying returns null", () => {
  const nut = evaluateLow5(h("Ad 2c 3h 4s 5d"));
  assert.deepEqual(nut, [5, 4, 3, 2, 1]);
  const none = evaluateLow5(h("9d Tc Jh Qs Kd"));
  assert.equal(none, null);
  const better = evaluateLow5(h("Ad 2c 3h 4s 6d")); // 6-4-3-2-A
  assert.ok(compareLow(nut!, better!) < 0, "wheel beats 6-low");
});

test("Omaha low uses exactly two hole + three board", () => {
  const hole = h("As 2s Kd Qd");
  const board = h("3h 4c 5d 9s Th");
  const low = evaluateOmahaLow(hole, board);
  // best low: A,2 (hole) + 3,4,5 (board) = wheel
  assert.deepEqual(low, [5, 4, 3, 2, 1]);
});

test("hi/lo equity: a high-only winner gets ~half the pot when a low qualifies", () => {
  // Board 3 5 7 9 K. A = trips kings (high, no low). B = nut-ish low + weak high.
  // The pot splits 50/50, so each player's equity (expected pot share) is 0.5 —
  // NOT 1.0/0.0 as a high-only calculation would report.
  const board = h("3d 5h 7s 9c Kc");
  const A = h("Ks Kh Qs Qd"); // trips K, no qualifying low
  const B = h("Ad 2h 8s 9d"); // A-2 low (3,5,7 board), only a pair high
  const res = computeEquity(
    [
      { id: 0, holeCards: A },
      { id: 1, holeCards: B },
    ],
    [board],
    [],
    { omaha: true, holeCount: 2, hiLo: true }
  );
  assert.equal(res.method, "exact");
  assert.ok(Math.abs((res.equity.get(0) ?? 0) - 0.5) < 1e-9, "high-only A gets half");
  assert.ok(Math.abs((res.equity.get(1) ?? 0) - 0.5) < 1e-9, "low+weak-high B gets half");
});

test("hi/lo equity: with no qualifying low the high scoops (equity 1.0)", () => {
  const board = h("9d Tc Jh Qs Kd"); // no low possible (all ranks > 8 except none ≤8 set of 5)
  const A = h("As Ah 2c 3c"); // best high: A-high straight? uses 2 hole+3 board
  const B = h("9s 9h 4c 5c"); // trips nines
  const res = computeEquity(
    [
      { id: 0, holeCards: A },
      { id: 1, holeCards: B },
    ],
    [board],
    [],
    { omaha: true, holeCount: 2, hiLo: true }
  );
  // Whoever wins high takes 100% since no low qualifies; equities sum to 1 and
  // one side is 1.0.
  const total = (res.equity.get(0) ?? 0) + (res.equity.get(1) ?? 0);
  assert.ok(Math.abs(total - 1) < 1e-9, "equities sum to 1");
  assert.ok((res.equity.get(0) ?? 0) === 1 || (res.equity.get(1) ?? 0) === 1, "high scoops, no split");
});
