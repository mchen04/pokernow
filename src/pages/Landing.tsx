import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { makeRoomCode } from "../lib/identity";

const SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" } as const;
type Suit = keyof typeof SUIT;

function ArtCard({
  rank,
  suit,
  className = "",
  style,
}: {
  rank: string;
  suit: Suit;
  className?: string;
  style?: React.CSSProperties;
}) {
  const red = suit === "h" || suit === "d";
  return (
    <div
      className={`relative rounded-xl bg-[#f7f4ec] shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)] ring-1 ring-black/10 ${className}`}
      style={style}
    >
      <div className={`absolute left-2 top-1.5 flex flex-col items-center leading-none ${red ? "text-[#d6353b]" : "text-[#1a1a1a]"}`}>
        <span className="font-display text-xl font-semibold">{rank}</span>
        <span className="text-base">{SUIT[suit]}</span>
      </div>
      <div className={`absolute inset-0 flex items-center justify-center text-5xl ${red ? "text-[#d6353b]" : "text-[#1a1a1a]"}`}>
        {SUIT[suit]}
      </div>
      <div className={`absolute bottom-1.5 right-2 flex rotate-180 flex-col items-center leading-none ${red ? "text-[#d6353b]" : "text-[#1a1a1a]"}`}>
        <span className="font-display text-xl font-semibold">{rank}</span>
        <span className="text-base">{SUIT[suit]}</span>
      </div>
    </div>
  );
}

function Feature({
  title,
  desc,
  tag,
  delay,
}: {
  title: string;
  desc: string;
  tag: string;
  delay: number;
}) {
  return (
    <div
      className="reveal group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-[#f2b138]/40 hover:bg-white/[0.05]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/35 line-through decoration-[#e5484d]/70">
          {tag}
        </span>
        <span className="rounded-full bg-[#f2b138]/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#f2b138]">
          Free
        </span>
      </div>
      <h3 className="mb-1 font-display text-xl font-semibold text-[#f3efe4]">{title}</h3>
      <p className="text-sm leading-relaxed text-white/55">{desc}</p>
    </div>
  );
}

const FEATURES: { title: string; desc: string; tag: string }[] = [
  { title: "Run It Twice", desc: "Deal the rest of the board twice on all-ins to cut the variance.", tag: "Diamonds" },
  { title: "Rabbit Hunt", desc: "Curious what would've come? Reveal the cards that never hit.", tag: "Diamonds" },
  { title: "Stats & Analytics", desc: "VPIP, PFR, win-rate, biggest pots, net up/down — for every player.", tag: "PLUS" },
  { title: "Hand Replay", desc: "Step back through any hand, action by action, street by street.", tag: "PLUS" },
  { title: "Tournaments", desc: "Multi-table tournaments and Sit & Go with blinds, payouts, balancing.", tag: "Premium" },
  { title: "House Games", desc: "Bomb pots, 7-2 bounties, double boards, NIT — flip them on, no unlock.", tag: "Diamonds" },
  { title: "Spectator Mode", desc: "Let friends rail the table — public cards, or face-up if you allow it.", tag: "PLUS" },
  { title: "Full Log & Download", desc: "Every action, uncapped. Export the whole session as text, CSV, or JSON.", tag: "Truncated" },
  { title: "Clubs", desc: "Recurring private games and a member list for your regular crew.", tag: "Premium" },
];

export default function Landing() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  const start = () => navigate(`/room/${makeRoomCode()}`);
  const startClub = () => navigate(`/club/${makeRoomCode()}`);
  const join = () => {
    const c = code.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (c) navigate(`/room/${c}`);
  };

  return (
    <div className="grain relative min-h-[100dvh] overflow-hidden bg-[#0a100d] font-body text-[#f3efe4] antialiased">
      {/* atmosphere */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(900px 600px at 75% -5%, rgba(36,120,92,0.35), transparent 60%), radial-gradient(700px 500px at 8% 18%, rgba(20,80,60,0.30), transparent 55%), radial-gradient(circle at 50% 120%, rgba(242,177,56,0.10), transparent 50%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8">
        {/* nav */}
        <nav className="flex items-center justify-between py-6">
          <div className="flex items-center gap-2">
            <span className="text-2xl leading-none text-[#f2b138]">♠</span>
            <span className="font-display text-2xl font-semibold tracking-tight">Felt</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={startClub}
              className="rounded-full px-4 py-2 text-sm font-semibold text-white/60 transition hover:text-white"
            >
              Clubs
            </button>
            <button
              onClick={start}
              className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-[#f2b138]/50 hover:text-white"
            >
              Start a game
            </button>
          </div>
        </nav>

        {/* hero */}
        <header className="grid items-center gap-10 pb-16 pt-6 sm:pt-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-6 lg:pb-28">
          <div>
            <div
              className="reveal mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[12px] font-medium text-white/60"
              style={{ animationDelay: "60ms" }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#f2b138]" />
              No app · No signup · No paywall
            </div>
            <h1
              className="reveal font-display text-[clamp(2.6rem,7vw,5rem)] font-semibold leading-[0.98] tracking-[-0.02em]"
              style={{ animationDelay: "140ms" }}
            >
              Private poker
              <br />
              with friends.{" "}
              <span className="italic text-[#f2b138]" style={{ fontVariationSettings: '"SOFT" 60' }}>
                Everything
              </span>{" "}
              free.
            </h1>
            <p
              className="reveal mt-6 max-w-md text-lg leading-relaxed text-white/60"
              style={{ animationDelay: "240ms" }}
            >
              Every feature other rooms hide behind diamonds, PLUS tiers and timers — all
              of it, on the house. Deal a hand in one click and share the link.
            </p>

            <div className="reveal mt-8 flex flex-col gap-3 sm:flex-row sm:items-center" style={{ animationDelay: "340ms" }}>
              <button
                onClick={start}
                className="group relative overflow-hidden rounded-full bg-[#f2b138] px-7 py-3.5 text-base font-bold text-[#1a1207] shadow-[0_12px_30px_-8px_rgba(242,177,56,0.6)] transition hover:bg-[#ffc24d] active:scale-[.98]"
              >
                Start a Game →
              </button>
              <div className="flex items-stretch overflow-hidden rounded-full border border-white/15 bg-white/[0.03] focus-within:border-[#f2b138]/50">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && join()}
                  placeholder="Enter room code"
                  aria-label="Room code"
                  className="w-36 bg-transparent px-4 py-3 text-sm font-medium tracking-wide text-white outline-none placeholder:text-white/35"
                />
                <button
                  onClick={join}
                  className="border-l border-white/10 px-5 text-sm font-semibold text-white/80 transition hover:bg-white/5 hover:text-white"
                >
                  Join
                </button>
              </div>
            </div>
            <p className="reveal mt-4 text-sm text-white/35" style={{ animationDelay: "440ms" }}>
              Play-money only. No accounts, no real stakes — just your group chat and a table.
            </p>
          </div>

          {/* hero card fan */}
          <div className="relative hidden h-[340px] sm:block">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="relative h-[220px] w-[160px]">
                <ArtCard rank="A" suit="s" className="deal-card float-card absolute h-[210px] w-[150px]" style={{ ["--rot" as string]: "-22deg", left: "-130px", animationDelay: "300ms, 0s", zIndex: 1 }} />
                <ArtCard rank="K" suit="h" className="deal-card float-card absolute h-[210px] w-[150px]" style={{ ["--rot" as string]: "-9deg", left: "-55px", top: "-12px", animationDelay: "440ms, 0.6s", zIndex: 2 }} />
                <ArtCard rank="Q" suit="d" className="deal-card float-card absolute h-[210px] w-[150px]" style={{ ["--rot" as string]: "5deg", left: "20px", top: "-18px", animationDelay: "580ms, 1.2s", zIndex: 3 }} />
                <ArtCard rank="J" suit="c" className="deal-card float-card absolute h-[210px] w-[150px]" style={{ ["--rot" as string]: "19deg", left: "95px", top: "-6px", animationDelay: "720ms, 1.8s", zIndex: 2 }} />
              </div>
              {/* chips */}
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
                <div className="deal-card flex gap-1" style={{ animationDelay: "900ms" }}>
                  {["#e5484d", "#2a8568", "#f2b138", "#3b82f6"].map((c, i) => (
                    <span
                      key={i}
                      className="h-6 w-6 rounded-full ring-2 ring-white/20"
                      style={{ background: c, boxShadow: "inset 0 -3px 6px rgba(0,0,0,0.35)" }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* the one rule banner */}
        <section className="reveal relative mb-20 overflow-hidden rounded-3xl border border-[#f2b138]/20 bg-gradient-to-br from-[#f2b138]/[0.08] to-transparent p-8 sm:p-12">
          <p className="font-display text-2xl font-medium leading-snug text-[#f3efe4] sm:text-4xl">
            One rule:{" "}
            <span className="text-[#f2b138]">if PokerNow makes you pay for it, we don't.</span>
          </p>
          <p className="mt-4 max-w-2xl text-white/55">
            No diamonds. No PLUS tier. No trial countdowns, truncated logs, locked variants, or
            upsell modals. Every premium feature is on for every player, in every game, always.
          </p>
        </section>

        {/* feature grid */}
        <section className="pb-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-5xl">
              The premium menu,
              <span className="italic text-[#f2b138]"> on the house.</span>
            </h2>
            <p className="mt-4 text-white/55">
              Same game you love, same controls, same table. We only changed the price tag.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Feature key={f.title} {...f} delay={i * 70} />
            ))}
          </div>
        </section>

        {/* how it works */}
        <section className="pb-24">
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              { n: "01", t: "Start a game", d: "One click and you're the host. No form, no account, no wait." },
              { n: "02", t: "Share the link", d: "Drop the link or short code in the group chat. That's the invite." },
              { n: "03", t: "Pick a name, deal", d: "Everyone grabs a seat under any name and the cards are in the air." },
            ].map((s, i) => (
              <div key={s.n} className="reveal" style={{ animationDelay: `${i * 90}ms` }}>
                <div className="font-display text-5xl font-medium text-[#f2b138]/30">{s.n}</div>
                <h3 className="mt-2 font-display text-xl font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-white/55">{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* final CTA */}
        <section className="reveal relative mb-20 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] px-6 py-14 text-center">
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(500px 300px at 50% 0%, rgba(242,177,56,0.12), transparent 70%)" }}
          />
          <h2 className="relative font-display text-3xl font-semibold sm:text-5xl">
            Your table's already set.
          </h2>
          <p className="relative mx-auto mt-3 max-w-md text-white/55">
            Deal the first hand in the time it takes to send a text.
          </p>
          <button
            onClick={start}
            className="relative mt-7 rounded-full bg-[#f2b138] px-8 py-3.5 text-base font-bold text-[#1a1207] shadow-[0_12px_30px_-8px_rgba(242,177,56,0.6)] transition hover:bg-[#ffc24d] active:scale-[.98]"
          >
            Start a Game →
          </button>
        </section>

        {/* footer */}
        <footer className="flex flex-col items-center justify-between gap-3 border-t border-white/10 py-8 text-sm text-white/40 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="text-[#f2b138]">♠</span>
            <span className="font-display font-semibold text-white/70">Felt</span>
          </div>
          <p>Play-money only · Not affiliated with PokerNow · No real stakes, ever.</p>
        </footer>
      </div>
    </div>
  );
}
