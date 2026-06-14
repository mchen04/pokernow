import { useState } from "react";
import type { ClientMessage } from "@common/protocol";
import { type GameVariant, type TableConfig, VARIANT_LABELS } from "@common/config";
import { X } from "./Icon";

function Num({
  label,
  value,
  onChange,
  min,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-white/70">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm font-semibold text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400"
        />
        {suffix && <span className="w-7 text-xs text-white/40">{suffix}</span>}
      </span>
    </label>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/5"
    >
      <span>
        <span className="block text-sm font-medium text-white/90">{label}</span>
        <span className="block text-xs text-white/45">{desc}</span>
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-emerald-500" : "bg-slate-600"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? "left-[22px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

export function SettingsModal({
  config,
  send,
  tourneyActive = false,
  onClose,
}: {
  config: TableConfig;
  send: (m: ClientMessage) => void;
  tourneyActive?: boolean;
  onClose: () => void;
}) {
  const [cfg, setCfg] = useState<TableConfig>(config);
  const [tab, setTab] = useState<"game" | "features">("game");
  const set = <K extends keyof TableConfig>(k: K, v: TableConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));

  const save = () => {
    send({ type: "updateConfig", config: cfg });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl bg-slate-900 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="text-lg font-bold text-white">Table settings</h2>
          <button onClick={onClose} aria-label="Close" className="text-white/50 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-white/10 px-4 pt-3">
          {(["game", "features"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-t-lg px-3 py-2 text-sm font-semibold capitalize ${
                tab === t ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
              }`}
            >
              {t === "features" ? "Game features" : "Game"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "game" ? (
            <div className="space-y-1">
              <label className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-sm text-white/70">Table name</span>
                <input
                  value={cfg.roomName}
                  onChange={(e) => set("roomName", e.target.value)}
                  className="w-48 rounded-md bg-slate-800 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400"
                />
              </label>
              <label className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-sm text-white/70">Game</span>
                <select
                  value={cfg.variant}
                  onChange={(e) => set("variant", e.target.value as GameVariant)}
                  className="w-56 rounded-md bg-slate-800 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400"
                >
                  {Object.entries(VARIANT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <Num label="Small blind" value={cfg.smallBlind} onChange={(n) => set("smallBlind", n)} min={1} />
              <Num label="Big blind" value={cfg.bigBlind} onChange={(n) => set("bigBlind", n)} min={2} />
              <Num label="Ante (each hand)" value={cfg.ante} onChange={(n) => set("ante", n)} min={0} />
              <Num label="Min buy-in" value={cfg.minBuyIn} onChange={(n) => set("minBuyIn", n)} min={1} />
              <Num label="Max buy-in" value={cfg.maxBuyIn} onChange={(n) => set("maxBuyIn", n)} min={1} />
              <Num label="Seats" value={cfg.maxSeats} onChange={(n) => set("maxSeats", n)} min={2} suffix="2-10" />
              <Num label="Action time" value={cfg.actionTimeSec} onChange={(n) => set("actionTimeSec", n)} min={10} suffix="sec" />
              <Num label="Time bank" value={cfg.timeBankSec} onChange={(n) => set("timeBankSec", n)} min={0} suffix="sec" />
              <div className="mt-2 border-t border-white/10 pt-2 text-xs font-semibold uppercase tracking-wider text-white/40">
                Tournament (Sit &amp; Go / MTT)
              </div>
              {tourneyActive && (
                <div className="my-1 flex items-center justify-between gap-3 rounded-lg bg-amber-500/10 px-3 py-2">
                  <span className="text-xs text-amber-200">A tournament is in progress.</span>
                  <button
                    onClick={() => {
                      send({ type: "exitTournament" });
                      onClose();
                    }}
                    className="shrink-0 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-500"
                  >
                    Exit tournament
                  </button>
                </div>
              )}
              <Num label="Starting stack" value={cfg.tourneyStartingStack} onChange={(n) => set("tourneyStartingStack", n)} min={100} />
              <Num label="Blind level length" value={cfg.tourneyLevelSec} onChange={(n) => set("tourneyLevelSec", n)} min={30} suffix="sec" />
              <Num label="Seats per table" value={cfg.tourneyTableSize} onChange={(n) => set("tourneyTableSize", n)} min={2} suffix="2-10" />
            </div>
          ) : (
            <div className="space-y-1">
              <p className="mb-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                Every feature here is free — flip on anything, any game, no unlock.
              </p>
              <Toggle label="Run It Twice" desc="Offer running the board twice on all-ins." checked={cfg.runItTwice} onChange={(b) => set("runItTwice", b)} />
              <Toggle label="Rabbit Hunt" desc="Let players reveal the undealt board after a hand." checked={cfg.rabbitHunt} onChange={(b) => set("rabbitHunt", b)} />
              <Toggle label="Live Straddle" desc="Allow an optional UTG straddle." checked={cfg.straddle} onChange={(b) => set("straddle", b)} />
              <Toggle label="Double Board" desc="Run two boards on bomb pots / all-ins." checked={cfg.doubleBoard} onChange={(b) => set("doubleBoard", b)} />
              <Toggle label="NIT Game" desc="Players must announce before acting (no fast actions)." checked={cfg.nitMode} onChange={(b) => set("nitMode", b)} />
              <Toggle label="Spectators see cards" desc="Let unseated railbirds watch with all hands face-up." checked={cfg.spectatorsSeeCards} onChange={(b) => set("spectatorsSeeCards", b)} />
              <Num label="Bomb pot every N hands" value={cfg.bombPotEvery} onChange={(n) => set("bombPotEvery", n)} min={0} suffix="0=off" />
              <Num label="Bomb pot ante" value={cfg.bombPotAnte} onChange={(n) => set("bombPotAnte", n)} min={0} />
              <Num label="7-2 bounty" value={cfg.sevenDeuce} onChange={(n) => set("sevenDeuce", n)} min={0} suffix="0=off" />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button onClick={onClose} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600">
            Cancel
          </button>
          <button onClick={save} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-500">
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}
