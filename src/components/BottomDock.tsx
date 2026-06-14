import type { ClientMessage, PublicSeat, PublicTableState } from "@common/protocol";
import { ActionBar } from "./ActionBar";
import { CircleDollarSign, Eye, Play, Rabbit, Trophy } from "./Icon";

// One persistent bottom dock — the only layer holding turn controls (M1). It is a
// normal flex child pinned at the bottom of the 100dvh shell (not a floating band
// over the felt), so the table area above it is exactly the remaining space and no
// seat can hide beneath it. Inset above the home indicator via `dock-safe-b`.
//
// Seat-management (Stand up / Leave table) lives in the felt's top-left cluster
// now — kept out of the easily-fat-fingered dock — so this dock only ever shows
// the betting controls (hero's turn) or the start / sit-back-in / rebuy / rabbit
// controls (between turns).

const PRIMARY =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold text-white shadow active:scale-[.98] transition";

export function BottomDock({
  state,
  send,
  me,
  isHost,
  myTurn,
  error,
  onRebuy,
}: {
  state: PublicTableState;
  send: (m: ClientMessage) => void;
  me: PublicSeat | null;
  isHost: boolean;
  myTurn: boolean;
  error: string | null;
  onRebuy: () => void;
}) {
  const inTourney = !!state.tourney?.active;
  // Busted in a cash game: stack is gone AND the hand is over (not mid all-in),
  // so re-buying is what brings the player back. Tournaments have no rebuys.
  const busted = !!me && me.stack <= 0 && !me.allIn && !inTourney;
  const canStart = isHost && state.canStart && !state.handInProgress;
  // After a hand, anyone who was dealt in (incl. a folder) can voluntarily show.
  const canShow =
    !!me && !me.revealed && !!me.holeCards && (state.phase === "showdown" || state.phase === "between");

  return (
    <div className="dock-safe-b safe-x relative z-30 shrink-0 border-t border-white/10 bg-slate-900/95 px-3 pt-2 backdrop-blur">
      {/* Transient errors float ABOVE the dock (over the felt) so they never
          change the dock's height — the body below holds a constant height so
          the table never re-fits when the turn enters/leaves the hero. */}
      {error && (
        <div className="pointer-events-none absolute inset-x-0 bottom-full mb-2 px-3">
          <div className="mx-auto max-w-3xl rounded-md bg-rose-600/95 px-3 py-1.5 text-center text-sm font-medium text-white shadow-lg">
            {error}
          </div>
        </div>
      )}

      {/* Constant-height body: the betting controls and the seat/host controls
          occupy the exact same vertical space, vertically centered, so swapping
          between them produces zero layout shift in the table above. */}
      <div className="dock-body mx-auto flex w-full max-w-3xl flex-col justify-center overflow-hidden">
        {myTurn ? (
          <ActionBar state={state} send={send} />
        ) : (
          <div className="flex max-h-full flex-col gap-2 overflow-y-auto">
            {busted ? (
              <p className="text-center text-xs text-amber-300/90">
                You&apos;re out of chips — re-buy to get back in the game.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-center gap-2">
              {busted && (
                <button onClick={onRebuy} className={`${PRIMARY} bg-emerald-600 hover:bg-emerald-500`}>
                  <CircleDollarSign size={18} /> Re-buy &amp; sit back in
                </button>
              )}

              {canShow && (
                <button
                  onClick={() => send({ type: "showCards" })}
                  className={`${PRIMARY} bg-sky-600 hover:bg-sky-500`}
                >
                  <Eye size={18} /> Show cards
                </button>
              )}

              {/* Only the very first deal is manual; subsequent hands deal
                  automatically, so there's no "resume dealing" button to race
                  the auto-deal timer (which caused double-deals). */}
              {canStart && state.handNumber === 0 && (
                <button
                  onClick={() => send({ type: "startGame" })}
                  className={`${PRIMARY} bg-emerald-600 hover:bg-emerald-500`}
                >
                  <Play size={18} /> Start game
                </button>
              )}
              {canStart && !state.tourney && state.handNumber === 0 && (
                <button
                  onClick={() => send({ type: "startTournament" })}
                  className={`${PRIMARY} bg-amber-500 text-slate-900 hover:bg-amber-400`}
                >
                  <Trophy size={18} /> Start tournament
                </button>
              )}

              {state.rabbitAvailable && me && !state.lastHandRabbit && (
                <button
                  onClick={() => send({ type: "rabbitHunt" })}
                  className={`${PRIMARY} bg-purple-600 hover:bg-purple-500`}
                >
                  <Rabbit size={18} /> Rabbit hunt
                </button>
              )}

              {!me && (
                <span className="rounded-md bg-black/40 px-3 py-2 text-sm text-white/70">
                  Click an open seat to sit down.
                </span>
              )}
              {isHost && !state.canStart && !state.handInProgress && me && !busted && (
                <span className="rounded-md bg-black/40 px-3 py-2 text-sm text-white/60">
                  Need 2+ players to start.
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
