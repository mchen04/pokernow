import type { ClientMessage, PublicSeat, PublicTableState } from "@common/protocol";
import { ActionBar } from "./ActionBar";
import { heroHandLabel } from "../lib/handHint";
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
  now,
  suppressActionBar = false,
  onRebuy,
}: {
  state: PublicTableState;
  send: (m: ClientMessage) => void;
  me: PublicSeat | null;
  isHost: boolean;
  myTurn: boolean;
  error: string | null;
  now: number;
  suppressActionBar?: boolean;
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

  // Beginner aid: a small "you have …" hint floats above the dock whenever the
  // hero holds a live made hand, so a player who can't yet read a board always
  // knows what they're holding — visible on and off their turn (zero dock height).
  const handLabel = heroHandLabel(state);

  // Whose turn is it when it's NOT the hero — keeps the non-turn band informative
  // instead of dead space (and reassures everyone the game is moving).
  const actor = state.toActSeat !== null ? state.seats[state.toActSeat] : null;
  const waitingName = actor && !actor.empty && state.toActSeat !== state.yourSeat ? actor.name : null;

  return (
    <div className="dock-safe-b safe-x relative z-30 shrink-0 border-t border-white/10 bg-slate-900/95 px-3 pt-2 backdrop-blur">
      {/* Floating "you have …" hint (above the dock, over the felt) — no dock height. */}
      {handLabel && (
        <div className="pointer-events-none absolute inset-x-0 bottom-full mb-1 flex justify-center px-3">
          <span className="rounded-full bg-black/70 px-3 py-0.5 text-[12px] font-semibold text-emerald-200 shadow ring-1 ring-emerald-400/20">
            You have: {handLabel}
          </span>
        </div>
      )}

      {/* Transient errors float ABOVE the dock (over the felt) so they never
          change the dock's height — the body below holds a constant height so
          the table never re-fits when the turn enters/leaves the hero. Offset
          above the hand hint so the two never overlap. */}
      {error && (
        <div className="pointer-events-none absolute inset-x-0 bottom-full mb-8 px-3">
          <div className="mx-auto max-w-3xl rounded-md bg-rose-600/95 px-3 py-1.5 text-center text-sm font-medium text-white shadow-lg">
            {error}
          </div>
        </div>
      )}

      {/* Content-sized body: a tall betting bar on the hero's turn, a compact
          status row otherwise. The felt re-fits to the freed space with a smooth
          transition (PokerTable), so short viewports get a bigger table whenever
          it isn't the hero's turn. */}
      <div className="dock-body mx-auto flex w-full max-w-3xl flex-col justify-center lg:max-w-4xl xl:max-w-5xl">
        {myTurn && !suppressActionBar ? (
          <ActionBar state={state} send={send} now={now} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2">
            {busted ? (
              <p className="text-center text-xs text-amber-300/90">
                You&apos;re out of chips — re-buy to get back in the game.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-center gap-2">
              {busted && (
                <button onClick={onRebuy} className={`${PRIMARY} bg-emerald-700 hover:bg-emerald-600`}>
                  <CircleDollarSign size={18} /> Re-buy &amp; sit back in
                </button>
              )}

              {canShow && (
                <button
                  onClick={() => send({ type: "showCards" })}
                  className={`${PRIMARY} bg-sky-700 hover:bg-sky-600`}
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
                  className={`${PRIMARY} bg-emerald-700 hover:bg-emerald-600`}
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
              {/* keep the band informative while waiting on another player */}
              {waitingName && state.handInProgress && !busted && !canShow && (
                <span className="inline-flex items-center gap-2 rounded-md bg-black/40 px-3 py-2 text-sm text-white/55">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
                  Waiting for {waitingName}…
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
