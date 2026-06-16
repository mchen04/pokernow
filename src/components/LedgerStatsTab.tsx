import { useState, type ReactNode } from "react";
import type { PlayerStats } from "@common/protocol";
import { fmtMoney, fmtNet } from "@common/money";

type StatView = "preflop" | "postflop" | "results";
type StatColumn = {
  key: string;
  label: string;
  title: string;
  cell: (s: PlayerStats) => ReactNode;
  cls?: (s: PlayerStats) => string;
};

const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const pctCell = (v: number | null | undefined) => (num(v) ? `${v}%` : "—");
const afCell = (v: number | null | undefined) => (num(v) ? v.toFixed(1) : "—");

const COLUMNS: Record<StatView, StatColumn[]> = {
  preflop: [
    { key: "vpip", label: "VPIP", title: "Voluntarily put $ in pot", cell: (s) => pctCell(s.vpip) },
    { key: "pfr", label: "PFR", title: "Pre-flop raise", cell: (s) => pctCell(s.pfr) },
    { key: "3b", label: "3-Bet", title: "Re-raised pre-flop when given the chance", cell: (s) => pctCell(s.threeBet) },
    { key: "f3b", label: "Fold→3B", title: "Folded the open when facing a 3-bet", cell: (s) => pctCell(s.foldTo3bet) },
  ],
  postflop: [
    { key: "af", label: "AF", title: "Aggression factor (bets+raises)/calls", cell: (s) => afCell(s.af) },
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
      cls: (s) => (num(s.net) && s.net > 0 ? "text-emerald-400" : num(s.net) && s.net < 0 ? "text-rose-400" : "text-white/60"),
    },
    {
      key: "bb100",
      label: "BB/100",
      title: "Big blinds won per 100 hands (cash only)",
      cell: (s) => (s.bb100 == null ? "—" : (s.bb100 > 0 ? "+" : "") + s.bb100),
      cls: (s) => (s.bb100 == null ? "text-white/40" : s.bb100 > 0 ? "text-emerald-400" : s.bb100 < 0 ? "text-rose-400" : "text-white/60"),
    },
    { key: "won", label: "Won", title: "Hands won (win rate)", cell: (s) => `${num(s.handsWon) ? s.handsWon : 0} (${num(s.winRate) ? s.winRate : 0}%)` },
    { key: "big", label: "Big pot", title: "Biggest pot won", cell: (s) => fmtMoney(s.biggestPotWon) },
    {
      key: "luck",
      label: "Luck",
      title: "All-in luck: actual − expected (EV) across all-in showdowns",
      cell: (s) => (s.allInCount === 0 ? "—" : fmtNet(s.allInLuck)),
      cls: (s) => (s.allInCount === 0 ? "text-white/40" : num(s.allInLuck) && s.allInLuck > 0 ? "text-emerald-400" : num(s.allInLuck) && s.allInLuck < 0 ? "text-rose-400" : "text-white/60"),
    },
  ],
};

const GLOSSARY: [string, string][] = [
  ["VPIP", "How often a player voluntarily puts money in preflop."],
  ["PFR", "How often they raise preflop."],
  ["3-Bet", "How often they re-raise an open preflop."],
  ["Fold→3B", "How often the opener folds facing a 3-bet."],
  ["AF", "Aggression factor: (bets + raises) ÷ calls."],
  ["Agg%", "Share of postflop actions that are bets/raises."],
  ["WTSD", "Went to showdown after seeing the flop."],
  ["W$SD", "Won money when reaching showdown."],
  ["C-Bet", "Continuation-bet the flop as the preflop raiser."],
  ["Fold→CB", "Folded facing a flop continuation bet."],
  ["BB/100", "Big blinds won per 100 hands (cash games)."],
  ["Luck", "All-in result minus its expected value (EV)."],
];

export function StatsTab({ stats }: { stats: PlayerStats[] }) {
  const [view, setView] = useState<StatView>("preflop");
  const [showGlossary, setShowGlossary] = useState(false);

  if (stats.length === 0) {
    return <p className="py-6 text-center text-sm text-white/55">No hands played yet.</p>;
  }

  const cols = COLUMNS[view];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg bg-black/30 p-0.5 text-xs font-semibold">
          {(["preflop", "postflop", "results"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`min-h-[36px] rounded-md px-3 py-1.5 capitalize transition ${
                view === v ? "bg-emerald-700 text-white" : "text-white/55 hover:text-white"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowGlossary((g) => !g)}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/30 hover:bg-white/5"
        >
          <span className="text-[13px]">ⓘ</span> {showGlossary ? "Hide key" : "What do these mean?"}
        </button>
      </div>

      <div className="space-y-2 sm:hidden">
        {stats.map((s) => (
          <div key={s.playerId} className="rounded-lg bg-black/30 p-2.5">
            <div className="mb-1.5 flex items-center justify-between border-b border-white/10 pb-1">
              <span className="font-semibold text-white/90">{s.name}</span>
              <span className="text-xs text-white/55">{s.handsPlayed} hands</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {cols.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-2">
                  <span className="text-white/55" title={c.title}>
                    {c.label}
                  </span>
                  <span className={`tabular-nums ${c.cls ? c.cls(s) : "text-white/85"}`}>{c.cell(s)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-white/65">
              <th className="py-1.5 pr-2 font-medium">Player</th>
              <th className="py-1.5 px-1 text-right font-medium" title="Hands dealt in">
                Hands
              </th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className="cursor-help py-1.5 px-1 text-right font-medium underline decoration-dotted decoration-white/30 underline-offset-2"
                  title={c.title}
                >
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
      <p className="mt-3 text-[11px] text-white/55">
        Full HUD analytics for everyone — no PLUS subscription, no gate. Hover any column header, or
        tap "What do these mean?" above, for a plain-English definition.
      </p>
      {showGlossary && (
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg bg-black/30 p-3 text-[12px] sm:grid-cols-2">
          {GLOSSARY.map(([term, def]) => (
            <div key={term} className="flex gap-1.5">
              <dt className="shrink-0 font-bold text-white/80">{term}</dt>
              <dd className="text-white/55">{def}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
