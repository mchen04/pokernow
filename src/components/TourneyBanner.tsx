import { memo } from "react";
import type { TourneyState } from "@common/protocol";
import { fmtChips, fmtMoney } from "@common/money";
import { Trophy, Crown, Medal } from "./Icon";

// Finishing-place glyph — gold crown for the win, silver/bronze medals for the
// podium, plain rank otherwise (re-encodes the gold/silver/bronze semantics).
function PlaceMark({ place }: { place: number }) {
  if (place === 1) return <Crown size={16} className="text-amber-300" aria-label="1st place" />;
  if (place === 2) return <Medal size={16} className="text-slate-300" aria-label="2nd place" />;
  if (place === 3) return <Medal size={16} className="text-amber-600" aria-label="3rd place" />;
  return <span className="w-4 text-center text-xs text-white/50">{place}.</span>;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  return ["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th";
}

function TourneyBannerImpl({ tourney, now }: { tourney: TourneyState; now: number }) {
  if (tourney.finished) return null;
  const left = tourney.levelEndsAt ? tourney.levelEndsAt - now : null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-2">
      <div className="no-scrollbar pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto whitespace-nowrap rounded-full bg-black/70 px-3 py-1.5 text-[11px] font-semibold text-white shadow ring-1 ring-amber-300/30 [&>span]:shrink-0 sm:gap-3 sm:px-4 sm:text-xs">
        <span className="flex items-center gap-1 text-amber-300">
          <Trophy size={13} /> {tourney.multiTable ? "Tournament" : "Sit & Go"}
        </span>
        <span>Level {tourney.level}</span>
        <span className="text-white/70">
          {fmtChips(tourney.smallBlind)}/{fmtChips(tourney.bigBlind)}
          {tourney.ante ? ` · ante ${fmtChips(tourney.ante)}` : ""}
        </span>
        {left !== null && <span className="text-amber-200">next {mmss(left)}</span>}
        <span className="text-white/70">{tourney.playersLeft} left</span>
        {tourney.multiTable && (
          <span className="text-white/70">
            {tourney.tablesLeft} {tourney.tablesLeft === 1 ? "table" : "tables"} · you@T{tourney.yourTable}
          </span>
        )}
        {tourney.multiTable && tourney.yourPlace != null && (
          <span className="text-rose-300">out · {tourney.yourPlace}{ordinalSuffix(tourney.yourPlace)}</span>
        )}
        <span className="text-emerald-300">pool {fmtChips(tourney.prizePool)}</span>
      </div>
    </div>
  );
}

// `now` ticks 4×/sec but the banner only shows whole seconds — re-render when the
// tournament state changes or the displayed countdown second rolls over.
export const TourneyBanner = memo(TourneyBannerImpl, (a, b) => {
  if (a.tourney !== b.tourney) return false;
  const secs = (p: { tourney: TourneyState; now: number }) =>
    p.tourney.levelEndsAt ? Math.floor((p.tourney.levelEndsAt - p.now) / 1000) : 0;
  return secs(a) === secs(b);
});

export function TourneyResults({ tourney, onClose }: { tourney: TourneyState; onClose: () => void }) {
  if (!tourney.finished) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-slate-900 p-6 text-center ring-1 ring-amber-300/30"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex justify-center text-amber-300">
          <Trophy size={40} />
        </div>
        <h2 className="mb-4 font-display text-2xl font-bold text-white">
          {tourney.multiTable ? "Tournament" : "Sit & Go"} complete
        </h2>
        <div className="space-y-1 text-left">
          {tourney.standings.map((s) => (
            <div
              key={s.place}
              className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                s.place === 1 ? "bg-amber-400/15" : "bg-white/5"
              }`}
            >
              <span className="flex items-center gap-1.5 font-semibold text-white">
                <PlaceMark place={s.place} /> {s.name}
              </span>
              {s.payout > 0 && <span className="font-bold text-emerald-300">{fmtMoney(s.payout)}</span>}
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-500"
        >
          Close
        </button>
      </div>
    </div>
  );
}
