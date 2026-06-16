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

export function BetChips({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  return (
    <div className="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 shadow ring-1 ring-white/10">
      <span className="h-3 w-3 rounded-full bg-amber-400 ring-1 ring-amber-200" />
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
