import { useCallback, useMemo, useState } from "react";
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
import { SidePanel } from "../components/SidePanel";
import { BuyInModal } from "../components/BuyInModal";
import { SettingsModal } from "../components/SettingsModal";
import { LedgerModal } from "../components/LedgerModal";
import { MoreSheet, type SheetItem } from "../components/MoreSheet";
import { TourneyBanner, TourneyResults } from "../components/TourneyBanner";
import { useWebRTC } from "../lib/useWebRTC";
import { VoiceVideo } from "../components/VoiceVideo";
import {
  Check,
  Copy,
  DoorOpen,
  LogOut,
  Mic,
  MicOff,
  MessageSquare,
  MoreHorizontal,
  Palette,
  ScrollText,
  Settings,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "../components/Icon";

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
      className={`rounded-md p-2 hover:bg-white/10 ${
        active ? "text-emerald-400" : "text-white/60 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function RoomInner({ roomId, name }: { roomId: string; name: string }) {
  const navigate = useNavigate();
  const { state, connected, error, send, playerId, histories, onRtc } = useRoom(roomId, name);
  const active = state?.phase === "hand" || !!state?.tourney?.active;
  const now = useNow(active);
  const [resultsDismissed, setResultsDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sitSeat, setSitSeat] = useState<number | null>(null);
  const [showRebuy, setShowRebuy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const [showPanel, setShowPanel] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const { fourColor, setFourColor } = usePrefs();
  useSound(state);

  const onSit = useCallback((i: number) => setSitSeat(i), []);

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
      onClick: () => setShowLedger(true),
    },
    {
      icon: <MessageSquare size={20} />,
      label: "Log & chat",
      sub: "Hand log and table chat",
      onClick: () => setShowPanel(true),
    },
    ...(isHost
      ? [
          {
            icon: <Settings size={20} />,
            label: "Table settings",
            sub: "Blinds, variant, game features",
            onClick: () => setShowSettings(true),
          },
        ]
      : []),
  ];

  return (
    <div className="h-screen-dyn flex flex-col overflow-hidden bg-[#201e1f] lg:flex-row">
      {/* main */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* header */}
        <header className="safe-t safe-x flex shrink-0 items-center justify-between gap-2 border-b border-white/10 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-bold text-white">{state.config.roomName}</span>
            <span className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 font-mono text-xs tracking-widest text-emerald-300 sm:text-sm">
              {roomId.toUpperCase()}
            </span>
            <button
              onClick={copyLink}
              title="Copy invite link"
              aria-label="Copy invite link"
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              <span className="hidden sm:inline">{copied ? "Link copied!" : "Copy invite link"}</span>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-2 text-xs text-white/50">
            {state.handNumber > 0 && <span className="hidden md:inline">Hand #{state.handNumber}</span>}
            <span
              className={`inline-flex items-center gap-1 ${connected ? "text-emerald-400" : "text-amber-400"}`}
              title={connected ? "Connected" : "Reconnecting…"}
            >
              <span className="text-[10px]">{connected ? "●" : "○"}</span>
              <span className="hidden sm:inline">{connected ? "live" : "reconnecting"}</span>
            </span>

            {/* chat/log — slide-in drawer toggled from the top, on every viewport */}
            <IconBtn
              onClick={() => setShowPanel((p) => !p)}
              label="Chat & log"
              active={showPanel}
            >
              <MessageSquare size={18} />
            </IconBtn>

            {/* desktop inline controls */}
            <div className="hidden items-center gap-0.5 lg:flex">
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
              <IconBtn onClick={() => setShowLedger(true)} label="Ledger & history">
                <ScrollText size={18} />
              </IconBtn>
              {isHost && (
                <IconBtn onClick={() => setShowSettings(true)} label="Table settings">
                  <Settings size={18} />
                </IconBtn>
              )}
            </div>

            {/* mobile overflow */}
            <button
              onClick={() => setShowMore(true)}
              title="More"
              aria-label="More options"
              className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
            >
              <MoreHorizontal size={20} />
            </button>
          </div>
        </header>

        {/* table area — the dock below reserves its own space, so no felt padding hack */}
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

          {/* Floating seat-management cluster — top-LEFT of the felt, kept out of
              the bottom dock so it can't be fat-fingered while betting. The
              tourney banner is centered and the header is a separate row above,
              so a left-anchored cluster overlaps neither. The wrapper is
              pointer-events-none (buttons re-enable) so it never blocks felt
              clicks in the gaps. */}
          <div className="pointer-events-none absolute left-2 top-2 z-20 flex flex-col gap-1.5">
            {me && (
              <button
                onClick={() => send({ type: "stand" })}
                className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-xs font-semibold text-white/90 shadow-lg ring-1 ring-white/10 backdrop-blur transition hover:bg-slate-800 active:scale-[.97]"
              >
                <LogOut size={15} /> Stand up
              </button>
            )}
            <button
              onClick={leaveTable}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-xs font-semibold text-white/90 shadow-lg ring-1 ring-white/10 backdrop-blur transition hover:bg-slate-800 active:scale-[.97]"
            >
              <DoorOpen size={15} /> Leave table
            </button>
          </div>

          {state.tourney?.active && <TourneyBanner tourney={state.tourney} now={now} />}

          <VoiceVideo remote={rtc.remote} />
          {rtc.error && (
            <div className="pointer-events-none absolute left-1/2 top-12 z-30 -translate-x-1/2 rounded-md bg-amber-600/90 px-3 py-1 text-xs text-white">
              {rtc.error}
            </div>
          )}
        </div>

        {/* persistent bottom dock (M1): turn controls + seat presence + host start */}
        <BottomDock
          state={state}
          send={send}
          me={me}
          isHost={isHost}
          myTurn={myTurn}
          error={error}
          onRebuy={() => setShowRebuy(true)}
        />

        {sitSeat !== null && (
          <BuyInModal
            config={state.config}
            seatIndex={sitSeat}
            onConfirm={(buyIn) => {
              send({ type: "sit", seat: sitSeat, buyIn });
              setSitSeat(null);
            }}
            onCancel={() => setSitSeat(null)}
          />
        )}

        {showRebuy && me && (
          <BuyInModal
            config={state.config}
            seatIndex={me.index}
            rebuy
            onConfirm={(amount) => {
              send({ type: "rebuy", amount });
              setShowRebuy(false);
            }}
            onCancel={() => setShowRebuy(false)}
          />
        )}

        {showSettings && (
          <SettingsModal
            config={state.config}
            send={send}
            tourneyActive={!!state.tourney?.active}
            onClose={() => setShowSettings(false)}
          />
        )}

        {showLedger && (
          <LedgerModal
            roomId={roomId}
            ledger={state.ledger}
            stats={state.stats}
            histories={histories}
            log={state.log}
            send={send}
            onClose={() => setShowLedger(false)}
          />
        )}

        {showMore && <MoreSheet title="Table menu" items={moreItems} onClose={() => setShowMore(false)} />}

        {state.tourney?.finished && !resultsDismissed && (
          <TourneyResults tourney={state.tourney} onClose={() => setResultsDismissed(true)} />
        )}
      </div>

      {/* chat/log — slide-in drawer on every viewport, toggled from the header */}
      {showPanel && (
        <div className="fixed inset-0 z-50" onClick={() => setShowPanel(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="safe-t absolute inset-y-0 right-0 w-80 max-w-[85vw] bg-[#201e1f] p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <SidePanel state={state} send={send} />
          </div>
        </div>
      )}
    </div>
  );
}
