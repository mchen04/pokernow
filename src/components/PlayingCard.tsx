import type { Card } from "@common/cards";
import { rankChar, SUIT_SYMBOL } from "@common/cards";
import { usePrefs } from "../lib/prefs";

type Size = "xs" | "sm" | "md" | "lg";

const SIZES: Record<Size, { w: string; h: string; rank: string; suit: string }> = {
  // xs is for 4-card Omaha hands so the wider row still fits the pod footprint
  xs: { w: "w-7", h: "h-[42px]", rank: "text-sm", suit: "text-sm" },
  sm: { w: "w-9", h: "h-[52px]", rank: "text-base", suit: "text-base" },
  md: { w: "w-11", h: "h-16", rank: "text-xl", suit: "text-xl" },
  lg: { w: "w-[58px]", h: "h-[82px]", rank: "text-3xl", suit: "text-2xl" },
};

const SUIT_COLOR: Record<string, string> = {
  s: "text-slate-900",
  c: "text-emerald-700",
  h: "text-red-600",
  d: "text-blue-600",
};

export function PlayingCard({
  card,
  size = "md",
  faceDown = false,
  dim = false,
}: {
  card?: Card | null;
  size?: Size;
  faceDown?: boolean;
  dim?: boolean;
}) {
  const { fourColor } = usePrefs();
  const s = SIZES[size];
  if (faceDown || !card) {
    return (
      <div
        className={`${s.w} ${s.h} rounded-md border border-black/30 shadow-sm shrink-0 bg-gradient-to-br from-rose-700 to-rose-900`}
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(255,255,255,0.10) 0 4px, transparent 4px 8px)",
        }}
        aria-label="face-down card"
      />
    );
  }
  const color = fourColor
    ? SUIT_COLOR[card.suit]
    : card.suit === "h" || card.suit === "d"
      ? "text-red-600"
      : "text-slate-900";
  return (
    <div
      className={`${s.w} ${s.h} rounded-md bg-white border border-black/20 shadow-sm shrink-0 relative ${
        dim ? "opacity-60" : ""
      } flex flex-col items-center justify-center leading-none select-none`}
      aria-label={`${rankChar(card.rank)}${card.suit}`}
    >
      <span className={`absolute top-0.5 left-1 font-bold ${s.rank} ${color}`}>
        {rankChar(card.rank)}
      </span>
      <span className={`${s.suit} ${color} mt-1`}>{SUIT_SYMBOL[card.suit]}</span>
    </div>
  );
}

export function CardRow({ cards, size = "md", faceDownCount = 0 }: { cards: Card[]; size?: Size; faceDownCount?: number }) {
  return (
    <div className="flex gap-1">
      {cards.map((c, i) => (
        <PlayingCard key={i} card={c} size={size} />
      ))}
      {Array.from({ length: faceDownCount }).map((_, i) => (
        <PlayingCard key={`fd${i}`} faceDown size={size} />
      ))}
    </div>
  );
}
