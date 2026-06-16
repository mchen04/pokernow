import type { PublicTableState } from "@common/protocol";
import { fmtChips } from "@common/money";
import { PlayingCard } from "./PlayingCard";
import { Seat } from "./Seat";
import { BetChips, FloatingReactions, ShowdownResultBanner } from "./PokerTableWidgets";
import { seatPositions } from "../lib/layout";
import { useFitSize } from "../lib/useFitSize";
import { usePrefs } from "../lib/prefs";

// Half-width (design px) of the widest seat block when a camera tile is shown:
// [video ~104 | gap | right column ~128] ≈ 236px wide, where the right column is
// the cards stacked above the 128px pod. A side-seat block is centered on its
// position, so we clamp that center inward by this much (+margin) so the block
// never clips the felt's overflow-hidden edge.
const VIDEO_HALF_BLOCK = 122;
// Half the plain (no-video) seat block: the pod is ~128px wide and the cards
// above it can be a touch wider, so ~72px keeps the whole block off the felt's
// overflow-hidden edge. On the narrow PORTRAIT box this is what stops side seats
// from clipping off the screen edge on a phone.
const POD_HALF_BLOCK = 72;

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
  const { ref, fit } = useFitSize();
  const { hud } = usePrefs();

  // Optional pro HUD: a compact VPIP/PFR read beside each occupied seat, computed
  // from the same per-player stats that power the Stats modal. Passed as a string
  // so the memoized Seat only re-renders when the value actually changes.
  const statByPid = new Map(state.stats.map((s) => [s.playerId, s]));
  const hudFor = (playerId: string | null): string | null => {
    if (!hud || !playerId) return null;
    const s = statByPid.get(playerId);
    return s && s.handsPlayed > 0 ? `${s.vpip}/${s.pfr}/${s.threeBet}` : null;
  };

  // Clamp a seat's center inward so its block (pod + cards, wider when a camera
  // tile is shown) stays within the felt, which clips at its overflow-hidden
  // edge. Applied to every seat — without it the side seats clip off the screen
  // edge on the narrow portrait (phone) box.
  const clampX = (xPct: number, half: number): number => {
    const w = fit.base.w;
    const px = (xPct / 100) * w;
    const c = Math.max(half + 6, Math.min(w - half - 6, px));
    return (c / w) * 100;
  };

  return (
    <div ref={ref} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <FloatingReactions chat={state.chat} />
      <div
        className="relative shrink-0"
        style={{
          width: fit.base.w,
          height: fit.base.h,
          transform: fit.scale ? `translateY(${fit.offsetY}px) scale(${fit.scale})` : undefined,
          transformOrigin: "center center",
          visibility: fit.scale ? "visible" : "hidden",
          // The dock sizes to its content (tall on your turn, compact otherwise),
          // so the felt re-fits as the turn enters/leaves. Glide the rescale
          // instead of snapping, so reclaiming the space reads as smooth.
          transition: "transform 0.18s ease-out",
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

      <ShowdownResultBanner state={state} />

      {/* center: pot + board. One clear "Pot" figure = the TOTAL at stake (chips
          already collected in the middle PLUS the current street's bets shown in
          front of each seat), so a beginner never sees two competing numbers. */}
      <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
        {state.totalPot > 0 && (
          <div className="rounded-full bg-black/65 px-4 py-1 text-base font-extrabold text-white shadow ring-1 ring-white/15">
            Pot {fmtChips(state.totalPot)}
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
      </div>

      {/* seats + bets */}
      {positions.map((p) => {
        const seat = state.seats[p.seat];
        const isHero = state.yourSeat === p.seat;
        const stream = isHero ? localStream ?? null : seat.playerId ? remote?.[seat.playerId] ?? null : null;
        const hasVideo = !!stream && seat.camOn && stream.getVideoTracks().length > 0;
        const x = clampX(p.x, hasVideo ? VIDEO_HALF_BLOCK : POD_HALF_BLOCK);
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
                hudText={hudFor(seat.playerId)}
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
