import type * as Party from "partykit/server";
import type {
  ClubClientMessage,
  ClubMember,
  ClubServerMessage,
  ClubState,
} from "../common/club";
import { olog, MAX_MESSAGE_BYTES } from "./log";

interface ConnState {
  playerId: string | null;
  name: string;
}

const STORAGE_KEY = "club";
const MAX_MEMBERS = 500; // bound storage growth; a "club" is a private group, not a public hall

// One PartyKit party per club code. Members + games persist in storage so they
// survive between games and server restarts.
export default class ClubServer implements Party.Server {
  // A club room is write-rare (members/games change occasionally) and fully
  // backed by storage that we reload in onStart — the ideal case for
  // hibernation. Idle clubs are evicted from memory (no duration billing) and
  // wake on the next message, raising the connection ceiling for spectators.
  readonly options: Party.ServerOptions = { hibernate: true };

  state: ClubState;

  constructor(readonly room: Party.Room) {
    this.state = {
      clubId: room.id,
      name: "New Club",
      hostId: null,
      members: [],
      games: [],
    };
  }

  async onStart() {
    const saved = await this.room.storage.get<ClubState>(STORAGE_KEY);
    if (saved) this.state = { ...saved, clubId: this.room.id };
  }

  private async persist() {
    try {
      await this.room.storage.put(STORAGE_KEY, this.state);
    } catch (e) {
      olog("error", "club_persist_failed", { room: this.room.id, error: String(e) });
    }
  }

  onConnect(conn: Party.Connection<ConnState>) {
    conn.setState({ playerId: null, name: "" });
    this.sendState(conn);
  }

  async onMessage(raw: string, conn: Party.Connection<ConnState>) {
    if (raw.length > MAX_MESSAGE_BYTES) {
      olog("warn", "club_oversize_message", { room: this.room.id, len: raw.length });
      return;
    }
    let msg: ClubClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      olog("warn", "club_bad_json", { room: this.room.id, len: raw.length });
      return;
    }
    const pid = () => conn.state?.playerId ?? null;

    switch (msg.type) {
      case "join": {
        const playerId = String(msg.playerId || "").slice(0, 64);
        const name = String(msg.name || "Player").slice(0, 20);
        if (!playerId) return;
        conn.setState({ playerId, name });
        if (!this.state.hostId) this.state.hostId = playerId;
        const existing = this.state.members.find((m) => m.playerId === playerId);
        if (existing) existing.name = name;
        else if (this.state.members.length < MAX_MEMBERS)
          this.state.members.push({ playerId, name, joinedAt: Date.now(), games: 0 } as ClubMember);
        break;
      }
      case "rename":
        if (pid() && pid() === this.state.hostId) this.state.name = String(msg.name).slice(0, 40) || this.state.name;
        break;
      case "createGame": {
        if (!pid()) return;
        const code = String(msg.code || "").slice(0, 16).toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!code) return;
        if (!this.state.games.some((g) => g.code === code)) {
          this.state.games.unshift({
            code,
            name: String(msg.name || "Club Game").slice(0, 40),
            createdAt: Date.now(),
            createdBy: pid()!,
          });
          this.state.games = this.state.games.slice(0, 50);
          const m = this.state.members.find((x) => x.playerId === pid());
          if (m) m.games++;
        }
        break;
      }
      case "removeMember":
        if (pid() === this.state.hostId) {
          this.state.members = this.state.members.filter((m) => m.playerId !== msg.playerId);
        }
        break;
      default:
        return;
    }
    await this.persist();
    this.broadcast();
  }

  private sendState(conn: Party.Connection) {
    conn.send(JSON.stringify({ type: "club", state: this.state } satisfies ClubServerMessage));
  }

  private broadcast() {
    const payload = JSON.stringify({ type: "club", state: this.state } satisfies ClubServerMessage);
    for (const conn of this.room.getConnections()) conn.send(payload);
  }
}

ClubServer satisfies Party.Worker;
