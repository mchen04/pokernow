import { test } from "node:test";
import assert from "node:assert/strict";
import { Tournament } from "../party/poker/tournament.ts";
import { DEFAULT_CONFIG, type TableConfig } from "../common/config.ts";

function cfg(over: Partial<TableConfig> = {}): TableConfig {
  return { ...DEFAULT_CONFIG, ...over };
}

function totalChips(T: Tournament): number {
  return T.tables.reduce((sum, t) => sum + t.engine.chipsInPlay(), 0);
}

// Jam every decision without advancing the action clock; only advance time when
// no one is to act (to clear the showdown delay / start the next hand). This
// avoids spurious action-timeouts from fast-forwarding the clock mid-betting.
function runToCompletion(T: Tournament, clockRef: { t: number }) {
  let guard = 0;
  while (!T.finished && guard++ < 8000) {
    let acted = false;
    for (const tbl of T.tables) {
      const e = tbl.engine;
      if (e.phase === "hand" && e.toActSeat !== null) {
        const s = e.seats[e.toActSeat];
        if (s) {
          T.act(s.playerId, "allin", undefined, e.snapshotFor(s.playerId).actionSeq);
          acted = true;
        }
      }
    }
    if (!acted) clockRef.t += 5000;
    T.tick();
  }
}

test("MTT: multi-table creation, eliminations, consolidation, payouts, chip conservation", () => {
  // cap = min(maxSeats,9) = 2 -> 6 players => 3 tables of 2
  const clockRef = { t: 0 };
  const conf = cfg({ tourneyTableSize: 2, tourneyStartingStack: 100, tourneyLevelSec: 1 });
  const regs = Array.from({ length: 6 }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` }));
  const T = new Tournament("r", conf, regs, () => clockRef.t);

  assert.equal(T.tables.length, 3, "6 players / cap 2 = 3 tables");
  assert.equal(totalChips(T), 600, "all entrant chips present");

  runToCompletion(T, clockRef);

  assert.equal(T.finished, true, "tournament completes");
  assert.equal(totalChips(T), 600, "chips conserved end-to-end (winner holds all)");
  assert.equal(T.tables.length, 1, "consolidated to a final table");
  assert.equal(T.standings.length, 6, "every entrant placed");

  const places = T.standings.map((s) => s.place).sort((a, b) => a - b);
  assert.deepEqual(places, [1, 2, 3, 4, 5, 6], "places 1..6 assigned");

  // payouts: 6 players -> structure [0.65, 0.35] of a 600 pool
  const paid = T.standings.filter((s) => s.payout > 0);
  assert.equal(paid.length, 2, "top 2 paid");
  const pool = T.standings.reduce((a, s) => a + s.payout, 0);
  assert.equal(pool, 600, "payouts sum to the prize pool");
  assert.equal(T.standings[0].place, 1);
  assert.ok(T.standings[0].payout >= T.standings[1].payout, "1st >= 2nd");
});

test("SNG via coordinator: single table when field fits the cap", () => {
  const clockRef = { t: 0 };
  const conf = cfg({ tourneyTableSize: 9, tourneyStartingStack: 100, tourneyLevelSec: 1 });
  const regs = Array.from({ length: 3 }, (_, i) => ({ playerId: `p${i}`, name: `P${i}` }));
  const T = new Tournament("r", conf, regs, () => clockRef.t);
  assert.equal(T.tables.length, 1, "3 players, cap 9 -> one table");

  runToCompletion(T, clockRef);
  assert.equal(T.finished, true);
  assert.equal(totalChips(T), 300, "chips conserved");
  assert.equal(T.standings.length, 3);
});
