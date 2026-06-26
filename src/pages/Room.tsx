import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRoom } from "../lib/useRoom";
import { useNow } from "../lib/useNow";
import { useSound } from "../lib/useSound";
import { isMuted, setMuted } from "../lib/sound";
import { usePrefs } from "../lib/prefs";
import { getPlayerName } from "../lib/identity";
import { NameGate } from "../components/NameGate";
import { PokerTable } from "../components/PokerTable";
import { BottomDock } from "../components/BottomDock";
import { ActionBar } from "../components/ActionBar";
import { SidePanel } from "../components/SidePanel";
import { BuyInModal } from "../components/BuyInModal";
import { SettingsModal } from "../components/SettingsModal";
import { LedgerModal } from "../components/LedgerModal";
import { MoreSheet, type SheetItem } from "../components/MoreSheet";
import { HelpModal } from "../components/HelpModal";
import { TourneyBanner, TourneyResults } from "../components/TourneyBanner";
import { useWebRTC } from "../lib/useWebRTC";
import { VoiceVideo } from "../components/VoiceVideo";
import {
  Check,
  Copy,
  DoorOpen,
  HelpCircle,
  LogOut,
  Mic,
  MicOff,
  MessageSquare,
  MoreHorizontal,
  Palette,
  ScrollText,
  Settings,
  Timer,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
  CirclePause,
  CirclePlay,
} from "../components/Icon";

type CoveringOverlay =
  | { type: "sit"; seat: number }
  | { type: "rebuy" }
  | { type: "settings" }
  | { type: "ledger" }
  | { type: "help" }
  | { type: "more" }
  | { type: "chat" };

function overlayPolicy(overlay: CoveringOverlay | null, widePanel: boolean) {
  if (!overlay) return { coversDock: false, autoCloseOnTurn: false, showFloatingActions: false };
  if (overlay.type === "chat") {
    return {
      coversDock: !widePanel,
      autoCloseOnTurn: !widePanel,
      showFloatingActions: !widePanel,
    };
  }
  // Everything else (sit / rebuy / settings / ledger / help / more) is a
  // full-screen modal that already sits above the felt. The dock is hidden
  // behind it, so don't relocate the betting controls to a floating top bar —
  // that made the dock look like it jumped to the top of the screen when you
  // opened the ledger or how-to-play. The modal is just a modal; nothing in the
  // background changes. 'more' still auto-closes when it becomes your turn.
  return {
    coversDock: false,
    autoCloseOnTurn: overlay.type === "more",
    showFloatingActions: false,
  };
}

export default function Room() {
  const { roomId = "" } = useParams();
  const [name, setName] = useState(getPlayerName());

  if (!name) {
    return (
      <NameGate
        title="Join the table"
        subtitle="Pick a name to play. No account, no signup."
        cta="Join"
        onDone={setName}
      />
    );
  }

  return <RoomInner roomId={roomId} name={name} />;
}

// A compact icon button for the desktop inline header controls.
function IconBtn({
  onClick,
  label,
  active,
  children,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`touch-target flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md p-2 hover:bg-white/10 ${
        active ? "text-emerald-400" : "text-white/60 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(window.matchMedia(query).matches);
    onChange();
    media.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    const interval = window.setInterval(onChange, 250);
    return () => {
      media.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
      window.clearInterval(interval);
    };
  }, [query]);
  return matches;
}

function RoomInner({ roomId, name }: { roomId: string; name: string }) {
  const navigate = useNavigate();
  const { state, connected, error, send, playerId, histories, onRtc } = useRoom(roomId, name);
  const active = state?.phase === "hand" || !!state?.tourney?.active;
  const now = useNow(active);
  const [resultsDismissed, setResultsDismissed] = useState(false);
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openOverlay, setOpenOverlay] = useState<CoveringOverlay | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const [seenChat, setSeenChat] = useState(0);
  const widePanel = useMediaQuery("(min-width: 1280px)");
  const { fourColor, setFourColor } = usePrefs();
  useSound(state);

  const policy = overlayPolicy(openOverlay, widePanel);
  const heroTurn = !!state && state.yourSeat !== null && state.toActSeat === state.yourSeat;
  useEffect(() => {
    if (heroTurn && policy.autoCloseOnTurn) setOpenOverlay(null);
  }, [heroTurn, policy.autoCloseOnTurn]);

  const chatOpen = openOverlay?.type === "chat";
  const chatCount = state?.chat.length ?? 0;
  useEffect(() => {
    if (chatOpen) setSeenChat(chatCount);
  }, [chatOpen, chatCount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openOverlay) setOpenOverlay(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openOverlay]);

  const onSit = useCallback((i: number) => setOpenOverlay({ type: "sit", seat: i }), []);

  // WebRTC voice/video peers = other seated players with mic/cam active. Keep a
  // stable array reference unless the peer set or their media actually changes,
  // so useWebRTC's reconcile effect doesn't churn on every unrelated state push.
  const peerSig = (state?.seats ?? [])
    .filter((s) => !s.empty && s.playerId && s.playerId !== playerId && (s.micOn || s.camOn))
    .map((s) => `${s.playerId}:${s.micOn}:${s.camOn}`)
    .join(",");
  const rtcPeers = useMemo(
    () =>
      (state?.seats ?? [])
        .filter((s) => !s.empty && s.playerId && s.playerId !== playerId && (s.micOn || s.camOn))
        .map((s) => ({ playerId: s.playerId!, on: true })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [peerSig, playerId]
  );
  const rtc = useWebRTC(playerId, rtcPeers, send, onRtc);

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center text-white/60">
        {connected ? "Loading table…" : "Connecting…"}
      </div>
    );
  }

  const me = state.yourSeat !== null ? state.seats[state.yourSeat] : null;
  const isHost = state.hostId === playerId;
  const myTurn = !!me && state.toActSeat === state.yourSeat;
  const canToggleSitOut = !!me && !state.tourney?.active && me.stack > 0;
  const sitOutQueued = !!me?.sittingOut && !!me?.inHand;
  const sitOutLabel = sitOutQueued
    ? "Cancel sit-out"
    : me?.sittingOut
      ? "I'm back"
      : me?.inHand
        ? "Sit out next hand"
        : "Sit out";
  const toggleSitOut = () => {
    if (!me) return;
    send({ type: me.sittingOut ? "sitIn" : "sitOut" });
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    setMutedState(m);
  };

  // "Leave table" releases the seat (so it doesn't sit reserved) and returns home.
  // Distinct from "Stand up" (vacate but keep watching the room).
  const leaveTable = () => {
    if (me) send({ type: "stand" });
    navigate("/");
  };

  // Controls banked off the top bar into the mobile "More" sheet (M2).
  const moreItems: SheetItem[] = [
    {
      icon: <HelpCircle size={20} />,
      label: "How to play",
      sub: "Hand rankings & table terms",
      onClick: () => setOpenOverlay({ type: "help" }),
    },
    {
      icon: muted ? <VolumeX size={20} /> : <Volume2 size={20} />,
      label: muted ? "Sound off" : "Sound on",
      sub: "Table sound effects",
      onClick: toggleMute,
      active: !muted,
      keepOpen: true,
    },
    {
      icon: <Palette size={20} />,
      label: fourColor ? "4-color deck" : "2-color deck",
      sub: "Card suit colors",
      onClick: () => setFourColor(!fourColor),
      active: fourColor,
      keepOpen: true,
    },
    {
      icon: rtc.micOn ? <Mic size={20} /> : <MicOff size={20} />,
      label: rtc.micOn ? "Leave voice" : "Join voice",
      sub: "Talk with the table",
      onClick: () => rtc.toggleMic(),
      active: rtc.micOn,
      keepOpen: true,
    },
    {
      icon: rtc.camOn ? <Video size={20} /> : <VideoOff size={20} />,
      label: rtc.camOn ? "Stop video" : "Start video",
      sub: "Share your camera",
      onClick: () => rtc.toggleCam(),
      active: rtc.camOn,
      keepOpen: true,
    },
    {
      icon: <ScrollText size={20} />,
      label: "Ledger & history",
      sub: "Chips, stats, hand replays",
      onClick: () => setOpenOverlay({ type: "ledger" }),
    },
    {
      icon: <MessageSquare size={20} />,
      label: "Log & chat",
      sub: "Hand log and table chat",
      onClick: () => setOpenOverlay({ type: "chat" }),
    },
    ...(canToggleSitOut
      ? [
          {
            icon: me?.sittingOut ? <CirclePlay size={20} /> : <CirclePause size={20} />,
            label: sitOutLabel,
            sub: sitOutQueued
              ? "Stay in future hands"
              : me?.sittingOut
                ? "Return on the next deal"
                : "Keep your seat, skip future hands",
            onClick: toggleSitOut,
            active: me?.sittingOut,
            keepOpen: true,
          },
        ]
      : []),
    ...(isHost
      ? [
          {
            icon: <Settings size={20} />,
            label: "Table settings",
            sub: "Blinds, variant, game features",
            onClick: () => setOpenOverlay({ type: "settings" }),
          },
        ]
      : []),
    // Seat management lives here (PokerNow keeps these in the OPTIONS menu too)
    // rather than floating over the felt, so the table stays clean and the
    // controls never overlap an opponent's seat (KR5).
    ...(me
      ? [
          {
            icon: <LogOut size={20} />,
            label: "Stand up",
            sub: "Vacate your seat, keep watching",
            onClick: () => send({ type: "stand" }),
            danger: true,
          },
        ]
      : []),
    {
      icon: <DoorOpen size={20} />,
      label: "Leave table",
      sub: "Release your seat and exit to home",
      onClick: leaveTable,
      danger: true,
    },
  ];

  return (
    <div
      className="h-screen-dyn flex flex-col overflow-hidden lg:flex-row"
      style={{
        // Designed ambient depth (KR1): a soft green-tinted glow sits behind the
        // table and falls off to a deep warm charcoal at the edges — the room
        // reads as a lit poker table in a dark space, not a flat dark page.
        background:
          "radial-gradient(125% 75% at 50% 16%, #243a30 0%, #1b1c1b 46%, #131312 100%)",
      }}
    >
      {myTurn && policy.showFloatingActions && (
        <div className="safe-t safe-x fixed inset-x-0 top-0 z-[60] flex justify-center">
          <div className="w-full max-w-3xl rounded-b-xl bg-slate-950/95 px-3 pb-2 pt-3 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <ActionBar state={state} send={send} now={now} />
          </div>
        </div>
      )}
      {/* main */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* header */}
        <header className="safe-t safe-x flex shrink-0 items-center justify-between gap-2 border-b border-white/10 py-2">
          {/* Left: connection status · room name · code (tap to copy invite link) */}
          <div className="flex min-w-0 items-center gap-2">
            <span
              title={connected ? "Connected" : "Reconnecting…"}
              aria-label={connected ? "Connected" : "Reconnecting"}
              className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${
                connected
                  ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.85)]"
                  : "animate-pulse bg-amber-400"
              }`}
            />
            <span className="truncate font-bold text-white">{state.config.roomName}</span>
            <button
              onClick={copyLink}
              title="Copy invite link"
              aria-label="Copy invite link"
              className="touch-target inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 font-mono text-xs font-semibold tracking-widest text-emerald-300 hover:bg-white/20 sm:text-sm"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied!" : roomId.toUpperCase()}
            </button>
            {state.handNumber > 0 && (
              <span className="hidden shrink-0 text-xs text-white/40 md:inline">Hand #{state.handNumber}</span>
            )}
          </div>

          {/* Right: chat + overflow on mobile; full inline control rail on desktop */}
          <div className="flex shrink-0 items-center gap-1 text-white/50">
            <span className="relative">
              <IconBtn
                onClick={() => setOpenOverlay((overlay) => (overlay?.type === "chat" ? null : { type: "chat" }))}
                label="Chat & log"
                active={chatOpen}
              >
                <MessageSquare size={18} />
              </IconBtn>
              {!chatOpen && chatCount > seenChat && (
                <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-[#141312]" />
              )}
            </span>

            {/* desktop inline controls */}
            <div className="hidden items-center gap-0.5 lg:flex">
              <IconBtn onClick={() => setOpenOverlay({ type: "help" })} label="How to play">
                <HelpCircle size={18} />
              </IconBtn>
              <IconBtn onClick={toggleMute} label={muted ? "Unmute" : "Mute"} active={!muted}>
                {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </IconBtn>
              <IconBtn
                onClick={() => setFourColor(!fourColor)}
                label={fourColor ? "Switch to 2-color deck" : "Switch to 4-color deck"}
                active={fourColor}
              >
                <Palette size={18} />
              </IconBtn>
              <IconBtn
                onClick={() => rtc.toggleMic()}
                label={rtc.micOn ? "Leave voice" : "Join voice chat"}
                active={rtc.micOn}
              >
                {rtc.micOn ? <Mic size={18} /> : <MicOff size={18} />}
              </IconBtn>
              <IconBtn
                onClick={() => rtc.toggleCam()}
                label={rtc.camOn ? "Stop video" : "Start video"}
                active={rtc.camOn}
              >
                {rtc.camOn ? <Video size={18} /> : <VideoOff size={18} />}
              </IconBtn>
              <IconBtn onClick={() => setOpenOverlay({ type: "ledger" })} label="Ledger & history">
                <ScrollText size={18} />
              </IconBtn>
              {isHost && (
                <IconBtn onClick={() => setOpenOverlay({ type: "settings" })} label="Table settings">
                  <Settings size={18} />
                </IconBtn>
              )}

              {/* Seat management — desktop has no "More" sheet, so Sit out /
                  Stand up / Leave live in the inline rail here. */}
              {(canToggleSitOut || me) && <span className="mx-1 h-5 w-px bg-white/10" />}
              {canToggleSitOut && (
                <IconBtn onClick={toggleSitOut} label={sitOutLabel} active={me?.sittingOut}>
                  {me?.sittingOut ? <CirclePlay size={18} /> : <CirclePause size={18} />}
                </IconBtn>
              )}
              {me && (
                <IconBtn onClick={() => send({ type: "stand" })} label="Stand up (keep watching)">
                  <LogOut size={18} />
                </IconBtn>
              )}
              <button
                onClick={leaveTable}
                title="Leave table"
                aria-label="Leave table"
                className="touch-target flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md p-2 text-rose-300/80 hover:bg-rose-500/15 hover:text-rose-200"
              >
                <DoorOpen size={18} />
              </button>
            </div>

            {/* mobile overflow */}
            <button
              onClick={() => setOpenOverlay({ type: "more" })}
              title="More"
              aria-label="More options"
              className="touch-target flex items-center justify-center rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
            >
              <MoreHorizontal size={20} />
            </button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0 p-2 sm:p-3">
            <PokerTable
              state={state}
              now={now}
              onSit={onSit}
              localStream={rtc.localStream}
              remote={rtc.remote}
            />
          </div>

          {state.seatedCount <= 1 && !state.handInProgress && !state.tourney?.active && !inviteDismissed && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 w-[min(88%,20rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl">
              {/* header */}
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
                  <Timer size={15} className="text-gray-500" />
                  Waiting for others
                </div>
                <button
                  onClick={() => setInviteDismissed(true)}
                  aria-label="Dismiss"
                  className="pointer-events-auto -mr-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 active:scale-[.95]"
                >
                  <X size={15} />
                </button>
              </div>
              {/* body */}
              <div className="flex flex-col gap-3 px-4 py-4 text-center">
                <p className="text-sm text-gray-700">
                  Share this link with your{" "}
                  <span className="font-bold">friends!</span>
                </p>
                <button
                  onClick={copyLink}
                  className="pointer-events-auto flex w-full items-center justify-center gap-2 rounded-lg bg-[#3ab453] py-2.5 text-sm font-bold uppercase tracking-wide text-white shadow-sm hover:bg-[#2fa046] active:scale-[.98]"
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? "Link copied!" : "Copy link"}
                </button>
                <div className="flex items-center gap-2">
                  <span className="h-px flex-1 bg-gray-200" />
                  <span className="text-xs font-semibold text-gray-400">OR</span>
                  <span className="h-px flex-1 bg-gray-200" />
                </div>
                <p className="text-sm text-gray-700">
                  Share the code{" "}
                  <span className="font-mono font-bold tracking-widest text-emerald-600">{roomId.toUpperCase()}</span>
                </p>
              </div>
            </div>
          )}

          {state.tourney?.active && <TourneyBanner tourney={state.tourney} now={now} />}

          <VoiceVideo remote={rtc.remote} />
          {rtc.error && (
            <div className="pointer-events-none absolute left-1/2 top-12 z-30 -translate-x-1/2 rounded-md bg-amber-600/90 px-3 py-1 text-xs text-white">
              {rtc.error}
            </div>
          )}
        </div>

        <BottomDock
          state={state}
          send={send}
          me={me}
          isHost={isHost}
          myTurn={myTurn}
          error={error}
          now={now}
          suppressActionBar={policy.showFloatingActions}
          onRebuy={() => setOpenOverlay({ type: "rebuy" })}
        />

        {openOverlay?.type === "sit" && (
          <BuyInModal
            config={state.config}
            seatIndex={openOverlay.seat}
            onConfirm={(buyIn) => {
              send({ type: "sit", seat: openOverlay.seat, buyIn });
              setOpenOverlay(null);
            }}
            onCancel={() => setOpenOverlay(null)}
          />
        )}

        {openOverlay?.type === "rebuy" && me && (
          <BuyInModal
            config={state.config}
            seatIndex={me.index}
            rebuy
            onConfirm={(amount) => {
              send({ type: "rebuy", amount });
              setOpenOverlay(null);
            }}
            onCancel={() => setOpenOverlay(null)}
          />
        )}

        {openOverlay?.type === "settings" && (
          <SettingsModal
            config={state.config}
            send={send}
            tourneyActive={!!state.tourney?.active}
            handInProgress={state.phase === "hand" || state.phase === "runout" || state.phase === "showdown"}
            settingsQueued={state.settingsQueued}
            onClose={() => setOpenOverlay(null)}
          />
        )}

        {openOverlay?.type === "ledger" && (
          <LedgerModal
            roomId={roomId}
            ledger={state.ledger}
            stats={state.stats}
            histories={histories}
            log={state.log}
            send={send}
            onClose={() => setOpenOverlay(null)}
          />
        )}

        {openOverlay?.type === "more" && (
          <MoreSheet
            title="Table menu"
            items={moreItems}
            onClose={() => setOpenOverlay((overlay) => (overlay?.type === "more" ? null : overlay))}
          />
        )}

        {openOverlay?.type === "help" && <HelpModal onClose={() => setOpenOverlay(null)} />}

        {state.tourney?.finished && !resultsDismissed && (
          <TourneyResults tourney={state.tourney} onClose={() => setResultsDismissed(true)} />
        )}
      </div>

      {chatOpen && (
        <aside className="hidden xl:flex xl:w-80 xl:shrink-0 xl:flex-col xl:border-l xl:border-white/10 xl:p-2">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-sm font-semibold text-white/80">Chat &amp; log</span>
            <button
              onClick={() => setOpenOverlay(null)}
              aria-label="Collapse chat"
              className="touch-target flex items-center justify-center rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <SidePanel state={state} send={send} />
          </div>
        </aside>
      )}

      {chatOpen && (
        <div className="fixed inset-0 z-50 xl:hidden" onClick={() => setOpenOverlay(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="safe-t absolute inset-y-0 right-0 flex w-80 max-w-[85vw] flex-col bg-[#16181a] p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-sm font-semibold text-white/80">Chat &amp; log</span>
              <button
                onClick={() => setOpenOverlay(null)}
                aria-label="Close chat"
                className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <SidePanel state={state} send={send} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
