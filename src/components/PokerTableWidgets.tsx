import { useEffect, useRef, useState } from "react";
import type { ChatMessage, PublicTableState } from "@common/protocol";
import { fmtChips } from "@common/money";

function isReaction(text: string): boolean {
  return text.length > 0 && text.length <= 6 && !/[a-z0-9]/i.test(text);
}

export function FloatingReactions({ chat }: { chat: ChatMessage[] }) {
  const [items, setItems] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const seen = useRef<Set<number> | null>(null);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    return () => {
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear();
    };
  }, []);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(chat.map((m) => m.id));
      return;
    }
    for (const m of chat) {
      if (seen.current.has(m.id)) continue;
      seen.current.add(m.id);
      if (!m.system && isReaction(m.text)) {
        const x = 15 + ((m.id * 37) % 70);
        setItems((it) => [...it, { id: m.id, emoji: m.text, x }]);
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          setItems((it) => it.filter((i) => i.id !== m.id));
        }, 2200);
        timers.current.add(timer);
      }
    }
  }, [chat]);

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {items.map((i) => (
        <span key={i.id} className="float-emoji absolute bottom-[18%] text-4xl" style={{ left: `${i.x}%` }}>
          {i.emoji}
        </span>
      ))}
    </div>
  );
}

// A single poker-chip disc: a colored body with a dashed edge ring and a darker
// inner ring, so it reads as a real chip rather than a flat dot — even at ~14px.
function Chip({ tone = "amber", size = 14 }: { tone?: "amber" | "red" | "blue"; size?: number }) {
  const body =
    tone === "red" ? "#e0556a" : tone === "blue" ? "#5aa0e0" : "#f2b73c";
  const edge =
    tone === "red" ? "#7a1f2c" : tone === "blue" ? "#1f4a7a" : "#9a6a12";
  return (
    <span
      className="relative inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: body,
        boxShadow: `0 1px 2px rgba(0,0,0,0.5), inset 0 0 0 2px ${edge}55`,
        border: `1.5px dashed rgba(255,255,255,0.85)`,
      }}
    />
  );
}

// A small stack of chips for the central pot — three offset discs.
function PotChipStack() {
  return (
    <span className="relative inline-flex h-4 w-5 items-center">
      <span className="absolute left-0 top-0.5"><Chip tone="blue" size={13} /></span>
      <span className="absolute left-1"><Chip tone="red" size={13} /></span>
      <span className="absolute left-2 top-0.5"><Chip tone="amber" size={13} /></span>
    </span>
  );
}

export { PotChipStack };

export function BetChips({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  return (
    <div data-ui="betchip" className="flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 shadow ring-1 ring-white/10">
      <Chip tone="amber" size={14} />
      <span className="text-[12px] font-bold text-white tabular-nums">{fmtChips(amount)}</span>
    </div>
  );
}

export function ShowdownResultBanner({ state }: { state: PublicTableState }) {
  const winners = state.seats.filter((s) => s.winner && s.wonAmount > 0);
  const showResult = (state.phase === "showdown" || state.phase === "between") && winners.length > 0;
  if (!showResult) return null;

  const resultText =
    winners.length === 1
      ? `${winners[0].name} wins ${fmtChips(winners[0].wonAmount)}${
          winners[0].handLabel ? ` with ${winners[0].handLabel}` : ""
        }`
      : winners.map((w) => `${w.name} wins ${fmtChips(w.wonAmount)}`).join(" · ");

  return (
    <div className="absolute left-1/2 top-[30%] z-30 max-w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-400 px-4 py-1.5 text-center text-sm font-bold text-slate-900 shadow-lg ring-2 ring-yellow-200/60">
      {resultText}
    </div>
  );
}
