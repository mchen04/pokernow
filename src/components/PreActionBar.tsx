import type { PreAction } from "./BottomDock";

// Pre-action ("act in turn") chips shown while the hero waits on another player.
// Tapping one queues that action; it fires the instant the turn arrives and
// clears if the price changes. A selected chip stays lit so the hero can see
// what's armed, and a small caption keeps the band informative (KR7).
export function PreActionBar({
  selected,
  canCheck,
  callLabel,
  waitingName,
  onSelect,
}: {
  selected: PreAction | null;
  canCheck: boolean;
  callLabel: string;
  waitingName: string | null;
  onSelect: (a: PreAction) => void;
}) {
  const chip = (active: boolean, tone: "rose" | "emerald" | "sky") => {
    const base =
      "min-h-[40px] flex-1 rounded-lg px-2 text-[13px] font-bold transition active:scale-[.98] ring-1";
    if (active) {
      const on = {
        rose: "bg-rose-600 text-white ring-rose-300/40",
        emerald: "bg-emerald-600 text-white ring-emerald-300/40",
        sky: "bg-sky-600 text-white ring-sky-300/40",
      }[tone];
      return `${base} ${on} shadow-[0_0_14px_rgba(255,255,255,0.18)]`;
    }
    return `${base} bg-white/5 text-white/70 ring-white/10 hover:bg-white/10`;
  };

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/45">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
        {waitingName ? `Waiting for ${waitingName}…` : "Waiting…"}
        <span className="text-white/30">·</span>
        <span className="text-white/55">act in turn</span>
      </div>
      <div className="flex w-full gap-1.5">
        {canCheck ? (
          <>
            <button className={chip(selected === "check", "emerald")} onClick={() => onSelect("check")}>
              Check
            </button>
            <button className={chip(selected === "check-fold", "rose")} onClick={() => onSelect("check-fold")}>
              Check / Fold
            </button>
          </>
        ) : (
          <>
            <button className={chip(selected === "fold", "rose")} onClick={() => onSelect("fold")}>
              Fold
            </button>
            <button className={chip(selected === "call", "emerald")} onClick={() => onSelect("call")}>
              Call {callLabel}
            </button>
            <button className={chip(selected === "call-any", "sky")} onClick={() => onSelect("call-any")}>
              Call Any
            </button>
          </>
        )}
      </div>
    </div>
  );
}
