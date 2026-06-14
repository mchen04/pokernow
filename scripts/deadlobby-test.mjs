// Dead-lobby verification. Plays a few hands with 3 clients, disconnects ALL of
// them (room becomes empty), waits, then reconnects a probe and checks that the
// game FROZE while empty (handNumber unchanged) — i.e. the server stopped its
// timers instead of dealing to nobody. Then reconnects players and confirms the
// game RESUMES (handNumber advances again).

import { WebSocket } from "ws";

const HOST = process.argv[2] || "localhost:1999";
const ROOM = process.argv[3] || "deadlobby-probe";
const url = `ws://${HOST}/parties/main/${ROOM}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

function makePlayer(name, seat, playerId = rid()) {
  const ws = new WebSocket(url);
  const self = { name, playerId, ws, state: null, acted: -1, sat: false };
  ws.on("open", () => ws.send(JSON.stringify({ type: "join", playerId, name })));
  ws.on("message", (d) => {
    let m;
    try { m = JSON.parse(d.toString()); } catch { return; }
    if (m.type === "error") { self.sat = false; return; } // retry sit on collision
    if (m.type !== "state") return;
    const s = (self.state = m.state);
    const mine = s.yourSeat !== null ? s.seats[s.yourSeat] : null;
    if (!mine && !self.sat && (s.phase === "lobby" || s.phase === "between" || s.phase === "showdown")) {
      // claim our designated seat (distinct per player) to avoid races
      if (s.seats[seat]?.empty) { self.sat = true; ws.send(JSON.stringify({ type: "sit", seat, buyIn: 1000 })); }
      return;
    }
    if (s.hostId === playerId && !self.configured) {
      self.configured = true; // short action clock so the freeze test is conclusive
      ws.send(JSON.stringify({ type: "updateConfig", config: { actionTimeSec: 10 } }));
    }
    if (s.hostId === playerId && s.canStart && !s.handInProgress) {
      ws.send(JSON.stringify({ type: "startGame" }));
    }
    if (s.phase === "hand" && s.toActSeat === s.yourSeat && s.legalActions?.length && self.acted !== s.actionSeq) {
      self.acted = s.actionSeq;
      const a = s.legalActions;
      const act = a.find((x) => x.type === "check") || a.find((x) => x.type === "call") || a.find((x) => x.type === "fold");
      setTimeout(() => ws.send(JSON.stringify({ type: "action", action: act.type, seq: s.actionSeq })), 200);
    }
  });
  return self;
}

// A read-only probe: joins, captures the FIRST state snapshot it receives.
function probeFirstState(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const playerId = rid();
    const ws = new WebSocket(url);
    let done = false;
    const finish = (state) => { if (done) return; done = true; ws.close(); resolve(state); };
    ws.on("open", () => ws.send(JSON.stringify({ type: "join", playerId, name: "Probe" })));
    ws.on("message", (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch { return; }
      if (m.type === "state") finish(m.state); // first snapshot = state at reconnect (pre-resume)
    });
    setTimeout(() => finish(null), timeoutMs);
  });
}

async function main() {
  console.log(`Dead-lobby test on ${url}`);
  const players = [makePlayer("Ada",0), makePlayer("Bo",1), makePlayer("Cy",2)];
  // play until a few hands are in
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const h = players[0].state?.handNumber ?? 0;
    if (h >= 3) break;
  }
  const H1 = players[0].state?.handNumber ?? 0;
  console.log(`Played to hand #${H1}. Disconnecting ALL clients (room goes empty)…`);
  for (const p of players) p.ws.close();

  await sleep(25000); // empty window >> the 10s action clock: old code would deal several hands here

  const frozen = await probeFirstState();
  const H2 = frozen?.handNumber ?? -1;
  console.log(`After 25s empty (10s action clock), first snapshot on reconnect: hand #${H2}`);
  console.log(H2 === H1
    ? `FREEZE PASS ✓ — game did not advance while the room was empty (#${H1} → #${H2})`
    : `FREEZE FAIL ✗ — game advanced ${H2 - H1} hands to nobody (#${H1} → #${H2})`);

  // resume check: reconnect players and confirm the game comes back to life
  console.log(`Reconnecting players to verify resume…`);
  const players2 = players.map((p, i) => makePlayer(p.name, i, p.playerId)); // same ids -> reclaim seats
  let H3 = H2;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    H3 = players2[0].state?.handNumber ?? H2;
    if (H3 > H2) break;
  }
  console.log(H3 > H2
    ? `RESUME PASS ✓ — game resumed after reconnect (#${H2} → #${H3})`
    : `RESUME FAIL ✗ — game did not resume (#${H2} → #${H3})`);

  for (const p of players2) p.ws.close();
  await sleep(300);
  process.exit(0);
}
main();
