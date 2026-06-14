// A stable per-browser player identity, persisted so a refresh reconnects to
// the same seat and recovers private cards. No account, no signup — just a
// random id + a chosen display name, exactly like PokerNow.

const ID_KEY = "pn.playerId";
const NAME_KEY = "pn.playerName";

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getPlayerId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

export function getPlayerName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

export function setPlayerName(name: string) {
  localStorage.setItem(NAME_KEY, name.slice(0, 20));
}

// Short, unambiguous room code (no 0/O/1/I/L) — used in shareable links.
export function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out.toLowerCase();
}
