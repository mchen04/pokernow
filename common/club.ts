// Clubs — private communities with recurring games and a persistent member
// list. A club is its own PartyKit party and uses PartyKit storage so members
// and games survive between sessions (this is room-scoped durability, not a
// user database).

export interface ClubMember {
  playerId: string;
  name: string;
  joinedAt: number;
  games: number; // games played in this club
}

export interface ClubGame {
  code: string;
  name: string;
  createdAt: number;
  createdBy: string;
}

export interface ClubState {
  clubId: string;
  name: string;
  hostId: string | null;
  members: ClubMember[];
  games: ClubGame[];
}

export type ClubClientMessage =
  | { type: "join"; playerId: string; name: string }
  | { type: "rename"; name: string } // host renames the club
  | { type: "createGame"; code: string; name: string }
  | { type: "removeMember"; playerId: string }; // host moderation

export type ClubServerMessage = { type: "club"; state: ClubState };
