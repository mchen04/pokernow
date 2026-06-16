import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, PublicTableState } from "@common/protocol";
import { fmtChips, fmtBB } from "@common/money";

// Light haptic feedback on commit actions (no-op where unsupported / on desktop).
function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}

export function ActionBar({
  state,
  send,
  now,
}: {
  state: PublicTableState;
  send: (m: ClientMessage) => void;
  now: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const exactInputRef = useRef<HTMLInputElement>(null);
  const acts = state.legalActions;
  const canCheck = acts.some((a) => a.type === "check");
  const callAct = acts.find((a) => a.type === "call");
  const callAmt = callAct?.amount ?? 0;
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

  const afterCallPot = state.potForBet + callAmt;
  const bb = state.config.bigBlind;

  const secsLeft =
    state.actionDeadline !== null ? Math.max(0, Math.ceil((state.actionDeadline - now) / 1000)) : null;
  const totalSec = state.config.actionTimeSec || 30;
  const timeFrac = secsLeft !== null ? Math.max(0, Math.min(1, secsLeft / totalSec)) : 1;
  const urgent = secsLeft !== null && secsLeft <= Math.max(5, totalSec * 0.25);

  const presets = useMemo(() => {
    if (!aggro) return [] as { label: string; to: number }[];
    const preflop = state.street === "preflop";
    if (preflop) {
      if (isOpen) {
        return [
          { label: "2x", to: clamp(2 * bb, min, max) },
          { label: "2.5x", to: clamp(Math.round(2.5 * bb), min, max) },
          { label: "3x", to: clamp(3 * bb, min, max) },
        ];
      }
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const editing = !!el && (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable);
      const exactInput = el === exactInputRef.current;
      const insideActionBar = !!el && !!rootRef.current?.contains(el);

      if (e.key === "Enter" && aggro) {
        if (exactInput || (insideActionBar && !editing && !el.closest("button"))) {
          e.preventDefault();
          act(aggro.type as "bet" | "raise", clamp(raiseTo, min, max));
        }
        return;
      }
      if (editing) return;
      const k = e.key.toLowerCase();
      if (k === "f" && acts.some((a) => a.type === "fold")) act("fold");
      else if (k === "k" && canCheck) act("check");
      else if (k === "c") {
        if (canCheck) act("check");
        else if (callAct) act("call");
      } else if ((k === "b" || k === "r") && aggro) {
        setRaiseTo((v) => clamp(v || min, min, max));
        exactInputRef.current?.focus();
        exactInputRef.current?.select();
      } else if (k === "a" && aggro) setRaiseTo(max);
      else if (/^[1-9]$/.test(k) && aggro && max > min) {
        const opts = [min, ...presets.map((p) => p.to)];
        const idx = Number(k) - 1;
        if (idx < opts.length) setRaiseTo(clamp(opts[idx], min, max));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.actionSeq, raiseTo, min, max, canCheck, callAct, aggro, presets]);

  const potOddsPct = state.callPotOddsPct;

  const presetChip =
    "bet-preset flex-1 rounded-lg bg-slate-700 px-2 text-sm font-bold text-white hover:bg-slate-600 active:scale-[.97] transition";
  const ACTION =
    "min-h-[44px] flex-1 rounded-lg px-3 text-sm font-bold text-white active:scale-[.98] transition leading-tight";

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1">
      <div className="pointer-events-none absolute -top-2 left-0 right-0 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full ${urgent ? "bg-red-400" : "bg-amber-300"}`}
          style={{ width: `${timeFrac * 100}%`, transition: "width 0.25s linear" }}
        />
      </div>
      <div className="dock-turn-info flex items-center justify-between text-[13px] font-semibold">
        <span className={urgent ? "text-red-300" : "text-amber-200"}>● Your turn</span>
        {secsLeft !== null && (
          <span
            className={`tabular-nums ${urgent ? "animate-pulse text-red-300" : "text-white/70"}`}
          >
            {secsLeft}s left
          </span>
        )}
      </div>

      {aggro && max > min && (
        <>
          <div className="flex gap-1.5">
            <button className={presetChip} onClick={() => setRaiseTo(min)} title="Min (1)">
              Min<NumHint n={1} />
            </button>
            {presets.map((p, i) => (
              <button key={p.label} className={presetChip} onClick={() => setRaiseTo(p.to)} title={`${p.label} (${i + 2})`}>
                {p.label}
                <NumHint n={i + 2} />
              </button>
            ))}
            <button
              className={`bet-preset flex-1 rounded-lg px-2 text-sm font-bold text-white active:scale-[.97] transition ${
                maxIsAllIn ? "bg-red-700 hover:bg-red-600" : "bg-slate-700 hover:bg-slate-600"
              }`}
              onClick={() => setRaiseTo(max)}
            >
              {maxIsAllIn ? "All in" : "Max"}
            </button>
          </div>
          <div className="dock-exact-row flex items-center gap-2">
            <input
              type="range"
              min={min}
              max={max}
              step={Math.max(1, Math.round(bb / 2))}
              value={raiseTo}
              onChange={(e) => setRaiseTo(Number(e.target.value))}
              aria-label="Bet amount"
              className="dock-range dock-slider-control flex-1"
            />
            <input
              ref={exactInputRef}
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
                  setDraft("");
                  return;
                }
                if (!/^\d+$/.test(t)) return;
                setDraft(t);
                setRaiseTo(Number(t));
              }}
              aria-label="Exact bet amount"
              title={`Min ${fmtChips(min)} · Max ${fmtChips(max)}`}
              className="touch-target w-20 rounded-lg bg-slate-800 px-2 py-1 text-right text-sm font-bold text-white tabular-nums outline-none ring-1 ring-white/10 focus:ring-emerald-400"
            />
          </div>
          <div className="dock-range-help -mt-0.5 flex justify-between text-[11px] text-white/60">
            <span>Min {fmtChips(min)}</span>
            {draft !== null && Number(draft) > 0 && Number(draft) < min && (
              <span className="font-semibold text-amber-300">↑ raises to the {fmtChips(min)} minimum</span>
            )}
            <span>Max {fmtChips(max)}</span>
          </div>
        </>
      )}
      <div className="flex gap-2">
        {acts.some((a) => a.type === "fold") && (
          <button onClick={() => act("fold")} title="Fold (F)" className={`${ACTION} bg-rose-700 hover:bg-rose-600`}>
            Fold<Key k="F" />
          </button>
        )}
        {canCheck ? (
          <button onClick={() => act("check")} title="Check (K)" className={`${ACTION} bg-emerald-700 hover:bg-emerald-600`}>
            Check<Key k="K" />
          </button>
        ) : callAct ? (
          (() => {
            const callAllIn = me ? (callAct.amount ?? 0) >= me.stack : false;
            return (
              <button
                onClick={() => act("call")}
                title="Call (C)"
                className={`${ACTION} ${callAllIn ? "bg-red-700 hover:bg-red-600" : "bg-emerald-700 hover:bg-emerald-600"}`}
              >
                <span className="flex flex-col items-center justify-center">
                  <span>
                    {callAllIn ? "Call all in" : "Call"} {fmtChips(callAct.amount ?? 0)}
                    <Key k="C" />
                  </span>
                  {potOddsPct !== null && (
                    <span title="BB = big blinds · pot odds use only the final pot this call can win" className="text-[12px] font-semibold text-white/90">
                      {fmtBB(callAct.amount ?? 0, bb)} · {potOddsPct}% pot odds
                    </span>
                  )}
                </span>
              </button>
            );
          })()
        ) : null}
        {aggro &&
          (() => {
            const chosen = clamp(raiseTo, min, max);
            const allIn = chosen >= allInTo;
            const bbStr = fmtBB(chosen, bb);
            return (
              <button
                onClick={() => act(aggro.type as "bet" | "raise", chosen)}
                title={`${isOpen ? "Bet" : "Raise"} (B/R to focus · A all-in · Enter to confirm)`}
                className={`${ACTION} ${allIn ? "bg-red-700 hover:bg-red-600" : "bg-sky-700 hover:bg-sky-600"}`}
              >
                <span className="flex flex-col items-center justify-center">
                  <span>
                    {allIn ? "All in" : isOpen ? "Bet" : "Raise to"} {fmtChips(chosen)}
                    <Key k="↵" />
                  </span>
                  {bbStr && <span className="text-[12px] font-semibold text-white/90">{bbStr}</span>}
                </span>
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

function Key({ k }: { k: string }) {
  return (
    <kbd className="ml-1 hidden rounded border border-white/30 px-1 align-middle text-[9px] font-bold leading-none text-white/70 [@media(pointer:fine)]:inline-block">
      {k}
    </kbd>
  );
}

function NumHint({ n }: { n: number }) {
  return (
    <sup className="ml-0.5 hidden text-[8px] font-bold text-white/45 [@media(pointer:fine)]:inline">{n}</sup>
  );
}
