// Shared UI pacing for the realtime servers — a single source of truth so the
// single-table (server.ts) and multi-table (tournament.ts) paths stay in
// lockstep. These two constants previously drifted (4500/1100 vs 4000/1000),
// giving tournaments a subtly different rhythm; unified here.
export const SHOWDOWN_DELAY_MS = 4500; // result stays up before the next hand
export const RUNOUT_STEP_MS = 1100; // pause between flop/turn/river on an all-in run-out
