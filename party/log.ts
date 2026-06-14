// Structured operational logging for the realtime servers.
//
// This is the OPS log — distinct from the in-game log (engine.addLog), which is
// user-facing hand history. One JSON object per line to stdout, picked up by the
// platform's log drain. It deliberately never includes hole cards, the deck, or
// chat text — only lifecycle and diagnostic metadata (room, playerId, counts,
// error shapes). Logging must never throw or interfere with gameplay.

export type LogLevel = "info" | "warn" | "error";

export function olog(level: LogLevel, event: string, ctx?: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify({ ts: Date.now(), level, event, ...ctx }));
  } catch {
    /* never let logging break the game loop */
  }
}

// Largest client message we'll parse. Legitimate game messages are well under a
// kilobyte; WebRTC signaling (SDP) is the only large payload and stays far below
// this. Anything bigger is dropped (and logged) before JSON.parse touches it.
export const MAX_MESSAGE_BYTES = 64_000;
