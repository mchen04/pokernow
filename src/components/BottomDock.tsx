import { useEffect, useRef, useState } from "react";
import type { ClientMessage, PublicSeat, PublicTableState } from "@common/protocol";
import { fmtChips } from "@common/money";
import { ActionBar } from "./ActionBar";
import { PreActionBar } from "./PreActionBar";
import { CircleDollarSign, CirclePlay, Eye, Play, Rabbit, Trophy } from "./Icon";

// A queued "pre-action" the hero picks before it's their turn; it fires the
// instant the turn arrives and auto-clears if the betting context changes so a
// player never accidentally calls a raise they didn't agree to (KR7).
export type PreAction = "check" | "check-fold" | "call" | "call-any" | "fold";

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
  const sitOutQueued = !!me && me.sittingOut && me.inHand && !busted && !inTourney;
  const sittingOut = !!me && me.sittingOut && !me.inHand && !busted && !inTourney;
  const canStart = isHost && state.canStart && !state.handInProgress;
  // After a hand, anyone who was dealt in (incl. a folder) can voluntarily show.
  const canShow =
    !!me && !me.revealed && !!me.holeCards && (state.phase === "showdown" || state.phase === "between");

  // Whose turn is it when it's NOT the hero — keeps the non-turn band informative
  // instead of dead space (and reassures everyone the game is moving).
  const actor = state.toActSeat !== null ? state.seats[state.toActSeat] : null;
  const waitingName = actor && !actor.empty && state.toActSeat !== state.yourSeat ? actor.name : null;

  // ALWAYS reserve the betting-bar height. The dock is a constant height in every
  // state (lobby, waiting, your turn) so the felt above it never re-fits — the
  // table is fully static and never zooms or shifts as turns pass. The reserved
  // band is never empty: it holds the action bar (your turn), the pre-action
  // chips (waiting), or the start/rebuy/status controls (between hands).
  const reserveBetting = true;

  // ── Pre-action (act-in-turn) controls ────────────────────────────────────
  // Shown while a betting round is live and the hero is in the hand but waiting
  // on someone else. The hero queues an action; it fires the moment the turn
  // arrives and clears if the price changes (KR7).
  const [preAction, setPreAction] = useState<PreAction | null>(null);
  const preCallAmtRef = useRef(0); // the call price the hero agreed to (for "call")
  const heroInHand =
    !!me && me.inHand && !me.folded && !me.allIn && me.hasCards && state.phase === "hand";
  const toCall = me ? Math.max(0, state.currentBet - me.betThisStreet) : 0;
  const canPreCheck = toCall === 0;
  const showPreActions = heroInHand && !myTurn && !!waitingName;

  // Stop offering pre-actions (and drop any selection) when the hero can no
  // longer be waiting — turn arrived, folded, hand ended, etc.
  useEffect(() => {
    if (!showPreActions && preAction && !myTurn) setPreAction(null);
  }, [showPreActions, preAction, myTurn]);

  // Clear a selection the betting context has invalidated: a plain "check" once a
  // bet appears, or a fixed-price "call" once that price moves. "Check/Fold",
  // "Call Any" and "Fold" intentionally persist through raises.
  useEffect(() => {
    if (preAction === "check" && toCall > 0) setPreAction(null);
    else if (preAction === "call" && toCall !== preCallAmtRef.current) setPreAction(null);
  }, [toCall, preAction]);

  // Fire the queued pre-action the instant it becomes the hero's turn.
  useEffect(() => {
    if (!myTurn || !preAction) return;
    const acts = state.legalActions;
    const canCheck = acts.some((a) => a.type === "check");
    const callAct = acts.find((a) => a.type === "call");
    const seq = state.actionSeq;
    const fire = (action: "fold" | "check" | "call", amount?: number) =>
      send({ type: "action", action, amount, seq });
    switch (preAction) {
      case "fold":
        fire("fold");
        break;
      case "check":
        if (canCheck) fire("check");
        break;
      case "check-fold":
        if (canCheck) fire("check");
        else fire("fold");
        break;
      case "call":
        if (callAct && (callAct.amount ?? 0) === preCallAmtRef.current) fire("call");
        else if (canCheck) fire("check");
        break;
      case "call-any":
        if (callAct) fire("call");
        else if (canCheck) fire("check");
        break;
    }
    setPreAction(null);
    // Fire exactly once when the turn arrives; reading the rest fresh is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn]);

  const selectPre = (a: PreAction) => {
    setPreAction((cur) => {
      if (cur === a) return null; // toggle off
      if (a === "call") preCallAmtRef.current = toCall;
      return a;
    });
  };

  return (
    <div className="dock-safe-b safe-x relative z-30 shrink-0 border-t border-white/10 bg-[#121413]/92 px-3 pt-2 backdrop-blur">
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

      {/* The body reserves betting-control height even for status-only states, so
          the felt fit stays stable as action moves around the table. */}
      <div className={`dock-body mx-auto flex w-full max-w-3xl flex-col justify-center lg:max-w-4xl xl:max-w-5xl ${reserveBetting ? "reserve" : ""}`}>
        {myTurn && !suppressActionBar ? (
          <ActionBar state={state} send={send} now={now} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2">
            {busted ? (
              <p className="text-center text-xs text-amber-300/90">
                You&apos;re out of chips — re-buy to get back in the game.
              </p>
            ) : null}
            {sittingOut ? (
              <p className="text-center text-xs text-amber-300/90">
                You&apos;re sitting out — use I&apos;m back to be dealt in again.
              </p>
            ) : null}
            {sitOutQueued ? (
              <p className="text-center text-xs text-amber-300/90">
                You&apos;ll sit out after this hand.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-center gap-2">
              {busted && (
                <button onClick={onRebuy} className={`${PRIMARY} bg-emerald-700 hover:bg-emerald-600`}>
                  <CircleDollarSign size={18} /> Re-buy &amp; sit back in
                </button>
              )}
              {sittingOut && (
                <button onClick={() => send({ type: "sitIn" })} className={`${PRIMARY} bg-emerald-700 hover:bg-emerald-600`}>
                  <CirclePlay size={18} /> I&apos;m back
                </button>
              )}
              {sitOutQueued && (
                <button onClick={() => send({ type: "sitIn" })} className={`${PRIMARY} bg-amber-600 text-slate-950 hover:bg-amber-500`}>
                  <CirclePlay size={18} /> Cancel sit-out
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
              {/* Pre-action controls while waiting on another player; falls back
                  to a plain "waiting" caption when the hero isn't in the hand. */}
              {showPreActions && !busted && !sittingOut && !sitOutQueued && !canShow ? (
                <PreActionBar
                  selected={preAction}
                  canCheck={canPreCheck}
                  callLabel={fmtChips(toCall)}
                  waitingName={waitingName}
                  onSelect={selectPre}
                />
              ) : (
                waitingName && state.handInProgress && !busted && !sittingOut && !sitOutQueued && !canShow && (
                  <span className="inline-flex items-center gap-2 rounded-md bg-black/40 px-3 py-2 text-sm text-white/55">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
                    Waiting for {waitingName}…
                  </span>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
