import { useCallback, useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import type { ClubClientMessage, ClubServerMessage, ClubState } from "@common/club";
import { getPlayerId } from "./identity";
import { partyHost } from "./partyHost";

export function useClub(clubId: string, name: string) {
  const [state, setState] = useState<ClubState | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<PartySocket | null>(null);
  const playerId = getPlayerId();
  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => {
    const socket = new PartySocket({ host: partyHost(), room: clubId, party: "club" });
    socketRef.current = socket;
    const onOpen = () => {
      setConnected(true);
      socket.send(JSON.stringify({ type: "join", playerId, name: nameRef.current } satisfies ClubClientMessage));
    };
    const onClose = () => setConnected(false);
    const onMessage = (ev: MessageEvent) => {
      try {
        const msg: ClubServerMessage = JSON.parse(ev.data);
        if (msg.type === "club") setState(msg.state);
      } catch {
        /* ignore */
      }
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
  }, [clubId, playerId]);

  const send = useCallback((msg: ClubClientMessage) => {
    socketRef.current?.send(JSON.stringify(msg));
  }, []);

  return { state, connected, playerId, send };
}
