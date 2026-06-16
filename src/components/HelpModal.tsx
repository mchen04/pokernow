import { X } from "./Icon";

// A lightweight, dismissible "how to play" reference for first-timers: the hand
// rankings best-to-worst plus a plain-English glossary of the table jargon
// (blinds, the button, pot odds). Pure static content — no game state.
const RANKINGS: [string, string][] = [
  ["Royal Flush", "A-K-Q-J-10, all one suit"],
  ["Straight Flush", "Five in a row, all one suit"],
  ["Four of a Kind", "Four cards of the same rank"],
  ["Full House", "Three of a kind + a pair"],
  ["Flush", "Five cards of one suit"],
  ["Straight", "Five cards in a row, any suits"],
  ["Three of a Kind", "Three cards of the same rank"],
  ["Two Pair", "Two different pairs"],
  ["One Pair", "Two cards of the same rank"],
  ["High Card", "None of the above — highest card plays"],
];

const SHORTCUTS: [string, string][] = [
  ["F", "Fold"],
  ["C", "Check / Call"],
  ["K", "Check"],
  ["B / R", "Focus the bet/raise amount"],
  ["1 – 5", "Pick a bet-size preset (1 = min, then the sizing chips)"],
  ["A", "Set the bet to all-in"],
  ["Enter", "Confirm the bet / raise"],
];

const GLOSSARY: [string, string][] = [
  ["Blinds (SB / BB)", "Forced bets the two players left of the dealer post before cards — the small blind and big blind. They get the action going."],
  ["Big blind (BB)", "Also the unit bets are measured in — '6 BB' means six big blinds. The action buttons show sizes in both chips and BB."],
  ["Dealer button (D)", "Marks who 'deals'. It moves one seat left each hand; the player on the button acts last after the flop (an advantage)."],
  ["Check", "Pass the action without betting (only when no one has bet)."],
  ["Call", "Match the current bet to stay in the hand."],
  ["Bet / Raise", "Put chips in — a bet opens, a raise increases an existing bet."],
  ["Fold", "Give up the hand and your chips already in the pot."],
  ["All-in", "Bet every chip you have left."],
  ["Pot odds", "The price you're getting to call: your call vs. the pot you could win. The Call button shows this for you."],
  ["Showdown", "After the final bet, remaining players reveal cards and the best hand wins."],
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10 sm:max-w-2xl lg:max-w-4xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="text-lg font-bold text-white">How to play</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="touch-target -mr-1 flex items-center justify-center rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* bottom fade hints there's more to scroll (absolute to the modal) */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-slate-900 to-transparent" />
        {/* Two columns on sm+ so the whole reference fits at 1440x900 without
            needing to scroll; single column (scrolls) on narrow phones. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-x-8 sm:grid-cols-2">
            <section>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-emerald-300">
                Hand rankings — best to worst
              </h3>
              <ol className="space-y-1">
                {RANKINGS.map(([name, desc], i) => (
                  <li key={name} className="flex items-baseline gap-2 text-sm">
                    <span className="w-5 shrink-0 text-right font-bold text-white/40 tabular-nums">{i + 1}</span>
                    <span className="w-32 shrink-0 font-semibold text-white">{name}</span>
                    <span className="text-white/65">{desc}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="mt-5 sm:mt-0">
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-emerald-300">Table terms</h3>
              <dl className="mb-5 space-y-2">
                {GLOSSARY.map(([term, def]) => (
                  <div key={term}>
                    <dt className="text-sm font-semibold text-white">{term}</dt>
                    <dd className="text-sm text-white/65">{def}</dd>
                  </div>
                ))}
              </dl>

              <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-emerald-300">
                Keyboard shortcuts
              </h3>
              <ul className="space-y-1">
                {SHORTCUTS.map(([key, what]) => (
                  <li key={key} className="flex items-center gap-2 text-sm">
                    <kbd className="inline-block min-w-[3.5rem] rounded border border-white/25 bg-white/5 px-1.5 py-0.5 text-center text-xs font-bold text-white/80">
                      {key}
                    </kbd>
                    <span className="text-white/65">{what}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <p className="mt-5 text-xs text-white/60">
            New here? You'll also see a "You have: …" hint under your cards and the winning hand spelled
            out at showdown — so you can learn as you play.
          </p>
        </div>
      </div>
    </div>
  );
}
