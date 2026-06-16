import { useState } from "react";
import { setPlayerName } from "../lib/identity";

// Name-only entry — no account, no signup. Shared by the room and club pages.
export function NameGate({
  title,
  subtitle,
  cta,
  onDone,
}: {
  title: string;
  subtitle: string;
  cta: string;
  onDone: (name: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const n = draft.trim();
    if (!n) return;
    setPlayerName(n);
    onDone(n);
  };
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#0a100d] p-4">
      <div className="w-full max-w-sm rounded-2xl bg-slate-900 p-6 ring-1 ring-white/10">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-2xl leading-none text-[#f2b138]">♠</span>
          <span className="font-display text-xl font-semibold tracking-tight text-white">Felt</span>
        </div>
        <h1 className="mb-1 text-xl font-bold text-white">{title}</h1>
        <p className="mb-4 text-sm text-white/70">{subtitle}</p>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Your name"
          className="mb-3 w-full rounded-lg bg-slate-800 px-3 py-2 text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400"
        />
        <button
          disabled={!draft.trim()}
          onClick={submit}
          className="w-full rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-white/55"
        >
          {cta}
        </button>
      </div>
    </div>
  );
}
