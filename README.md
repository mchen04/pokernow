# Felt — free poker with friends

**Live:** https://pokernow.vercel.app (realtime backend on
`feltline-poker.mchen04.partykit.dev`)

A from-scratch rebuild of [PokerNow](https://www.pokernow.com/): the instant,
no-download, private browser poker room — with **every premium feature free,
for everyone, always**. No diamonds, no PLUS tier, no paywalls, no truncated
logs, no locked variants. Play-money only.

> The in-game UI is a faithful clone of PokerNow's. The **landing page** is the
> one place we deliberately do better.

## Features (all free)

- **Instant private games** — one click, shareable link + short code, join by
  name, no signup. Host gets a full settings/control panel.
- **Server-authoritative No-Limit Hold'em** — blinds, full betting (with correct
  min-raise and short-all-in rules), side pots, uncalled-bet return, showdown,
  reconnect that restores your seat and private cards. A browser never learns a
  card it isn't entitled to see.
- **Variants** — NLHE, Pot-Limit Omaha, PLO Hi/Lo (8-or-better), with correct
  evaluators (Omaha = exactly 2 hole + 3 board; hi/lo split with qualifier).
- **Advanced game modes** — Run It Twice · Rabbit Hunt · Live Straddle · Ante ·
  Time Bank · Bomb Pot · 7-2 Bounty · Double Board. Each a free host toggle.
- **Ledger, full log, hand replay, downloads** — session ledger that reconciles
  to the chips on the table, complete unedited log, step-through replay, and
  uncapped CSV / text / JSON export.
- **Spectator mode + multi-device** — host-toggled face-up spectating; the same
  player on multiple devices at once.
- **Voice & video chat** — opt-in WebRTC mesh, peer-to-peer (no media touches the
  game server). Cameras render **in-seat**: a player's tile becomes
  `[ camera | cards stacked over the name/money pod ]`; audio-only when the
  camera is off.
- **Deep stats / HUD (free for everyone)** — VPIP, PFR, 3-bet, fold-to-3bet,
  aggression factor & frequency, WTSD, W$SD, c-bet, fold-to-c-bet, BB/100,
  biggest pot won/lost, win-rate, and net up/down — plus **all-in EV and "luck"**
  (actual − expected, from a solver-grade equity engine; per-pot, side-pot
  correct, zero-sum) and per-street win equity in the hand replay. The analytics
  PokerNow reserves for PLUS.
- **Sit & Go tournaments** — escalating blind schedule, eliminations, payouts.
- **Clubs** — private communities with a persistent member list and recurring
  games (persisted in PartyKit storage).
- **Polish** — keyboard hotkeys, synthesized sound + mobile haptics, 4-color /
  2-color deck toggle (colorblind-friendly), responsive from phone to desktop.

## Tech

- **Frontend:** TypeScript + React + Vite + Tailwind. Distinctive landing page
  (Fraunces + Hanken Grotesk); pixel-faithful in-game table.
- **Realtime:** [PartyKit](https://partykit.io) — one Party per room holds the
  authoritative in-memory game state at the edge; a separate `club` Party uses
  PartyKit storage for club durability. No traditional database — rooms are
  ephemeral; history lives in the downloadable session.
- **Engine:** pure-TS state machine; crypto-strong (`crypto.getRandomValues` +
  rejection sampling) Fisher–Yates shuffle. The server is the single authority
  for deck, shuffle, turn order, chips, pots, and showdown.

Free is enforced by absence: there is no payment / diamond / subscription /
time-limit / unlock code anywhere in this product.

## Develop

```bash
npm install
npm run dev      # Vite (:5173) + PartyKit (:1999) together
npm test         # engine + stats tests (chip conservation, side pots, eval, HUD/all-in EV)
npm run check    # typecheck
npm run build    # production build -> dist/
```

Open http://localhost:5173.

## Deploy

The frontend deploys to Vercel; the realtime server deploys to PartyKit.

```bash
# 1. Deploy the realtime server (project name is set in partykit.json)
#    -> https://feltline-poker.<user>.partykit.dev
npx partykit deploy

# 2. Build the frontend pointed at that host and deploy to Vercel
vercel deploy --prod --yes \
  --build-env VITE_PARTY_HOST=feltline-poker.<user>.partykit.dev
```

`VITE_PARTY_HOST` tells the client which PartyKit host to open sockets to. In
local dev it defaults to `localhost:1999`; unset in production it falls back to
the same origin (useful if you serve the built app from PartyKit itself).

## Layout

```
common/   shared types + pure logic (cards, evaluator, equity, money, config, protocol, club)
party/    PartyKit servers — server.ts (poker room), club.ts (clubs);
          log.ts (structured ops logging), timings.ts (shared UI pacing constants)
          poker/  deck (crypto shuffle), engine (authoritative state machine),
                  tournament.ts (multi-table coordinator)
src/      React app — pages (Landing, Room, Club), components, hooks
test/     node:test unit + fuzz suites (engine, evaluator, tournament, stats)
```

Not affiliated with PokerNow. Play-money only; no real stakes, ever.
