import { useEffect, useMemo, useState } from "react";
import type { ClientMessage, PublicTableState } from "@common/protocol";
import { fmtChips } from "@common/money";

// Light haptic feedback on commit actions (no-op where unsupported / on desktop).
function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}

export function ActionBar({ state, send }: { state: PublicTableState; send: (m: ClientMessage) => void }) {
  const acts = state.legalActions;
  const canCheck = acts.some((a) => a.type === "check");
  const callAct = acts.find((a) => a.type === "call");
  const aggro = acts.find((a) => a.type === "bet" || a.type === "raise");
  const isOpen = aggro?.type === "bet";

  const min = aggro?.min ?? 0;
  const max = aggro?.max ?? 0;
  const [raiseTo, setRaiseTo] = useState(min);
  // While the user is actively editing the exact-amount field we let it hold a
  // raw string (including ""), so deleting the contents shows an empty box
  // rather than snapping to 0. `raiseTo` keeps the last valid number, so you can
  // never commit "nothing". `null` means "not editing — mirror raiseTo".
  const [draft, setDraft] = useState<string | null>(null);

  // The smallest raise-to that commits the hero's whole stack = going all in.
  // In NLHE this equals `max`; in pot-limited Omaha the pot cap can sit below
  // it, so detect all-in explicitly rather than assuming max === all-in.
  const me = state.yourSeat !== null ? state.seats[state.yourSeat] : null;
  const allInTo = me ? me.betThisStreet + me.stack : max;
  const maxIsAllIn = max >= allInTo;

  // reset the slider when it becomes our turn / the betting context changes
  useEffect(() => {
    setRaiseTo(min);
  }, [state.actionSeq, min]);

  const afterCallPot = state.potForBet + state.callAmount;
  const bb = state.config.bigBlind;
  // Sizing presets reflect what solvers / winning pros actually use:
  //  • Preflop they think in multiples of the bet, not pot fractions —
  //    ~2.5–3x big-blind opens, ~3–4x re-raises (3-bets/4-bets).
  //  • Postflop they think in pot fractions — the ⅓-pot small c-bet is the
  //    most common modern size, alongside ½, ¾ and pot.
  const presets = useMemo(() => {
    if (!aggro) return [] as { label: string; to: number }[];
    const preflop = state.street === "preflop";
    if (preflop) {
      if (isOpen) {
        // Opening the pot: raise-to as a multiple of the big blind.
        return [
          { label: "2x", to: clamp(2 * bb, min, max) },
          { label: "2.5x", to: clamp(Math.round(2.5 * bb), min, max) },
          { label: "3x", to: clamp(3 * bb, min, max) },
        ];
      }
      // Facing a raise: 3-bet / 4-bet to a multiple of the current bet.
      return [
        { label: "3x", to: clamp(3 * state.currentBet, min, max) },
        { label: "4x", to: clamp(4 * state.currentBet, min, max) },
        { label: "Pot", to: clamp(state.currentBet + Math.round(afterCallPot), min, max) },
      ];
    }
    const base = isOpen ? 0 : state.currentBet;
    const mk = (f: number) => clamp(base + Math.round(f * afterCallPot), min, max);
    return [
      { label: "⅓", to: mk(1 / 3) },
      { label: "½", to: mk(0.5) },
      { label: "¾", to: mk(0.75) },
      { label: "Pot", to: mk(1) },
    ];
  }, [aggro, isOpen, state.street, state.currentBet, afterCallPot, bb, min, max]);

  if (acts.length === 0) return null;

  const act = (action: "fold" | "check" | "call" | "bet" | "raise", amount?: number) => {
    if (action === "fold") buzz(8);
    if (action === "bet" || action === "raise") buzz(12);
    send({ type: "action", action, amount, seq: state.actionSeq });
  };

  // Keyboard hotkeys (PokerNow-style): F fold, C call, K check, B/R focus raise,
  // A all-in, Enter confirm bet/raise. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (e.key === "Enter" && aggro) {
        act(aggro.type as "bet" | "raise", clamp(raiseTo, min, max));
        return;
      }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === "f" && acts.some((a) => a.type === "fold")) act("fold");
      else if (k === "k" && canCheck) act("check");
      else if (k === "c") {
        if (canCheck) act("check");
        else if (callAct) act("call");
      } else if ((k === "b" || k === "r") && aggro) setRaiseTo((v) => clamp(v || min, min, max));
      else if (k === "a" && aggro) setRaiseTo(max);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.actionSeq, raiseTo, min, max, canCheck, callAct, aggro]);

  const presetChip =
    "h-8 flex-1 rounded-lg bg-slate-700 px-2 text-sm font-bold text-white hover:bg-slate-600 active:scale-[.97] transition";
  // Shared base for the three commit buttons — 44px stays at the touch-target
  // floor while keeping the bar vertically compact.
  const ACTION =
    "min-h-[44px] flex-1 rounded-lg px-4 text-sm font-bold text-white active:scale-[.98] transition";

  return (
    <div className="flex flex-col gap-1">
      {aggro && max > min && (
        <>
          {/* preset sizing chips — the primary one-tap path */}
          <div className="flex gap-1.5">
            <button className={presetChip} onClick={() => setRaiseTo(min)}>
              Min
            </button>
            {presets.map((p) => (
              <button key={p.label} className={presetChip} onClick={() => setRaiseTo(p.to)}>
                {p.label}
              </button>
            ))}
            <button
              className={`h-8 flex-1 rounded-lg px-2 text-sm font-bold text-white active:scale-[.97] transition ${
                maxIsAllIn ? "bg-red-600 hover:bg-red-500" : "bg-slate-700 hover:bg-slate-600"
              }`}
              onClick={() => setRaiseTo(max)}
            >
              {maxIsAllIn ? "All in" : "Max"}
            </button>
          </div>
          {/* slider + exact amount */}
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={min}
              max={max}
              value={raiseTo}
              onChange={(e) => setRaiseTo(Number(e.target.value))}
              aria-label="Bet amount"
              className="dock-range flex-1"
            />
            <input
              type="text"
              inputMode="numeric"
              value={draft ?? String(raiseTo)}
              onBlur={() => {
                setDraft(null);
                setRaiseTo((v) => clamp(v, min, max));
              }}
              onChange={(e) => {
                const t = e.target.value;
                if (t === "") {
                  // Allow an empty box while editing; keep the last valid
                  // raiseTo so the commit button can't bet nothing.
                  setDraft("");
                  return;
                }
                if (!/^\d+$/.test(t)) return; // ignore non-numeric input
                setDraft(t);
                setRaiseTo(Number(t));
              }}
              aria-label="Exact bet amount"
              className="w-20 rounded-lg bg-slate-800 px-2 py-1 text-right text-sm font-bold text-white tabular-nums outline-none ring-1 ring-white/10 focus:ring-emerald-400"
            />
          </div>
        </>
      )}
      <div className="flex gap-2">
        {acts.some((a) => a.type === "fold") && (
          <button onClick={() => act("fold")} className={`${ACTION} bg-rose-600 hover:bg-rose-500`}>
            Fold
          </button>
        )}
        {canCheck ? (
          <button onClick={() => act("check")} className={`${ACTION} bg-emerald-600 hover:bg-emerald-500`}>
            Check
          </button>
        ) : callAct ? (
          (() => {
            const callAllIn = me ? (callAct.amount ?? 0) >= me.stack : false;
            return (
              <button
                onClick={() => act("call")}
                className={`${ACTION} ${callAllIn ? "bg-red-600 hover:bg-red-500" : "bg-emerald-600 hover:bg-emerald-500"}`}
              >
                {callAllIn ? "Call all in" : "Call"} {fmtChips(callAct.amount ?? 0)}
              </button>
            );
          })()
        ) : null}
        {aggro &&
          (() => {
            const chosen = clamp(raiseTo, min, max);
            const allIn = chosen >= allInTo;
            return (
              <button
                onClick={() => act(aggro.type as "bet" | "raise", chosen)}
                className={`${ACTION} ${allIn ? "bg-red-600 hover:bg-red-500" : "bg-sky-600 hover:bg-sky-500"}`}
              >
                {allIn ? "All in" : isOpen ? "Bet" : "Raise to"} {fmtChips(chosen)}
              </button>
            );
          })()}
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
