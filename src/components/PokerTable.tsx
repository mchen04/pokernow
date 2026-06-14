import type { PublicTableState } from "@common/protocol";
import { fmtChips } from "@common/money";
import { PlayingCard } from "./PlayingCard";
import { Seat } from "./Seat";
import { seatPositions } from "../lib/layout";
import { useFitSize } from "../lib/useFitSize";

// Half-width (design px) of the widest seat block when a camera tile is shown:
// [video ~104 | gap | right column ~128] ≈ 236px wide, where the right column is
// the cards stacked above the 128px pod. A side-seat block is centered on its
// position, so we clamp that center inward by this much (+margin) so the block
// never clips the felt's overflow-hidden edge.
const VIDEO_HALF_BLOCK = 122;

function BetChips({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  return (
    <div className="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 shadow ring-1 ring-white/10">
      <span className="h-3 w-3 rounded-full bg-amber-400 ring-1 ring-amber-200" />
      <span className="text-[12px] font-bold text-white tabular-nums">{fmtChips(amount)}</span>
    </div>
  );
}

export function PokerTable({
  state,
  now,
  onSit,
  localStream,
  remote,
}: {
  state: PublicTableState;
  now: number;
  onSit: (seatIndex: number) => void;
  localStream?: MediaStream | null;
  remote?: Record<string, MediaStream>;
}) {
  const positions = seatPositions(state.config.maxSeats, state.yourSeat);
  const betsOnTable = state.seats.reduce((s, x) => s + x.betThisStreet, 0);
  const centerPot = state.totalPot - betsOnTable;
  const { ref, fit } = useFitSize();

  // Clamp a video seat's center inward so the wider [video | pod | cards] block
  // stays within the felt (which clips at its overflow-hidden edge).
  const clampVideoX = (xPct: number): number => {
    const w = fit.base.w;
    const px = (xPct / 100) * w;
    const c = Math.max(VIDEO_HALF_BLOCK + 6, Math.min(w - VIDEO_HALF_BLOCK - 6, px));
    return (c / w) * 100;
  };

  return (
    <div ref={ref} className="flex h-full w-full items-center justify-center overflow-hidden">
      <div
        className="relative shrink-0"
        style={{
          width: fit.base.w,
          height: fit.base.h,
          transform: fit.scale ? `translateY(${fit.offsetY}px) scale(${fit.scale})` : undefined,
          transformOrigin: "center center",
          visibility: fit.scale ? "visible" : "hidden",
          // published for the seat label legibility floor (M3)
          ["--table-scale" as string]: fit.scale || 1,
        }}
      >
      {/* felt — matched to PokerNow's brighter, flatter green (#3FA76C) */}
      <div
        className="absolute inset-[4%] rounded-[50%] shadow-[inset_0_0_70px_rgba(0,0,0,0.4)] ring-[6px] ring-[#15110f] border border-black/50"
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, #46b277 0%, #3fa76c 55%, #2f8a58 100%)",
        }}
      >
        <div className="absolute inset-[7%] rounded-[50%] border border-white/[0.08]" />
      </div>

      {/* center: pot + board */}
      <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
        {centerPot > 0 && (
          <div className="rounded-full bg-black/50 px-3 py-1 text-sm font-bold text-white shadow ring-1 ring-white/10">
            Pot {fmtChips(centerPot)}
          </div>
        )}
        <div className="flex min-h-[82px] flex-col items-center gap-1.5">
          {state.boards.map((bd, bi) => (
            <div key={bi} className="flex items-center gap-1.5">
              {bd.map((card, i) => (
                <PlayingCard key={i} card={card} size={state.boards.length > 1 ? "md" : "lg"} />
              ))}
              {bi === state.boards.length - 1 &&
                state.lastHandRabbit?.map((card, i) => (
                  <PlayingCard key={`r${i}`} card={card} size={state.boards.length > 1 ? "md" : "lg"} dim />
                ))}
            </div>
          ))}
        </div>
        {state.totalPot > 0 && (
          <div className="text-xs text-white/60">Total pot {fmtChips(state.totalPot)}</div>
        )}
      </div>

      {/* seats + bets */}
      {positions.map((p) => {
        const seat = state.seats[p.seat];
        const isHero = state.yourSeat === p.seat;
        const stream = isHero ? localStream ?? null : seat.playerId ? remote?.[seat.playerId] ?? null : null;
        const hasVideo = !!stream && seat.camOn && stream.getVideoTracks().length > 0;
        const x = hasVideo ? clampVideoX(p.x) : p.x;
        return (
          <div key={p.seat}>
            <div
              className="absolute"
              style={{ left: `${x}%`, top: `${p.y}%`, transform: "translate(-50%, -50%)" }}
            >
              <Seat
                seat={seat}
                isHero={isHero}
                now={now}
                actionDeadline={state.actionDeadline}
                actionTimeSec={state.config.actionTimeSec}
                onSit={onSit}
                stream={stream}
              />
            </div>
            {seat.betThisStreet > 0 && (
              <div
                className="absolute"
                style={{ left: `${p.betX}%`, top: `${p.betY}%`, transform: "translate(-50%, -50%)" }}
              >
                <BetChips amount={seat.betThisStreet} />
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
