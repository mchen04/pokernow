import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClientMessage, PublicTableState } from "@common/protocol";

export function SidePanel({ state, send }: { state: PublicTableState; send: (m: ClientMessage) => void }) {
  const [tab, setTab] = useState<"chat" | "log">("chat");
  const [draft, setDraft] = useState("");
  // The active scroll container (log OR chat — only one is mounted at a time).
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether the view is pinned to the bottom. We only auto-scroll when the user
  // is already near the bottom, so scrolling up to read history isn't yanked
  // away — but new messages always come into view when you're at the bottom.
  const stuck = useRef(true);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // Jump to the newest line whenever the active tab changes (always) or new
  // content arrives (only while pinned). useLayoutEffect avoids a flash of the
  // old scroll position before the browser paints.
  useLayoutEffect(() => {
    stuck.current = true; // switching tabs should reveal the latest
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tab]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [state.log.length, state.chat.length]);

  const sendChat = () => {
    const text = draft.trim();
    if (!text) return;
    send({ type: "chat", text });
    setDraft("");
    stuck.current = true; // sending a message always scrolls you to it
  };

  return (
    <div className="flex h-full flex-col rounded-xl bg-slate-900/80 ring-1 ring-white/10">
      <div className="flex border-b border-white/10">
        {(["chat", "log"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2 text-xs font-semibold capitalize ${
              tab === t ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "log" ? (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto p-2 text-[12px] leading-relaxed text-white/80"
        >
          {state.log.map((e) => (
            <div key={e.id} className="border-b border-white/5 py-0.5">
              {e.text}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="flex-1 overflow-y-auto p-2 text-[12px] leading-relaxed"
          >
            {state.chat.map((m) => (
              <div key={m.id} className={m.system ? "text-amber-300/80 italic" : "text-white/85"}>
                {!m.system && <span className="font-semibold text-emerald-300">{m.name}: </span>}
                {m.text}
              </div>
            ))}
          </div>
          <div className="flex gap-1 border-t border-white/10 p-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              placeholder="Say something…"
              className="flex-1 rounded-md bg-slate-800 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400"
            />
            <button
              onClick={sendChat}
              className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
