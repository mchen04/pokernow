import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useClub } from "../lib/useClub";
import { getPlayerName, makeRoomCode } from "../lib/identity";
import { NameGate } from "../components/NameGate";

export default function Club() {
  const { clubId = "" } = useParams();
  const [name, setName] = useState(getPlayerName());

  if (!name) {
    return (
      <NameGate
        title="Join the club"
        subtitle="Pick a name — no account needed."
        cta="Enter"
        onDone={setName}
      />
    );
  }
  return <ClubInner clubId={clubId} name={name} />;
}

function ClubInner({ clubId, name }: { clubId: string; name: string }) {
  const { state, connected, playerId, send } = useClub(clubId, name);
  const navigate = useNavigate();
  const [editName, setEditName] = useState("");
  const [copied, setCopied] = useState(false);

  if (!state) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center text-white/60">
        {connected ? "Loading club…" : "Connecting…"}
      </div>
    );
  }

  const isHost = state.hostId === playerId;
  const launchGame = () => {
    const code = makeRoomCode();
    send({ type: "createGame", code, name: `${state.name} game` });
    navigate(`/room/${code}`);
  };

  return (
    <div className="mx-auto min-h-[100dvh] max-w-2xl bg-[#0f1115] px-5 py-8 font-body text-white">
      <button onClick={() => navigate("/")} className="mb-4 text-sm text-white/50 hover:text-white">
        ← Home
      </button>

      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">{state.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-white/50">
            <span className="rounded bg-white/10 px-2 py-0.5 font-mono tracking-widest text-emerald-300">
              {clubId.toUpperCase()}
            </span>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(window.location.href);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="hover:text-white"
            >
              {copied ? "Copied!" : "Copy club link"}
            </button>
          </div>
        </div>
        <button
          onClick={launchGame}
          className="rounded-full bg-[#f2b138] px-5 py-2.5 font-bold text-[#1a1207] hover:bg-[#ffc24d]"
        >
          Launch a game →
        </button>
      </div>

      {isHost && (
        <div className="mb-6 flex gap-2">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Rename club…"
            className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-emerald-400"
          />
          <button
            onClick={() => {
              if (editName.trim()) {
                send({ type: "rename", name: editName.trim() });
                setEditName("");
              }
            }}
            className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold hover:bg-slate-600"
          >
            Save
          </button>
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-white/40">
            Members ({state.members.length})
          </h2>
          <div className="space-y-1">
            {state.members.map((m) => (
              <div
                key={m.playerId}
                className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-sm"
              >
                <span className="font-medium">
                  {m.name}
                  {m.playerId === state.hostId && <span className="ml-1 text-amber-300">★</span>}
                  {m.playerId === playerId && <span className="text-emerald-300"> (you)</span>}
                </span>
                <span className="text-xs text-white/40">{m.games} games</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-white/40">
            Recent games
          </h2>
          <div className="space-y-1">
            {state.games.length === 0 && (
              <p className="text-sm text-white/40">No games yet — launch one to get started.</p>
            )}
            {state.games.map((g) => (
              <button
                key={g.code}
                onClick={() => navigate(`/room/${g.code}`)}
                className="flex w-full items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-left text-sm hover:bg-white/[0.06]"
              >
                <span className="font-mono tracking-widest text-emerald-300">{g.code.toUpperCase()}</span>
                <span className="text-white/50">Join ▸</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <p className="mt-8 text-center text-xs text-white/30">
        Clubs are free — recurring games, persistent members, no subscription.
      </p>
    </div>
  );
}
