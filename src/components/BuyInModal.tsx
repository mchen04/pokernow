import { useState } from "react";
import type { TableConfig } from "@common/config";
import { MAX_BUYIN } from "@common/config";
import { fmtMoney } from "@common/money";

export function BuyInModal({
  config,
  seatIndex,
  rebuy = false,
  onConfirm,
  onCancel,
}: {
  config: TableConfig;
  seatIndex: number;
  rebuy?: boolean;
  onConfirm: (buyIn: number) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(config.maxBuyIn);
  const bb = config.bigBlind;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-2xl bg-slate-900 p-5 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-bold text-white">
          {rebuy ? "Re-buy chips" : `Take seat ${seatIndex + 1}`}
        </h2>
        <p className="mb-4 text-sm text-white/70">
          Minimum {fmtMoney(config.minBuyIn)} ({Math.round(config.minBuyIn / bb)} big blinds) — no
          maximum, chips are all tracked.
        </p>
        <div className="mb-2 text-center text-3xl font-bold text-emerald-300 tabular-nums">
          {fmtMoney(amount)}
          <span className="ml-1 align-middle text-sm font-medium text-white/55">
            {Math.round(amount / bb)} big blinds
          </span>
        </div>
        <input
          type="range"
          min={config.minBuyIn}
          // The 2×/5× presets buy in above the suggested max (buy-ins are
          // uncapped), so let the slider ceiling follow the chosen amount —
          // otherwise the thumb pins at max while the number shows more (desync).
          max={Math.max(config.maxBuyIn, amount)}
          step={Math.max(1, Math.round(bb / 2))}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          aria-label="Buy-in amount"
          className="dock-range mb-3 w-full"
        />
        <input
          type="number"
          value={amount}
          min={config.minBuyIn}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="mb-2 w-full rounded-lg bg-slate-800 px-3 py-2 text-right text-white tabular-nums outline-none ring-1 ring-white/10 focus:ring-emerald-400"
        />
        <div className="mb-4 flex flex-wrap gap-1">
          {[
            { label: "Min", to: config.minBuyIn },
            { label: "Default", to: config.maxBuyIn },
            { label: "2×", to: config.maxBuyIn * 2 },
            { label: "5×", to: config.maxBuyIn * 5 },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => setAmount(p.to)}
              className="touch-target rounded-md bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-600"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg bg-slate-700 px-4 py-2 font-semibold text-white hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const clamped = Math.max(config.minBuyIn, Math.min(MAX_BUYIN, Math.round(amount || 0)));
              onConfirm(clamped);
            }}
            className="flex-1 rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white hover:bg-emerald-600"
          >
            {rebuy ? "Add chips" : "Sit down"}
          </button>
        </div>
      </div>
    </div>
  );
}
