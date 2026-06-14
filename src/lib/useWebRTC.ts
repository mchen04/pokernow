import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage } from "@common/protocol";

// Mesh WebRTC voice/video. Signaling is relayed peer-to-peer through the room
// socket; this layer is NEVER authoritative for game state. Declining the
// camera/mic permission simply leaves it off — the game plays on regardless.

interface PeerMedia {
  playerId: string;
  on: boolean; // peer has mic or cam active
}

const ICE: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:global.stun.twilio.com:3478" }],
};

type Signal =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

export function useWebRTC(
  playerId: string,
  peers: PeerMedia[],
  send: (m: ClientMessage) => void,
  onRtc: (cb: (from: string, data: unknown) => void) => () => void
) {
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<Record<string, MediaStream>>({});
  const localRef = useRef<MediaStream | null>(null);
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peersRef = useRef<PeerMedia[]>(peers);
  peersRef.current = peers;

  const haveMedia = () => !!localRef.current;

  const ensurePC = useCallback(
    (peerId: string): RTCPeerConnection => {
      let pc = pcs.current.get(peerId);
      if (pc) return pc;
      pc = new RTCPeerConnection(ICE);
      localRef.current?.getTracks().forEach((t) => pc!.addTrack(t, localRef.current!));
      pc.onicecandidate = (e) => {
        if (e.candidate) send({ type: "rtc", to: peerId, data: { kind: "ice", candidate: e.candidate.toJSON() } });
      };
      pc.ontrack = (e) => setRemote((r) => ({ ...r, [peerId]: e.streams[0] }));
      pc.onconnectionstatechange = () => {
        if (pc && ["failed", "closed", "disconnected"].includes(pc.connectionState)) {
          pc.close();
          pcs.current.delete(peerId);
          setRemote((r) => {
            const n = { ...r };
            delete n[peerId];
            return n;
          });
        }
      };
      pcs.current.set(peerId, pc);
      return pc;
    },
    [send]
  );

  const callPeer = useCallback(
    async (peerId: string) => {
      const pc = ensurePC(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: "rtc", to: peerId, data: { kind: "offer", sdp: offer } });
    },
    [ensurePC, send]
  );

  // incoming signaling
  useEffect(() => {
    return onRtc(async (from, data) => {
      const sig = data as Signal;
      try {
        if (sig.kind === "offer") {
          const pc = ensurePC(from);
          await pc.setRemoteDescription(sig.sdp);
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          send({ type: "rtc", to: from, data: { kind: "answer", sdp: ans } });
        } else if (sig.kind === "answer") {
          await pcs.current.get(from)?.setRemoteDescription(sig.sdp);
        } else if (sig.kind === "ice") {
          await pcs.current.get(from)?.addIceCandidate(sig.candidate);
        }
      } catch {
        /* transient signaling errors are non-fatal */
      }
    });
  }, [onRtc, ensurePC, send]);

  // reconcile peer connections with who currently has media on
  useEffect(() => {
    if (!haveMedia()) return;
    for (const p of peers) {
      // glare-free: the lower playerId initiates the offer
      if (p.on && !pcs.current.has(p.playerId) && playerId < p.playerId) {
        void callPeer(p.playerId);
      }
    }
    for (const [pid, pc] of pcs.current) {
      if (!peers.some((p) => p.playerId === pid && p.on)) {
        pc.close();
        pcs.current.delete(pid);
        setRemote((r) => {
          const n = { ...r };
          delete n[pid];
          return n;
        });
      }
    }
  }, [peers, micOn, camOn, playerId, callPeer]);

  // Apply a desired mic/cam state. Mic and camera are fully independent — you
  // can run either alone, both, or neither. When the local track set changes we
  // rebuild the peer connections so every peer renegotiates against the new
  // tracks (the reconcile effect re-offers once the media broadcast updates).
  const apply = useCallback(
    async (wantMic: boolean, wantCam: boolean) => {
      if (!wantMic && !wantCam) {
        localRef.current?.getTracks().forEach((t) => t.stop());
        localRef.current = null;
        pcs.current.forEach((pc) => pc.close());
        pcs.current.clear();
        setRemote({});
        setMicOn(false);
        setCamOn(false);
        send({ type: "media", mic: false, cam: false });
        return true;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: wantMic, video: wantCam });
        localRef.current?.getTracks().forEach((t) => t.stop());
        localRef.current = stream;
        // Tear down existing connections; they re-establish with the new tracks.
        pcs.current.forEach((pc) => pc.close());
        pcs.current.clear();
        setRemote({});
        setMicOn(wantMic);
        setCamOn(wantCam);
        setError(null);
        send({ type: "media", mic: wantMic, cam: wantCam });
      } catch {
        setError("Mic/camera permission denied — playing on without it.");
        return false;
      }
      return true;
    },
    [send]
  );

  const toggleMic = useCallback(() => apply(!micOn, camOn), [apply, micOn, camOn]);
  const toggleCam = useCallback(() => apply(micOn, !camOn), [apply, micOn, camOn]);

  return { micOn, camOn, error, remote, localStream: localRef.current, toggleMic, toggleCam };
}
