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
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white/95 ${avatarColor(seed)}`}
    >
      {name.charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function Badge({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center justify-center h-5 min-w-[20px] px-1 rounded-full text-[12px] font-bold whitespace-nowrap ${className}`}
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
    // Empty seats recede: a faint ghosted ring so real players and the lit center
    // pop, and the felt never reads as a wireframe of identical slots. They brighten
    // to an inviting emerald on hover/focus (KR1/KR5).
    return (
      <button
        onClick={() => onSit(seat.index)}
        aria-label={`Sit in seat ${seat.index + 1}`}
        className="group flex items-center justify-center w-[76px] h-[34px] rounded-full border border-dashed border-white/10 bg-white/[0.02] text-white/25 transition hover:border-emerald-300/60 hover:bg-emerald-600/20 hover:text-white focus-visible:text-white"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide">Sit</span>
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
      : isHero
        ? "ring-1 ring-emerald-400/45" // the hero's own seat is always findable
        : "ring-1 ring-white/10";

  // Cards always sit ABOVE the pod (with or without a camera): in the no-video
  // layout the cards stack directly over the pod; in the video layout they form
  // the top of the right-hand column. A 4-card Omaha row is wider than the pod,
  // so non-hero seats shrink to xs. min-h reserves the row's height so the pod
  // never shifts when cards appear/disappear (no-layout-shift invariant).
  const n = seat.holeCards?.length || (seat.hasCards ? seat.cardCount || 2 : 0);
  // The hero's own hole cards are the most important info on the table, so they
  // are the BIGGEST cards on the felt (board-sized for Hold'em). 4-card Omaha
  // stays a step smaller so the wider row still fits the pod.
  const cardSize = isHero ? (n >= 4 ? "md" : "lg") : n >= 4 ? "xs" : "sm";
  // On the hero's turn the hole cards lift and brighten — a clear, physical "act
  // now" cue that draws the eye to your own hand (KR6), paired with the pod ring
  // and timer. Slightly overlap the cards into the pod when lifted via -mb.
  const heroLift = isHero && seat.isToAct;
  const cardsEl = (
    <div
      data-ui="holecards"
      className={`flex z-10 mb-2 items-end transition-transform duration-200 ${
        isHero ? "gap-1 min-h-[84px]" : "gap-0.5 min-h-[42px]"
      } ${heroLift ? "-translate-y-1.5 scale-[1.06] drop-shadow-[0_8px_16px_rgba(0,0,0,0.55)]" : ""} ${
        seat.winner ? "rounded-lg ring-2 ring-yellow-300/90" : ""
      }`}
    >
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
      data-ui="pod"
      className={`relative flex w-[128px] items-center gap-2 rounded-xl bg-[#15171b]/92 ${ringColor} px-2 py-1.5 ${
        seat.isToAct
          ? "shadow-[0_0_22px_rgba(252,211,77,0.5)]"
          : seat.winner
            ? "shadow-[0_0_22px_rgba(250,204,21,0.55)]"
            : isHero
              ? "shadow-[0_0_16px_rgba(16,185,129,0.28)]"
              : "shadow-lg"
      } ${seat.folded ? "opacity-50" : ""}`}
    >
      <Avatar name={seat.name} seed={seat.playerId ?? seat.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1">
          <span className="seat-name truncate font-semibold leading-tight text-white">{seat.name}</span>
          {isHero && (
            <span className="shrink-0 rounded bg-emerald-500/20 px-1 text-[10px] font-bold leading-none text-emerald-300">
              YOU
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="seat-stack font-bold leading-tight text-emerald-300 tabular-nums">
            {fmtChips(seat.stack)}
          </span>
          {seat.allIn && <Badge className="bg-red-500 text-white">ALL IN</Badge>}
          {!seat.connected ? (
            <span className="text-[11px] font-semibold text-amber-200/85">away</span>
          ) : (
            seat.sittingOut && !seat.inHand && <span className="text-[11px] text-white/55">out</span>
          )}
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

      {/* badges — dealer is a crisp white disc; blinds/straddle are matching tags.
          Sit at the pod's top edge (not up into the card row above) so the hole
          cards never clip them. */}
      <div data-ui="badges" className="absolute -top-2 -left-2 flex items-center gap-0.5">
        {seat.isButton && (
          <span
            title="Dealer button"
            className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-white text-[12px] font-black text-slate-900 shadow-[0_2px_4px_rgba(0,0,0,0.5)] ring-1 ring-black/20"
          >
            D
          </span>
        )}
        {seat.isSmallBlind && <Badge title="Small blind" className="bg-sky-600 text-white shadow ring-1 ring-black/20">SB</Badge>}
        {seat.isBigBlind && <Badge title="Big blind" className="bg-indigo-600 text-white shadow ring-1 ring-black/20">BB</Badge>}
        {seat.isStraddle && <Badge title="Straddle" className="bg-fuchsia-600 text-white shadow ring-1 ring-black/20">STR</Badge>}
      </div>
      {seat.bounty && (
        <div className="absolute -top-2 -right-2">
          <Badge className="bg-yellow-400 text-slate-900">7-2</Badge>
        </div>
      )}

      {/* status line below the pod: a single short pill — the "TO ACT" cue, the
          win amount, or the last action. Exactly one pill (never a stack), so it
          always fits in the strip just below the pod without spilling past the
          felt edge. The made-hand label is intentionally not shown per-seat (the
          cards are face-up at showdown and the result banner names the winner).
          Hidden on the hero's OWN seat: the hero sits at the very bottom of the
          felt where a pill below the pod would spill into the gutter, and their
          turn/action is already shown in the dock (action bar + ring + glow). */}
      {!isHero && (seat.isToAct || (seat.winner && seat.wonAmount > 0) || (seat.lastAction && seat.inHand)) && (
        <div data-ui="seatstatus" className="absolute top-full mt-1 left-1/2 flex -translate-x-1/2 flex-col items-center">
          {seat.isToAct ? (
            <span className="whitespace-nowrap rounded-full bg-amber-300 px-2 py-0.5 text-[12px] font-bold text-slate-900">
              TO ACT
            </span>
          ) : seat.winner && seat.wonAmount > 0 ? (
            <span className="whitespace-nowrap rounded-full bg-yellow-400 px-2 py-0.5 text-[11px] font-bold text-slate-900">
              {fmtNet(seat.wonAmount)}
            </span>
          ) : seat.lastAction && seat.inHand ? (
            <span className="whitespace-nowrap rounded-full bg-black/70 px-2 py-0.5 text-[12px] font-medium text-white">
              {seat.lastAction}
            </span>
          ) : null}
        </div>
      )}
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
