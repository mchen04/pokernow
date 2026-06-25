import type { PublicTableState } from "@common/protocol";
import { fmtChips } from "@common/money";
import { PlayingCard } from "./PlayingCard";
import { Seat } from "./Seat";
import { BetChips, FloatingReactions, PotChipStack, ShowdownResultBanner } from "./PokerTableWidgets";
import { seatPositions } from "../lib/layout";
import { useFitSize } from "../lib/useFitSize";

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
// Design-px distance from the hero seat's center up to where its bet chip sits —
// above the lg card stack so the chip never overlaps the hero's cards, with
// enough margin that the cards lifting on the hero's turn still clears it.
const HERO_CHIP_ABOVE_PX = 105;
// Design-px from the hero seat's center down to the bottom of its pod (+ a small
// margin). Used to clamp the hero up so the pod never hangs past the felt rail.
const HERO_BLOCK_HALF_PX = 80;

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
          // Size changes now come from real viewport/panel changes, not turn
          // controls; the dock reserves betting height even while waiting.
          transition: "transform 0.18s ease-out",
          // published for the seat label legibility floor (M3)
          ["--table-scale" as string]: fit.scale || 1,
        }}
      >
      {/* felt — a wide rounded-rectangle (PokerNow-style stadium), filling the
          design box edge-to-edge horizontally so on a phone the table reaches
          the screen width instead of an oval that letterboxes. A thick dark rail,
          a lit center, and a green halo make it read as a real table spotlit in a
          dark room (so the ambient margins look intentional, not dead). */}
      <div
        data-ui="felt"
        className="absolute inset-x-[1%] inset-y-[3%] rounded-[13%/9%] ring-[7px] ring-[#15110f] border border-black/60 shadow-[inset_0_0_80px_rgba(0,0,0,0.5),0_0_90px_16px_rgba(52,170,108,0.14)]"
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%, #3aa46a 0%, #2f9560 50%, #237a4d 100%)",
        }}
      >
        {/* center spotlight — brighter felt under the pot, falling off to the rail */}
        <div
          className="absolute inset-0 rounded-[13%/9%]"
          style={{
            background:
              "radial-gradient(ellipse at 50% 37%, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0) 46%)",
          }}
        />
        {/* inner rail hairline */}
        <div className="absolute inset-[5%] rounded-[12%/8%] border border-white/[0.08]" />
      </div>

      <ShowdownResultBanner state={state} />

      {/* center: pot + board. One clear "Pot" figure = the TOTAL at stake (chips
          already collected in the middle PLUS the current street's bets shown in
          front of each seat), so a beginner never sees two competing numbers. */}
      <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
        {state.totalPot > 0 && (
          <div data-ui="pot" className="flex items-center gap-2 rounded-full bg-black/70 px-3.5 py-1 shadow-lg ring-1 ring-amber-300/25">
            <PotChipStack />
            <span className="text-base font-extrabold text-white tabular-nums">
              Pot {fmtChips(state.totalPot)}
            </span>
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
        // Keep the hero's pod fully on the felt. The hero sits at the very bottom
        // with a fixed-size pod; on the short WIDE (desktop) design box that pod
        // would otherwise hang below the bottom rail. Clamp the hero's vertical
        // position up by a box-aware amount so the pod bottom stays inside the
        // felt's bottom edge (~97%) on every design box.
        const heroY = isHero
          ? Math.min(p.y, 97 - (HERO_BLOCK_HALF_PX / fit.base.h) * 100)
          : p.y;
        // The hero's lg hole cards are centered over the pod, so the default
        // "toward the pot" bet-chip spot lands ON those cards. Place the hero's
        // chip a fixed design-px distance ABOVE the card stack instead — a px
        // (not %) offset clears the same-sized cards on every design box.
        const betLeftPct = isHero ? p.x : p.betX;
        const betTopPct = isHero ? heroY - (HERO_CHIP_ABOVE_PX / fit.base.h) * 100 : p.betY;
        return (
          <div key={p.seat}>
            <div
              className="absolute"
              style={{ left: `${x}%`, top: `${heroY}%`, transform: "translate(-50%, -50%)" }}
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
                style={{ left: `${betLeftPct}%`, top: `${betTopPct}%`, transform: "translate(-50%, -50%)" }}
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
