import { useCallback, useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import type { ClientMessage, HandSummary, PublicTableState, ServerMessage } from "@common/protocol";
import { getPlayerId } from "./identity";
import { partyHost } from "./partyHost";

export interface RoomConnection {
  state: PublicTableState | null;
  connected: boolean;
  error: string | null;
  playerId: string;
  histories: HandSummary[];
  send: (msg: ClientMessage) => void;
  onRtc: (cb: (from: string, data: unknown) => void) => () => void;
}

export function useRoom(roomId: string, name: string): RoomConnection {
  const [state, setState] = useState<PublicTableState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [histories, setHistories] = useState<HandSummary[]>([]);
  const socketRef = useRef<PartySocket | null>(null);
  const rtcHandlers = useRef(new Set<(from: string, data: unknown) => void>());
  const playerId = getPlayerId();
  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => {
    const socket = new PartySocket({ host: partyHost(), room: roomId, party: "main" });
    socketRef.current = socket;

    const onOpen = () => {
      setConnected(true);
      socket.send(JSON.stringify({ type: "join", playerId, name: nameRef.current } satisfies ClientMessage));
    };
    const onClose = () => setConnected(false);
    const onMessage = (ev: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "state") setState(msg.state);
      else if (msg.type === "error") setError(msg.message);
      else if (msg.type === "history") setHistories(msg.histories);
      else if (msg.type === "rtc") rtcHandlers.current.forEach((h) => h(msg.from, msg.data));
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    socket.addEventListener("message", onMessage);

    return () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("message", onMessage);
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, playerId]);

  const send = useCallback((msg: ClientMessage) => {
    socketRef.current?.send(JSON.stringify(msg));
  }, []);

  const onRtc = useCallback((cb: (from: string, data: unknown) => void) => {
    rtcHandlers.current.add(cb);
    return () => rtcHandlers.current.delete(cb);
  }, []);

  // Dev-only test harness hook: drive the socket and read state from agent-browser.
  if (import.meta.env.DEV) {
    (window as unknown as { __pn?: unknown }).__pn = { send, state, playerId, connected };
  }

  // auto-clear transient errors
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3500);
    return () => clearTimeout(t);
  }, [error]);

  return { state, connected, error, playerId, histories, send, onRtc };
}
