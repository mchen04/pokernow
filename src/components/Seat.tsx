import { memo, useEffect, useRef } from "react";
import type { PublicSeat } from "@common/protocol";
import { fmtChips, fmtNet } from "@common/money";
import { PlayingCard } from "./PlayingCard";

const AVATAR_COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-fuchsia-500",
];

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({ name, seed }: { name: string; seed: string }) {
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white/95 ${avatarColor(seed)}`}
    >
      {name.charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center h-5 min-w-[20px] px-1 rounded-full text-[11px] font-bold whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

// Live camera tile shown to the LEFT of the pod when a seat's player has video
// on. It self-stretches to the full height of the right-hand column (cards
// stacked above the name/money pod) so the seat reads as one block:
// [ camera | (cards / pod) ] — a left video half and a right card+tile half.
// Width is fixed (hero a touch wider); height is driven by the column via
// items-stretch. Muted for the hero's own tile to avoid echo.
function SeatVideoTile({ stream, muted, hero }: { stream: MediaStream; muted: boolean; hero: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div
      className={`shrink-0 self-stretch overflow-hidden rounded-lg bg-black ring-1 ring-white/15 shadow ${
        hero ? "w-[104px]" : "w-[92px]"
      }`}
    >
      <video ref={ref} autoPlay playsInline muted={muted} className="h-full w-full object-cover" />
    </div>
  );
}

interface SeatProps {
  seat: PublicSeat;
  isHero: boolean;
  now: number;
  actionDeadline: number | null;
  actionTimeSec: number;
  onSit: (seatIndex: number) => void;
  stream?: MediaStream | null;
}

function SeatImpl({
  seat,
  isHero,
  now,
  actionDeadline,
  actionTimeSec,
  onSit,
  stream,
}: SeatProps) {
  if (seat.empty) {
    return (
      <button
        onClick={() => onSit(seat.index)}
        className="group flex flex-col items-center justify-center w-[104px] h-[58px] rounded-full border border-dashed border-white/25 bg-black/20 hover:bg-emerald-500/20 hover:border-emerald-300/60 transition text-white/50 hover:text-white"
      >
        <span className="text-xs font-semibold">Sit here</span>
        <span className="text-[10px] opacity-70">Seat {seat.index + 1}</span>
      </button>
    );
  }

  // Show the camera tile only when the server marks the seat's camera on AND a
  // stream with a live video track is actually present (avoids a black flash).
  const hasVideo = !!stream && seat.camOn && stream.getVideoTracks().length > 0;

  const timeFrac =
    seat.isToAct && actionDeadline
      ? Math.max(0, Math.min(1, (actionDeadline - now) / (actionTimeSec * 1000)))
      : 0;
  const urgent = seat.isToAct && timeFrac < 0.25;

  const ringColor = seat.isToAct
    ? urgent
      ? "ring-2 ring-red-400"
      : "ring-2 ring-amber-300"
    : seat.winner
      ? "ring-2 ring-yellow-300"
      : "ring-1 ring-white/10";

  // Cards always sit ABOVE the pod (with or without a camera): in the no-video
  // layout the cards stack directly over the pod; in the video layout they form
  // the top of the right-hand column. A 4-card Omaha row is wider than the pod,
  // so non-hero seats shrink to xs. min-h reserves the row's height so the pod
  // never shifts when cards appear/disappear (no-layout-shift invariant).
  const n = seat.holeCards?.length || (seat.hasCards ? seat.cardCount || 2 : 0);
  const cardSize = n >= 4 && !isHero ? "xs" : "sm";
  const cardsEl = (
    <div className="flex gap-0.5 z-10 mb-1 min-h-[42px] items-end">
      {seat.holeCards
        ? seat.holeCards.map((c, i) => <PlayingCard key={i} card={c} size={cardSize} />)
        : seat.hasCards
          ? Array.from({ length: seat.cardCount || 2 }).map((_, i) => (
              <PlayingCard key={i} faceDown size={cardSize} />
            ))
          : null}
    </div>
  );

  const podEl = (
    <div
      className={`relative flex w-[128px] items-center gap-2 rounded-xl bg-slate-900/90 ${ringColor} px-2 py-1.5 shadow-lg ${
        seat.folded ? "opacity-50" : ""
      }`}
    >
      <Avatar name={seat.name} seed={seat.playerId ?? seat.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="seat-name truncate font-semibold leading-tight text-white">
            {seat.name}
            {isHero && <span className="text-emerald-300"> (you)</span>}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="seat-stack font-bold leading-tight text-emerald-300 tabular-nums">
            {fmtChips(seat.stack)}
          </span>
          {seat.allIn && <Badge className="bg-red-500 text-white">ALL IN</Badge>}
          {seat.sittingOut && !seat.inHand && <span className="text-[10px] text-white/40">out</span>}
        </div>
      </div>

      {/* timer bar */}
      {seat.isToAct && (
        <div className="absolute -bottom-1 left-2 right-2 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className={`h-full ${urgent ? "bg-red-400" : "bg-amber-300"}`}
            style={{ width: `${timeFrac * 100}%`, transition: "width 0.25s linear" }}
          />
        </div>
      )}

      {/* badges */}
      <div className="absolute -top-2 -left-2 flex gap-0.5">
        {seat.isButton && <Badge className="bg-white text-slate-900">D</Badge>}
        {seat.isSmallBlind && <Badge className="bg-sky-500 text-white">SB</Badge>}
        {seat.isBigBlind && <Badge className="bg-indigo-500 text-white">BB</Badge>}
        {seat.isStraddle && <Badge className="bg-fuchsia-500 text-white">STR</Badge>}
      </div>
      {seat.bounty && (
        <div className="absolute -top-2 -right-2">
          <Badge className="bg-yellow-400 text-slate-900">7-2</Badge>
        </div>
      )}

      {/* last action / win */}
      {seat.winner && seat.wonAmount > 0 ? (
        <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-yellow-400 px-2 py-0.5 text-[11px] font-bold text-slate-900">
          {fmtNet(seat.wonAmount)}
        </div>
      ) : seat.lastAction && seat.inHand ? (
        <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white/90">
          {seat.lastAction}
        </div>
      ) : null}
    </div>
  );

  // hasVideo -> [ camera | (cards / pod) ]: video on the left; on the right a
  // vertical combo with the cards stacked above the name/money pod. The video
  // self-stretches (items-stretch) to match the right column's height, giving a
  // clean left-camera / right-combo split. No video -> the same cards-above-pod
  // stack, centered, with no camera.
  return hasVideo ? (
    <div className="relative flex flex-row items-stretch gap-1">
      <SeatVideoTile stream={stream!} muted={isHero} hero={isHero} />
      <div className="flex flex-col items-center">
        {cardsEl}
        {podEl}
      </div>
    </div>
  ) : (
    <div className="relative flex flex-col items-center" style={{ width: 120 }}>
      {cardsEl}
      {podEl}
    </div>
  );
}

// `now` ticks every 250ms during play but only matters to the seat that's
// currently to act (its timer bar animates). For every other seat the rendered
// output is unchanged between ticks, so we skip the re-render: `seat` keeps the
// same reference between server pushes, so a stable reference + unchanged
// siblings means nothing visible changed.
function seatPropsEqual(a: SeatProps, b: SeatProps): boolean {
  if (a.seat.isToAct || b.seat.isToAct) return false;
  return (
    a.seat === b.seat &&
    a.isHero === b.isHero &&
    a.actionDeadline === b.actionDeadline &&
    a.actionTimeSec === b.actionTimeSec &&
    a.onSit === b.onSit &&
    a.stream === b.stream
  );
}

export const Seat = memo(SeatImpl, seatPropsEqual);
