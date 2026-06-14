import { useEffect, useMemo, useState } from "react";
import type { ClientMessage, HandSummary, LedgerEntry, LogEntry, PlayerStats } from "@common/protocol";
import { fmtMoney, fmtNet } from "@common/money";
import { computeEquity, mulberry32 } from "@common/equity";
import { PlayingCard } from "./PlayingCard";
import { downloadLedgerCsv, downloadLogText, downloadSessionJson } from "../lib/download";
import { X, ArrowLeft, Download } from "./Icon";

function boardLenAtStep(actions: string[], step: number): number {
  let n = 0;
  for (let i = 0; i < step; i++) {
    const a = actions[i];
    if (/^Flop/.test(a)) n = Math.max(n, 3);
    else if (/^Turn/.test(a)) n = Math.max(n, 4);
    else if (/^(River|Board)/.test(a)) n = 5;
  }
  return n;
}

function ReplayView({ hand, onBack }: { hand: HandSummary; onBack: () => void }) {
  const [step, setStep] = useState(1);
  const [playing, setPlaying] = useState(false);
  const total = hand.actions.length;

  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => Math.min(total, s + 1)), 900);
    return () => clearTimeout(t);
  }, [playing, step, total]);

  const boardLen = boardLenAtStep(hand.actions, step);
  const board = hand.boards[0] ?? [];
  const revealed = hand.players.filter((p) => p.holeCards && p.holeCards.length > 0);

  // Solver-style win equity per revealed player at the CURRENT street (the board
  // as it stands at this replay step). Recomputed only when the visible board
  // length changes; seeded from the hand number so the % is stable per street.
  const equity = useMemo<Map<number, number> | null>(() => {
    if (revealed.length < 2) return null;
    const omaha = revealed.some((p) => (p.holeCards?.length ?? 0) >= 4);
    const players = revealed.map((p) => ({ id: p.seat, holeCards: p.holeCards! }));
    const res = computeEquity(players, [board.slice(0, boardLen)], [], {
      omaha,
      holeCount: 2,
      rng: mulberry32(hand.handNumber * 101 + boardLen),
      mcSamples: 4000,
    });
    return res.equity;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand.handNumber, boardLen, revealed.length]);

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 self-start text-sm text-white/60 hover:text-white"
      >
        <ArrowLeft size={15} /> Back to hands
      </button>
      <div className="text-sm font-bold text-white">Hand #{hand.handNumber}</div>

      {/* board */}
      <div className="flex justify-center gap-1.5 rounded-xl py-3" style={{ background: "#14463699" }}>
        {board.slice(0, boardLen).map((c, i) => (
          <PlayingCard key={i} card={c} size="md" />
        ))}
        {Array.from({ length: Math.max(0, 5 - boardLen) }).map((_, i) => (
          <div key={`p${i}`} className="h-16 w-11 rounded-md border border-white/10" />
        ))}
      </div>

      {/* revealed hands + live equity (win% at this street) */}
      <div className="flex flex-wrap justify-center gap-3">
        {revealed.map((p) => {
          const eq = equity?.get(p.seat);
          return (
            <div key={p.seat} className="flex flex-col items-center gap-1">
              <div className="flex gap-0.5">
                {p.holeCards!.map((c, i) => (
                  <PlayingCard key={i} card={c} size="sm" />
                ))}
              </div>
              <span className="text-[11px] text-white/70">
                {p.name} {fmtNet(p.net)}
              </span>
              {eq != null && (
                <span className="flex items-center gap-1" title="Win equity at this street">
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
                    <span
                      className="block h-full rounded-full bg-emerald-400"
                      style={{ width: `${Math.round(eq * 100)}%` }}
                    />
                  </span>
                  <span className="text-[11px] font-bold tabular-nums text-emerald-300">
                    {Math.round(eq * 100)}%
                  </span>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {equity && (
        <p className="text-center text-[10px] text-white/35">
          Win % computed live from the revealed hands — solver-grade equity at each street.
        </p>
      )}

      {/* action log up to step */}
      <div className="max-h-40 overflow-y-auto rounded-lg bg-black/30 p-2 text-[12px] text-white/75">
        {hand.actions.slice(0, step).map((a, i) => (
          <div key={i} className={i === step - 1 ? "font-semibold text-emerald-300" : ""}>
            {a}
          </div>
        ))}
      </div>

      {/* controls */}
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-600"
        >
          ‹ Prev
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-emerald-500"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          onClick={() => setStep((s) => Math.min(total, s + 1))}
          className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-600"
        >
          Next ›
        </button>
        <span className="ml-2 text-xs text-white/40">
          {step}/{total}
        </span>
      </div>
    </div>
  );
}

// ── Stats tab ────────────────────────────────────────────────────────────────
type StatView = "preflop" | "postflop" | "results";

const pctCell = (v: number) => `${v}%`;

function StatsTab({ stats }: { stats: PlayerStats[] }) {
  const [view, setView] = useState<StatView>("preflop");

  if (stats.length === 0) {
    return <p className="py-6 text-center text-sm text-white/40">No hands played yet.</p>;
  }

  // Column definitions per view. Each: header, tooltip, and a cell renderer.
  const COLUMNS: Record<StatView, { key: string; label: string; title: string; cell: (s: PlayerStats) => React.ReactNode; cls?: (s: PlayerStats) => string }[]> = {
    preflop: [
      { key: "vpip", label: "VPIP", title: "Voluntarily put $ in pot", cell: (s) => pctCell(s.vpip) },
      { key: "pfr", label: "PFR", title: "Pre-flop raise", cell: (s) => pctCell(s.pfr) },
      { key: "3b", label: "3-Bet", title: "Re-raised pre-flop when given the chance", cell: (s) => pctCell(s.threeBet) },
      { key: "f3b", label: "Fold→3B", title: "Folded the open when facing a 3-bet", cell: (s) => pctCell(s.foldTo3bet) },
    ],
    postflop: [
      { key: "af", label: "AF", title: "Aggression factor (bets+raises)/calls", cell: (s) => s.af.toFixed(1) },
      { key: "agg", label: "Agg%", title: "Aggression frequency", cell: (s) => pctCell(s.aggPct) },
      { key: "wtsd", label: "WTSD", title: "Went to showdown (given saw flop)", cell: (s) => pctCell(s.wtsd) },
      { key: "wsd", label: "W$SD", title: "Won money at showdown", cell: (s) => pctCell(s.wsd) },
      { key: "cb", label: "C-Bet", title: "Flop continuation bet as PF aggressor", cell: (s) => pctCell(s.cbet) },
      { key: "fcb", label: "Fold→CB", title: "Folded facing a flop c-bet", cell: (s) => pctCell(s.foldToCbet) },
    ],
    results: [
      {
        key: "net",
        label: "Net",
        title: "Session net (from the ledger)",
        cell: (s) => fmtNet(s.net),
        cls: (s) => (s.net > 0 ? "text-emerald-400" : s.net < 0 ? "text-rose-400" : "text-white/60"),
      },
      {
        key: "bb100",
        label: "BB/100",
        title: "Big blinds won per 100 hands (cash only)",
        cell: (s) => (s.bb100 == null ? "—" : (s.bb100 > 0 ? "+" : "") + s.bb100),
        cls: (s) => (s.bb100 == null ? "text-white/40" : s.bb100 > 0 ? "text-emerald-400" : s.bb100 < 0 ? "text-rose-400" : "text-white/60"),
      },
      { key: "won", label: "Won", title: "Hands won (win rate)", cell: (s) => `${s.handsWon} (${s.winRate}%)` },
      { key: "big", label: "Big pot", title: "Biggest pot won", cell: (s) => fmtMoney(s.biggestPotWon) },
      {
        key: "luck",
        label: "Luck",
        title: "All-in luck: actual − expected (EV) across all-in showdowns",
        cell: (s) => (s.allInCount === 0 ? "—" : fmtNet(s.allInLuck)),
        cls: (s) => (s.allInCount === 0 ? "text-white/40" : s.allInLuck > 0 ? "text-emerald-400" : s.allInLuck < 0 ? "text-rose-400" : "text-white/60"),
      },
    ],
  };

  const cols = COLUMNS[view];

  return (
    <div>
      <div className="mb-3 inline-flex rounded-lg bg-black/30 p-0.5 text-xs font-semibold">
        {(["preflop", "postflop", "results"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-md px-3 py-1.5 capitalize transition ${
              view === v ? "bg-emerald-600 text-white" : "text-white/55 hover:text-white"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-white/50">
              <th className="py-1.5 pr-2 font-medium">Player</th>
              <th className="py-1.5 px-1 text-right font-medium" title="Hands dealt in">
                Hands
              </th>
              {cols.map((c) => (
                <th key={c.key} className="py-1.5 px-1 text-right font-medium" title={c.title}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.playerId} className="border-b border-white/5">
                <td className="py-1.5 pr-2 text-white/90">{s.name}</td>
                <td className="py-1.5 px-1 text-right tabular-nums text-white/60">{s.handsPlayed}</td>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={`py-1.5 px-1 text-right tabular-nums ${c.cls ? c.cls(s) : "text-white/80"}`}
                  >
                    {c.cell(s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-white/35">
        Full HUD analytics for everyone — VPIP/PFR, 3-bet, aggression, showdown, c-bet, BB/100 and
        all-in luck. No PLUS subscription, no gate.
      </p>
    </div>
  );
}

export function LedgerModal({
  roomId,
  ledger,
  stats,
  histories,
  log,
  send,
  onClose,
}: {
  roomId: string;
  ledger: LedgerEntry[];
  stats: PlayerStats[];
  histories: HandSummary[];
  log: LogEntry[];
  send: (m: ClientMessage) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"ledger" | "stats" | "hands">("ledger");
  const [replay, setReplay] = useState<HandSummary | null>(null);

  useEffect(() => {
    send({ type: "requestHistory" });
  }, [send]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      {/* Fixed-size frame — never resizes between tabs or as rows/hands are added.
          The header + tab row are fixed-height; the body absorbs all change by
          scrolling internally. */}
      <div
        className="flex h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="text-lg font-bold text-white">Ledger &amp; history</h2>
          <button onClick={onClose} aria-label="Close" className="text-white/50 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {!replay && (
          <div className="flex shrink-0 gap-1 border-b border-white/10 px-4 pt-3">
            {(["ledger", "stats", "hands"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-t-lg px-3 py-2 text-sm font-semibold capitalize ${
                  tab === t ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
                }`}
              >
                {t === "hands" ? `Hands (${histories.length})` : t === "stats" ? "Stats" : "Ledger"}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {replay ? (
            <ReplayView hand={replay} onBack={() => setReplay(null)} />
          ) : tab === "ledger" ? (
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-white/50">
                    <th className="py-1.5 font-medium">Player</th>
                    <th className="py-1.5 text-right font-medium">Buy-in</th>
                    <th className="py-1.5 text-right font-medium">Stack</th>
                    <th className="py-1.5 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((l) => (
                    <tr key={l.playerId} className="border-b border-white/5">
                      <td className="py-1.5 text-white/90">{l.name}</td>
                      <td className="py-1.5 text-right tabular-nums text-white/70">{fmtMoney(l.buyIn)}</td>
                      <td className="py-1.5 text-right tabular-nums text-white/70">{fmtMoney(l.stack)}</td>
                      <td
                        className={`py-1.5 text-right font-semibold tabular-nums ${
                          l.net > 0 ? "text-emerald-400" : l.net < 0 ? "text-rose-400" : "text-white/60"
                        }`}
                      >
                        {fmtNet(l.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ledger.length === 0 && <p className="py-6 text-center text-sm text-white/40">No buy-ins yet.</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => downloadLedgerCsv(roomId, ledger)} className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600">
                  <Download size={13} /> Ledger CSV
                </button>
                <button onClick={() => downloadLogText(roomId, histories, log)} className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600">
                  <Download size={13} /> Full log (text)
                </button>
                <button onClick={() => downloadSessionJson(roomId, ledger, histories)} className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600">
                  <Download size={13} /> Session JSON
                </button>
              </div>
              <p className="mt-2 text-[11px] text-white/35">
                Everything is uncapped and free to download — the full unedited log, every hand.
              </p>
            </div>
          ) : tab === "stats" ? (
            <StatsTab stats={stats} />
          ) : (
            <div className="space-y-1">
              {[...histories].reverse().map((h) => {
                const winner = h.players.filter((p) => p.won > 0).sort((a, b) => b.won - a.won)[0];
                return (
                  <button
                    key={h.handNumber}
                    onClick={() => setReplay(h)}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5"
                  >
                    <span className="font-medium text-white/90">Hand #{h.handNumber}</span>
                    <span className="text-white/50">
                      {winner ? `${winner.name} won ${fmtMoney(winner.won)}` : "—"} · replay ▸
                    </span>
                  </button>
                );
              })}
              {histories.length === 0 && (
                <p className="py-6 text-center text-sm text-white/40">No completed hands yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
