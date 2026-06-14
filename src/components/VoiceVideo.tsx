import { useEffect, useRef } from "react";

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

// Audio-only sink. Each remote peer's audio is always played here regardless of
// whether their camera is on; the VIDEO tiles now render in-seat (Seat.tsx),
// beside each player's pod, so there is no longer a floating video strip.
export function VoiceVideo({ remote }: { remote: Record<string, MediaStream> }) {
  return (
    <>
      {Object.entries(remote).map(([id, s]) => (
        <RemoteAudio key={`a-${id}`} stream={s} />
      ))}
    </>
  );
}
